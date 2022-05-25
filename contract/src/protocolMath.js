import {
  makeRatio,
  makeRatioFromAmounts,
  multiplyRatios,
  addRatios,
  quantize,
  ceilDivideBy,
  ceilMultiplyBy,
  assertIsRatio
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { assert, details as X, q } from '@agoric/assert';
import { AmountMath } from '@agoric/ertp';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/safeMath.js';
import { LARGE_DENOMINATOR, BASIS_POINTS } from './interest.js';

const { multiply, floorDivide, ceilDivide, add, subtract } = natSafeMath;

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

export const calculateUtilizationRate = (totalCashAmount, totalBorrowAmount) => {
  assert(totalCashAmount.brand === totalBorrowAmount.brand,
    X`${totalCashAmount.brand} and ${totalBorrowAmount} should be the same`);

  const denominatorAmount = AmountMath.add(totalCashAmount, totalBorrowAmount);

  return quantize(
    makeRatioFromAmounts(
      totalBorrowAmount,
      denominatorAmount
    ),
    BigInt(BASIS_POINTS)
  );
}

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