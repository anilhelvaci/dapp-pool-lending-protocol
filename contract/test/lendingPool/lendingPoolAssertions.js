import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import { calculateProtocolFromUnderlying, getPoolMetadata, getLatestUpdateFromSubscriber } from './helpers.js';
import { floorMultiplyBy, makeRatio, ratioGTE } from '@agoric/zoe/src/contractSupport/ratio.js';
import { LARGE_DENOMINATOR, BASIS_POINTS } from '../../src/interest.js';
import { LoanPhase } from '../../src/lendingPool/loan.js';
import { makeSubscription, makeSubscriptionKit, observeIteration } from '@agoric/notifier';

/**
 * This module brings together necessary assertions that are
 * conceptually related to make the tests more readable and maintainable.
 * @param t
 * @param {LendingPoolPublicFacet} lendingPoolPublicFacet
 * @param {Instance} lendingPoolInstance
 */
export const makeLendingPoolAssertions = (t, lendingPoolPublicFacet, lendingPoolInstance ) => {
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
   *   borrowingRate: Ratio,
   *   liquidationOccurredBefore: Boolean
   * }} expected
   * @returns {Promise<void>}
   */
  const assertBorrowSuccessfulNoInterest = async (poolManager, loan, expected) => {

    const [loanCurrentDebt, collateralAmount, totalDebtFromPool, underlyingBalanceAfter, borrowingRate] = await Promise.all([
      E(loan).getCurrentDebt(),
      E(loan).getCollateralAmount(),
      E(poolManager).getTotalDebt(),
      E(poolManager).getUnderlyingLiquidity(),
      E(poolManager).getCurrentBorrowingRate(),
    ]);

    t.log(collateralAmount);
    t.deepEqual(loanCurrentDebt, expected.requestedDebt);
    t.deepEqual(totalDebtFromPool, expected.totalDebt);
    if (expected.liquidationOccurredBefore) return;
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
      E(debtPoolManager).getTotalDebt(),
    ]);

    const closePayoutAmount = await E(protocolIssuer).getAmountOf(closePayout);

    t.is(closeOfferResult, 'your loan is closed, thank you for your business');
    t.is(state.value.loanState, LoanPhase.CLOSED);
    t.deepEqual(closePayoutAmount, expectedCollateralAmount);
    t.deepEqual(poolTotalDebt, expected.newTotalDebt);
  };

  /**
   * @param {PoolManager} poolManager
   * @param {UserSeat} redeemUserSeat
   * @param {{
   *   underlyingLiquidity: Amount,
   *   redeemAmount: Amount,
   *   borrowingRate: Ratio,
   *   exchangeRateNumerator: BigInt,
   * }} expected
   * @returns {Promise<void>}
   */
  const assertRedeemSuccessful = async (poolManager, redeemUserSeat, expected) => {
    /** @type {{underlyingIssuer: Issuer, protocolIssuer: Issuer}} */
    const { underlyingIssuer, protocolIssuer, exchangeRate, underlyingBrand, protocolBrand } = await getPoolMetadata(poolManager);

    const [
      redeemPayout,
      protocolPayout,
      redeemOfferResult,
      redeemCurrentAllocation,
    ] = await Promise.all([
      E(redeemUserSeat).getPayout("Underlying"),
      E(redeemUserSeat).getPayout("Protocol"),
      E(redeemUserSeat).getOfferResult(),
      E(redeemUserSeat).getCurrentAllocationJig(),
    ]);

    const [
      redeemAmount,
      protocolAmount,
      borrowingRate,
      underlyingLiquidity,
    ] = await Promise.all([
      E(underlyingIssuer).getAmountOf(redeemPayout),
      E(protocolIssuer).getAmountOf(protocolPayout),
      E(poolManager).getCurrentBorrowingRate(),
      E(poolManager).getUnderlyingLiquidity(),
    ]);

    const expectedExchangeRate = makeRatio(expected.exchangeRateNumerator, underlyingBrand, LARGE_DENOMINATOR, protocolBrand);

    t.is(redeemOfferResult, 'Success, thanks for doing business with us');
    t.deepEqual(redeemAmount , expected.redeemAmount);
    t.deepEqual(borrowingRate , expected.borrowingRate);
    t.deepEqual(exchangeRate, expectedExchangeRate);
    t.deepEqual(protocolAmount, AmountMath.makeEmpty(protocolBrand));
    t.deepEqual(underlyingLiquidity, expected.underlyingLiquidity);
  };

  /**
   *
   * @param {PoolManager} debtPoolManager
   * @param {WrappedLoan} loan
   * @param {{
   *   debtAmount: Amount,
   *   initialLiquidityBeforeLoan: Amount,
   *   totalDebt: Amount,
   *   borrowRate: Ratio,
   *   exchangeRateNumerator: BigInt,
   *   initialColUnderlyingVal: BigInt,
   * }} expected
   * @returns {Promise<void>}
   */
  const assertLiquidation = async (debtPoolManager, loan, expected) => {
    const {
      exchangeRate: debtExchangeRate,
      underlyingBrand: debtUnderlyingBrand,
      protocolBrand: debtProtocolBrand,
    } = await getPoolMetadata(debtPoolManager);
    // Get the latest state
    const { value: { loanState } } = await E(E(loan).getNotifier()).getUpdateSince();
    const expectedExchangeRate = makeRatio(expected.exchangeRateNumerator, debtUnderlyingBrand, LARGE_DENOMINATOR, debtProtocolBrand);

    const [
      currentLiquidity, totalDebt, borrowingRate, collatelralLeftAsProtocol,
      loanDebt, loanCollateralUnderlyingAmount] = await Promise.all([
      E(debtPoolManager).getUnderlyingLiquidity(),
      E(debtPoolManager).getTotalDebt(),
      E(debtPoolManager).getCurrentBorrowingRate(),
      E(loan).getCollateralAmount(),
      E(loan).getCurrentDebt(),
      E(loan).getCollateralUnderlyingAmount(),
    ]);

    t.is(loanState, LoanPhase.LIQUIDATED);
    t.truthy(AmountMath.isGTE(currentLiquidity, expected.initialLiquidityBeforeLoan));
    t.truthy(AmountMath.isEmpty(collatelralLeftAsProtocol));
    t.truthy(AmountMath.isEmpty(loanDebt));
    t.truthy(!AmountMath.isEmpty(loanCollateralUnderlyingAmount));
    t.deepEqual(borrowingRate, expected.borrowRate);
    t.truthy(ratioGTE(debtExchangeRate, expectedExchangeRate));
    t.deepEqual(totalDebt, expected.totalDebt);
  };

  /**
   *
   * @param {WrappedLoan} loan
   * @returns {Promise<void>}
   */
  const assertActiveLoan = async (loan) => {

    const [{ value: { loanState } }, loanDebt, loanCollatelrel, loanColUnderlying] = await Promise.all([
        E(E(loan).getNotifier()).getUpdateSince(),
        E(loan).getCurrentDebt(),
        E(loan).getCollateralAmount(),
        E(loan).getCollateralUnderlyingAmount(),
      ],
    );

    t.deepEqual(loanState, LoanPhase.ACTIVE);
    t.truthy(!AmountMath.isEmpty(loanDebt));
    t.truthy(!AmountMath.isEmpty(loanCollatelrel));
    t.truthy(AmountMath.isEmpty(loanColUnderlying));
  };

  const assertGovTokenInitializedCorrectly = async () => {
    const { farZoeKit: { /** @type ZoeService */ zoe } } = t.context;
    const [{
      governance: {
        units,
        decimals,
      },
    }, govBrand, govBalance, actualTotalSupply] = await Promise.all([
      E(zoe).getTerms(lendingPoolInstance),
      E(lendingPoolPublicFacet).getGovernanceBrand(),
      E(lendingPoolPublicFacet).getGovBalance(),
      E(lendingPoolPublicFacet).getTotalSupply(),

    ]);

    const expectedTotalSupply = AmountMath.make(govBrand, units * 10n ** BigInt(decimals));

    t.deepEqual(expectedTotalSupply, govBalance);
    t.deepEqual(expectedTotalSupply, actualTotalSupply);
  };

  const assertGovFetchedCorrectly = async (userSeatP, { keyword, expectedBalanceValue, expectedSupplyValue }) => {
    const govIssuerP = E(lendingPoolPublicFacet).getGovernanceIssuer();
    const offerResult = await E(userSeatP).getOfferResult();

    const [govBalance, payout, govBrand] = await Promise.all([
      E(lendingPoolPublicFacet).getGovBalance(),
      E(userSeatP).getPayout(keyword),
      E(lendingPoolPublicFacet).getGovernanceBrand(),
    ]);

    const receivedAmount = await E(govIssuerP).getAmountOf(payout);
    const expectedBalanceAmount = AmountMath.make(govBrand, expectedBalanceValue);
    const expectedSupplyAmount = AmountMath.make(govBrand, expectedSupplyValue);

    t.deepEqual(offerResult, 'Thanks for participating in the protocol governance');
    t.deepEqual(expectedBalanceAmount, govBalance);
    t.deepEqual(expectedSupplyAmount, receivedAmount);
  }

  const assertCollateralBalance = async (colPoolMan, balanceValueExpected) => {
    const protocolBrand = await E(colPoolMan).getProtocolBrand();
    const balanceAmountExpected = AmountMath.make(protocolBrand, balanceValueExpected);

    const actualBalance = await E(lendingPoolPublicFacet).getCollateralBalance(protocolBrand);

    t.deepEqual(actualBalance, balanceAmountExpected);
  };

  /**
   *
   * @param {UserSeat} userSeat
   * @param {PoolManager} poolManager
   * @param {String} keyword
   * @param value
   * @param {Number} updateCount
   */
  const assertParameterUpdatedCorrectly = async ({ userSeat, poolManager }, { keyword, value, updateCount }) => {

    const [offerResult, { underlyingBrand }] = await Promise.all([
      E(userSeat).getOfferResult(),
      getPoolMetadata(poolManager),
    ]);

    const subscriptionP = E(lendingPoolPublicFacet).getParamsSubscription(underlyingBrand);
    const state = await getLatestUpdateFromSubscriber(subscriptionP, updateCount);

    t.log('STATE', state);
    t.is(state[keyword].value, value);
    t.deepEqual(offerResult, 'Params successfully updated!');
  };

  return harden({
    assertPoolAddedCorrectly,
    assertDepositedCorrectly,
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertInterestCharged,
    assertAdjustBalancesSuccessful,
    assertLoanClosedCorrectly,
    assertRedeemSuccessful,
    assertLiquidation,
    assertActiveLoan,
    assertGovTokenInitializedCorrectly,
    assertGovFetchedCorrectly,
    assertCollateralBalance,
    assertParameterUpdatedCorrectly,
  })
}