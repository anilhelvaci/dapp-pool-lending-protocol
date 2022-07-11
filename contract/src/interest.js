// @ts-check

import { AmountMath } from '@agoric/ertp';
import { assert, details as X } from '@agoric/assert';
import { makeInterestCalculator, calculateCompoundedInterest } from '@agoric/run-protocol/src/interest.js';

export const SECONDS_PER_YEAR = 60n * 60n * 24n * 365n;
export const BASIS_POINTS = 10000n;
export const LARGE_DENOMINATOR = BASIS_POINTS * BASIS_POINTS;

/**
 *
 * @param {Brand} underlyingBrand
 * @param {Amount} debt
 */
const validatedBrand = async (underlyingBrand, debt) => {
  const { brand: debtBrand } = debt;
  assert(
    debtBrand === underlyingBrand,
    X`Debt and issuer brands differ: ${debtBrand} != ${underlyingBrand}`,
  );
  return underlyingBrand;
};

/**
 * We had to simplify the `chargeInterest` method in `interest.js` module of VaultFactory because
 * we do not mint any rewards when an interest accrual occurs.
 *
 * @param {{
 *  underlyingBrand: Brand,
 *  poolIncrementSeat: ZCFSeat
 *   }} powers
 * @param {{
 *  interestRate: Ratio,
 *  chargingPeriod: bigint,
 *  recordingPeriod: bigint}} params
 * @param {{
 *  latestInterestUpdate: bigint,
 *  compoundedInterest: Ratio,
 *  totalDebt: Amount<NatValue>}} prior
 * @param {bigint} accruedUntil
 * @returns {Promise<{compoundedInterest: Ratio, latestInterestUpdate: bigint, totalDebt: Amount<NatValue> }>}
 */
export const chargeInterest = async (powers, params, prior, accruedUntil) => {
  const brand = await validatedBrand(powers.underlyingBrand, prior.totalDebt);

  const interestCalculator = makeInterestCalculator(
    params.interestRate,
    params.chargingPeriod,
    params.recordingPeriod,
  );

  // calculate delta of accrued debt
  const debtStatus = interestCalculator.calculateReportingPeriod(
    {
      latestInterestUpdate: prior.latestInterestUpdate,
      newDebt: prior.totalDebt.value,
      interest: 0n, // XXX this is always zero, doesn't need to be an option
    },
    accruedUntil,
  );
  const interestAccrued = debtStatus.interest;

  // done if none
  if (interestAccrued === 0n) {
    return {
      compoundedInterest: prior.compoundedInterest,
      latestInterestUpdate: debtStatus.latestInterestUpdate,
      totalDebt: prior.totalDebt,
    };
  }

  // NB: This method of inferring the compounded rate from the ratio of debts
  // acrrued suffers slightly from the integer nature of debts. However in
  // testing with small numbers there's 5 digits of precision, and with large
  // numbers the ratios tend towards ample precision.
  // TODO adopt banker's rounding https://github.com/Agoric/agoric-sdk/issues/4573
  const compoundedInterest = calculateCompoundedInterest(
    prior.compoundedInterest,
    prior.totalDebt.value,
    debtStatus.newDebt,
  );

  // totalDebt += interestAccrued
  const totalDebt = AmountMath.add(
    prior.totalDebt,
    AmountMath.make(brand, interestAccrued),
  );

  return {
    compoundedInterest,
    latestInterestUpdate: debtStatus.latestInterestUpdate,
    totalDebt,
  };
};
