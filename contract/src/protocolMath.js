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

const { multiply, floorDivide, ceilDivide, add, subtract } = natSafeMath;

const BASIS_POINTS = 10000n;

export const calculateExchangeRate = (totalCashAmount, totalBorrowAmount, totalSupplyAmount) => {
  assert(totalCashAmount.brand === totalBorrowAmount.brand,
    X`${totalCashAmount.brand} and ${totalBorrowAmount} should be the same`);

  const numeratorAmount = AmountMath.add(totalCashAmount, totalBorrowAmount);

  return quantize(
    makeRatioFromAmounts(
      numeratorAmount,
      totalSupplyAmount
    ),
    BASIS_POINTS
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
    BASIS_POINTS
  );
}

export const calculateBorrowingRate = (multiplierRatio, baseRate, utilizationRate) => {
  assertIsRatio(multiplierRatio);
  assertIsRatio(baseRate);
  assertIsRatio(utilizationRate);

  return quantize(
    addRatios(baseRate, multiplyRatios(utilizationRate, multiplierRatio)),
    BASIS_POINTS
  );
};

/**
 * TODO List
 * supplyRate
 * supplyRateAPY
 */