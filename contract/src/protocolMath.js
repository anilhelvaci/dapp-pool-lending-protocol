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

export const calculateExchangeRate = (totalCashAmount, totalBorrowAmount, totalSupplyAmount) => {
  assert(totalCashAmount.brand === totalBorrowAmount.brand,
    X`${totalCashAmount.brand} and ${totalBorrowAmount} should be the same`);

  const numeratorAmount = AmountMath.add(totalCashAmount, totalBorrowAmount);

  return makeRatioFromAmounts(
    numeratorAmount,
    totalSupplyAmount
  )
};

export const calculateUtilizationRate = (totalCashAmount, totalBorrowAmount) => {
  assert(totalCashAmount.brand === totalBorrowAmount.brand,
    X`${totalCashAmount.brand} and ${totalBorrowAmount} should be the same`);

  const denominatorAmount = AmountMath.add(totalCashAmount, totalBorrowAmount);

  return makeRatioFromAmounts(
    totalBorrowAmount,
    denominatorAmount
  );
}

export const calculateBorrowingRate = (multiplierRatioPerPeriod, baseRatePerBlock, utilizationRate) => {
  assertIsRatio(multiplierRatioPerPeriod);
  assertIsRatio(baseRatePerBlock);
  assertIsRatio(utilizationRate);

  return addRatios(baseRatePerBlock, multiplyRatios(utilizationRate, multiplierRatioPerPeriod));
};

/**
 * TODO List
 * supplyRate
 * supplyRateAPY
 */