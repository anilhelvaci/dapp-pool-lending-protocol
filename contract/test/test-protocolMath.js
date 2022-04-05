// @ts-check
import { test } from '@agoric/zoe/tools/prepare-test-env-ava.js';
import '@agoric/zoe/exported.js';

import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import {
  ceilMultiplyBy,
  ceilDivideBy,
  makeRatio,
  makeRatioFromAmounts
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { Far } from '@endo/marshal';
import { makeIssuerRecord } from '@agoric/zoe/src/issuerRecord.js';
import { calculateExchangeRate } from '../src/protocolMath.js';
import { makeInterestCalculator } from '../src/interest.js';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/safeMath.js';
const { multiply, floorDivide, ceilDivide, add, subtract } = natSafeMath;

const ONE_DAY = 60n * 60n * 24n;
const ONE_MONTH = ONE_DAY * 30n;
const ONE_YEAR = ONE_MONTH * 12n;
const BASIS_POINTS = 10000n;
const HUNDRED_THOUSAND = 100000n;
const TEN_MILLION = 10000000n;


test('how many to mint', t => {
  const { issuer: underlyingIssuer, mint: underlyingMint, brand: underlyingBrand }
    = makeIssuerKit('underlying', AssetKind.NAT, harden({ decimalPlaces: 8 }));

  const { issuer: protocolIssuer, mint: protocolMint, brand: protocolBrand }
    = makeIssuerKit('protocol', AssetKind.NAT, harden({ decimalPlaces: 6 }));

  t.is(underlyingBrand.getDisplayInfo().decimalPlaces, 8);
  t.is(protocolBrand.getDisplayInfo().decimalPlaces, 6);

  let exchangeRate = makeRatio(200n, underlyingBrand, 10000n, protocolBrand);

  t.is(exchangeRate.numerator.brand.getDisplayInfo().decimalPlaces, 8);
  t.is(exchangeRate.denominator.brand.getDisplayInfo().decimalPlaces, 6);

  const depositAmount = AmountMath.make(underlyingBrand, 111111111n);

  const protocolMintAmount = ceilDivideBy(depositAmount, exchangeRate);

  console.log('[CEIL_DIVIDE_BY]', protocolMintAmount);

  exchangeRate = calculateExchangeRate(depositAmount, AmountMath.make(underlyingBrand, 200n), protocolMintAmount);

  const redeemAmount = ceilMultiplyBy(protocolMintAmount, exchangeRate);
  console.log('[CEIL_MULTIPLY_BY]', redeemAmount);
  const protift = subtract(redeemAmount.value, depositAmount.value);
  console.log('[PROFIT]', protift);
  const protfitRatio = Number(protift) / Number(depositAmount.value);
  console.log('[PROFIT_RATIO]', protfitRatio);
});

test('interest', async t => {
  const { issuer: underlyingIssuer, mint: underlyingMint, brand: underlyingBrand }
    = makeIssuerKit('underlying', AssetKind.NAT, harden({ decimalPlaces: 8 }));

  const { issuer: protocolIssuer, mint: protocolMint, brand: protocolBrand }
    = makeIssuerKit('protocol', AssetKind.NAT, harden({ decimalPlaces: 6 }));

  let exchangeRate = makeRatio(200n, underlyingBrand, BASIS_POINTS, protocolBrand);
  const calculator = makeInterestCalculator(exchangeRate, ONE_DAY, ONE_MONTH);

  const debtStatus = {
    newDebt: HUNDRED_THOUSAND,
    latestInterestUpdate: 0n,
    interest: 0n,
  };

  const depositAmount = AmountMath.make(underlyingBrand, 111111111n);
  const protocolMintAmount = ceilDivideBy(depositAmount, exchangeRate);
  console.log('[CEIL_DIVIDE_BY]', protocolMintAmount);

  const borrowAmount = AmountMath.make(underlyingBrand, HUNDRED_THOUSAND);
  const cash = AmountMath.subtract(depositAmount, borrowAmount);

  const calculatedInterest = calculator.calculate(debtStatus, ONE_DAY * 7n);
  t.deepEqual(calculatedInterest, {
    latestInterestUpdate: ONE_DAY * 7n,
    interest: 42n,
    newDebt: 100042n,
  });
  console.log('[NEW_DEBT]', calculatedInterest.newDebt);

  const accruedBorrowAmount = AmountMath.make(underlyingBrand, calculatedInterest.newDebt);

  exchangeRate = calculateExchangeRate(cash, accruedBorrowAmount, protocolMintAmount);

  const redeemAmountExpected = AmountMath.make(underlyingBrand, 111111153n);
  const redeemAmountActual = ceilMultiplyBy(protocolMintAmount, exchangeRate);
  console.log('[REDEEM_ACTUAL]', redeemAmountActual);
  t.deepEqual(redeemAmountActual, redeemAmountExpected);
})