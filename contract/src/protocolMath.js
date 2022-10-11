import {
  makeRatioFromAmounts,
  multiplyRatios,
  addRatios,
  quantize,
  assertIsRatio
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { assert, details as X, q } from '@agoric/assert';
import { AmountMath } from '@agoric/ertp';
import { LARGE_DENOMINATOR, BASIS_POINTS } from './interest.js';

/**
 *
 * @param {Amount<'nat'>} totalCashAmount
 * @param {Amount<'nat'>} totalBorrowAmount
 * @param {Amount<'nat'>} totalSupplyAmount
 * @returns {Ratio}
 */
export const calculateExchangeRate = (totalCashAmount, totalBorrowAmount, totalSupplyAmount) => {
  assert(totalCashAmount.brand === totalBorrowAmount.brand,
    X`${totalCashAmount.brand} and ${totalBorrowAmount} should be the same`);

  const numeratorAmount = AmountMath.add(totalCashAmount, totalBorrowAmount);

  return quantize(
    makeRatioFromAmounts(
      numeratorAmount,
      totalSupplyAmount
    ),
    BigInt(LARGE_DENOMINATOR)
  )
};

/**
 *
 * @param {Amount<'nat'>} totalCashAmount
 * @param {Amount<'nat'>} totalBorrowAmount
 * @returns {Ratio}
 */
export const calculateUtilizationRate = (totalCashAmount, totalBorrowAmount) => {
  assert(totalCashAmount.brand === totalBorrowAmount.brand,
    X`${totalCashAmount.brand} and ${totalBorrowAmount} should be the same`);

  const denominatorAmount = totalBorrowAmount.value === 0n ? AmountMath.make(totalBorrowAmount.brand, 1n) :
    AmountMath.add(totalCashAmount, totalBorrowAmount);

  return quantize(
    makeRatioFromAmounts(
      totalBorrowAmount,
      denominatorAmount
    ),
    BigInt(BASIS_POINTS)
  );
}

/**
 *
 * @param {Ratio} multiplierRatio
 * @param {Ratio} baseRate
 * @param {Ratio} utilizationRate
 * @returns {Ratio}
 */
export const calculateBorrowingRate = (multiplierRatio, baseRate, utilizationRate) => {
  assertIsRatio(multiplierRatio);
  assertIsRatio(baseRate);
  assertIsRatio(utilizationRate);

  return quantize(
    addRatios(baseRate, multiplyRatios(utilizationRate, multiplierRatio)),
    BigInt(BASIS_POINTS)
  );
};

/**
 * TODO List
 * supplyRate
 * supplyRateAPY
 */