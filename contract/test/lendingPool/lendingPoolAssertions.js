import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import { calculateProtocolFromUnderlying, getPoolMetadata } from './helpers.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import { LARGE_DENOMINATOR, BASIS_POINTS } from '../../src/interest.js';
import { LoanPhase } from '../../src/lendingPool/loan.js';

/**
 * This module brings together necessary assertions that are
 * conceptually related to make the tests more readable and maintainable.
 * @param t
 */
export const makeLendingPoolAssertions = t => {
  /**
   *
   * @param {PoolManager} poolManager
   * @param {LendingPoolPublicFacet} lendingPoolPublicFacet
   * @returns {Promise<void>}
   */
  const assertPoolAddedCorrectly = async (poolManager, lendingPoolPublicFacet) => {
    const underlyingBrand = await E(poolManager).getUnderlyingBrand();
    const [hasPool, poolManagerFromLendingPool] = await Promise.all([
      E(lendingPoolPublicFacet).hasPool(underlyingBrand),
      E(lendingPoolPublicFacet).getPool(underlyingBrand)
    ])
    t.truthy(hasPool);
    t.deepEqual(poolManagerFromLendingPool , poolManager);
  };

  /**
   *
   * @param {PoolManager} poolManager
   * @param {Amount} shouldReceviedProtocolAmount
   * @param {Amount} underlyingAmountIn
   * @param {Amount} protocolAmountReceived
   * @param {String} offerResult
   * @returns {Promise<void>}
   */
  const assertDepositedCorrectly = async (poolManager, shouldReceviedProtocolAmount, underlyingAmountIn, protocolAmountReceived, offerResult) => {
    const [actualProtocolAmount, actualUnderlyingAmount] = await Promise.all([
      E(poolManager).getProtocolLiquidity(),
      E(poolManager).getUnderlyingLiquidity(),
    ])

    t.deepEqual(protocolAmountReceived, shouldReceviedProtocolAmount);
    t.deepEqual(actualProtocolAmount, shouldReceviedProtocolAmount); // We know that initial exchange rate is 0,02
    t.deepEqual(actualUnderlyingAmount, underlyingAmountIn);
    t.is(offerResult, 'Finished');
  };

  /**
   *
   * @param {PoolManager} poolManager
   * @param {Amount} depositedLiquidity
   * @returns {Promise<void>}
   */
  const assertEnoughLiquidityInPool = async (poolManager, depositedLiquidity) => {
    const [underlyingLiquidity, underlyingBrand] = await Promise.all([
      E(poolManager).getUnderlyingLiquidity(),
      E(poolManager).getUnderlyingBrand()
    ]);
    const marginAmount = AmountMath.make(underlyingBrand, 1n);

    t.deepEqual(underlyingLiquidity, depositedLiquidity);

    await Promise.all([
      t.notThrowsAsync(E(poolManager).enoughLiquidityForProposedDebt(AmountMath.subtract(underlyingLiquidity, marginAmount))),
      t.throwsAsync(E(poolManager).enoughLiquidityForProposedDebt(AmountMath.add(underlyingLiquidity, marginAmount))),
    ]);
  };

  /**
   * @param {PoolManager} poolManager
   * @param {WrappedLoan} loan
   * @param {{
   *   requestedDebt: Amount,
   *   totalDebt: Amount,
   *   underlyingBalanceBefore: Amount,
   *   borrowingRate: Ratio
   * }} expected
   * @returns {Promise<void>}
   */
  const assertBorrowSuccessfulNoInterest = async (poolManager, loan, expected) => {

    const [loanCurrentDebt, totalDebtFromPool, underlyingBalanceAfter, borrowingRate] = await Promise.all([
      E(loan).getCurrentDebt(),
      E(poolManager).getTotalDebt(),
      E(poolManager).getUnderlyingLiquidity(),
      E(poolManager).getCurrentBorrowingRate(),
    ]);

    t.deepEqual(loanCurrentDebt, expected.requestedDebt);
    t.deepEqual(totalDebtFromPool, expected.totalDebt);
    t.deepEqual(underlyingBalanceAfter, AmountMath.subtract(expected.underlyingBalanceBefore, loanCurrentDebt));
    t.deepEqual(borrowingRate, expected.borrowingRate);
  };

  /**
   *
   * @param {PoolManager} poolManager
   * @param {{
   *   principalDebt: BigInt,
   *   accruedInterest: BigInt,
   *   borrowingRate: BigInt,
   *   exchangeRateNumerator: BigInt,
   * }} expected
   * @returns {Promise<void>}
   */
  const assertInterestCharged = async (poolManager, expected) => {
    const [poolTotalDebt, poolCurrentBorrowingRate, poolExchangeRate, { protocolBrand, underlyingBrand }] = await Promise.all([
        E(poolManager).getTotalDebt(),
        E(poolManager).getCurrentBorrowingRate(),
        E(poolManager).getExchangeRate(),
        getPoolMetadata(poolManager),
      ],
    );

    const expectedTotalDebt = AmountMath.make(underlyingBrand, expected.principalDebt + expected.accruedInterest);
    const expectedBorrowingRate = makeRatio(expected.borrowingRate, underlyingBrand, BASIS_POINTS);
    const expectedExchangeRate = makeRatio(expected.exchangeRateNumerator, underlyingBrand, BigInt(LARGE_DENOMINATOR), protocolBrand);

    t.deepEqual(poolTotalDebt, expectedTotalDebt);
    t.deepEqual(poolCurrentBorrowingRate, expectedBorrowingRate);
    t.deepEqual(poolExchangeRate, expectedExchangeRate);
  };

  /**
   * @param {PoolManager} collateralPoolManager
   * @param {PoolManager} debtPoolManager
   * @param {WrappedLoan} loan
   * @param {UserSeat} adjustSeat
   * @param {{
   *   collateralPayoutAmount: Amount,
   *   debtPayoutAmount: Amount,
   *   totalCollateralUnderlyingAfterUpdate: Amount,
   *   totalDebtAfterUpdate: Amount,
   * }} expected
   * @returns {Promise<void>}
   */
  const assertAdjustBalancesSuccessful = async (collateralPoolManager, debtPoolManager, loan, adjustSeat, expected) => {
    const [
      { protocolIssuer: collateralIssuer, exchangeRate },
      { underlyingIssuer: debtIssuer },
      payouts,
      offerResult,
      loanCurrentDebtAfterUpdate,
      loanCollateralAfterUpdate] = await Promise.all([
      getPoolMetadata(collateralPoolManager),
      getPoolMetadata(debtPoolManager),
      E(adjustSeat).getPayouts(),
      E(adjustSeat).getOfferResult(),
      E(loan).getCurrentDebt(),
      E(loan).getCollateralAmount(),
    ]);

    if (expected.collateralPayoutAmount) {
      const { Collateral: collateralPayout } = payouts;
      const collateralPayoutAmount = await E(collateralIssuer).getAmountOf(collateralPayout);
      t.deepEqual(collateralPayoutAmount, expected.collateralPayoutAmount);
    }

    if (expected.debtPayoutAmount) {
      const { Debt: debtPayout } = payouts;
      const debtPayoutAmount = await E(debtIssuer).getAmountOf(debtPayout);
      t.deepEqual(debtPayoutAmount, expected.debtPayoutAmount);
    }

    // Check offer result
    t.deepEqual(offerResult, 'We have adjusted your balances, thank you for your business');
    // Check if the total debt of Alice is the sum of both borrow and adjust offers
    t.deepEqual(loanCurrentDebtAfterUpdate, expected.totalDebtAfterUpdate);
    // Check if the amount of collateral is as expected
    t.deepEqual(loanCollateralAfterUpdate,
      calculateProtocolFromUnderlying(expected.totalCollateralUnderlyingAfterUpdate, exchangeRate));
  };

  /**
   *
   * @param {PoolManager} collateralUnderlyingPoolManager
   * @param {PoolManager} debtPoolManager
   * @param {UserSeat} closeSeat
   * @param {WrappedLoan} loan
   * @param {{
   *   collateralUnderlyingAmount: Amount,
   *   newTotalDebt: Amount
   * }} expected
   * @returns {Promise<void>}
   */
  const assertLoanClosedCorrectly = async (collateralUnderlyingPoolManager, debtPoolManager, closeSeat, loan, expected) => {
    const { protocolIssuer, exchangeRate } = await getPoolMetadata(collateralUnderlyingPoolManager);
    const expectedCollateralAmount = calculateProtocolFromUnderlying(expected.collateralUnderlyingAmount, exchangeRate);

    const [
      closeOfferResult,
      closePayout,
      state,
      poolTotalDebt,
    ] = await Promise.all([
      E(closeSeat).getOfferResult(),
      E(closeSeat).getPayout('Collateral'),
      E(E(loan).getNotifier()).getUpdateSince(),
      E(debtPoolManager).getTotalDebt()
    ]);

    const closePayoutAmount = await E(protocolIssuer).getAmountOf(closePayout);

    t.is(closeOfferResult, 'your loan is closed, thank you for your business');
    t.is(state.value.loanState, LoanPhase.CLOSED);
    t.deepEqual(closePayoutAmount, expectedCollateralAmount);
    t.deepEqual(poolTotalDebt, expected.newTotalDebt);
  };

  return harden({
    assertPoolAddedCorrectly,
    assertDepositedCorrectly,
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertInterestCharged,
    assertAdjustBalancesSuccessful,
    assertLoanClosedCorrectly,
  })
}