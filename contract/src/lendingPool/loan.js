// @ts-check
import '@agoric/zoe/exported.js';

import { E } from '@endo/far';
import {
  assertProposalShape,
  getAmountOut,
  makeRatioFromAmounts,
  floorMultiplyBy,
  floorDivideBy,
} from '@agoric/zoe/src/contractSupport/index.js';

import { assert } from '@agoric/assert';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';
import { makeTracer } from '@agoric/inter-protocol/src/makeTracer.js';
import {
  calculateCurrentDebt,
  reverseInterest,
} from '@agoric/inter-protocol/src/interest-math.js';
import { makeLoanKit } from './loanKit.js';
import {
  assertDebtDeltaNotZero,
  assertOnlyKeys,
  assertBalancesHookArgs,
} from './assertionHelper.js';

const { details: X, quote: q } = assert;

const trace = makeTracer('IV');

/**
 * Constants for loan phase. The states for a loan is very similar to the ones for vaults but
 * in lendinPool we don't support transfering of the laons.
 *
 * ACTIVE       - loan is in use and can be changed
 * LIQUIDATING  - loan is being liquidated by the loan manager, and cannot be changed by the user
 * CLOSED       - loan was closed by the user and all assets have been paid out
 * LIQUIDATED   - loan was closed by the manager, with remaining assets paid to owner
 */
export const LoanPhase = /** @type {Object} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
});

/**
 * @typedef {LoanPhase[keyof Omit<typeof LoanPhase, 'TRANSFER'>]} InnerPhase
 * @type {{[K in InnerPhase]: Array<InnerPhase>}}
 */
const validTransitions = {
  [LoanPhase.ACTIVE]: [LoanPhase.LIQUIDATING, LoanPhase.CLOSED],
  [LoanPhase.LIQUIDATING]: [LoanPhase.LIQUIDATED],
  [LoanPhase.LIQUIDATED]: [LoanPhase.CLOSED],
  [LoanPhase.CLOSED]: [],
};
// TODO need to take a look at the type definitions

/**
 * This the module where most of the logic for loans is implemented. It contains
 * some directly copy/paste code for utility operations from `vault.js` from the VaultFactory. We'd have
 * love to use those methods by importing them but unfortunately none of those
 * methods are exported and it is not possible to use vault directly in our protocol
 * since the internal logic for a vault is different from a LendingPool loan. The problem
 * would be solved if we could just override the vault.js but the security specifications
 * of Agoric do not let us do that as far as we are concerned.
 *
 * @param {ZCF} zcf
 * @param {ManagerFacet} manager
 * @param {Notifier<AssetState>} assetNotifier
 * @param {string} idInManager
 * @param {Brand} debtBrand
 * @param {Brand} collateralUnderlyingBrand
 * @param {ERef<PriceAuthority>} debtPriceAuthority
 * @param {ERef<PriceAuthority>} collateralPriceAuthority
 */
export const makeInnerLoan = (
  zcf,
  manager,
  assetNotifier,
  idInManager,
  debtBrand,
  collateralUnderlyingBrand,
  debtPriceAuthority,
  collateralPriceAuthority,
) => {
  const collateralBrand = manager.getCollateralBrand();
  console.log('makeInnerLoan');
  /**
   * State object to support virtualization when available
   */
  const state = {
    assetNotifier,
    idInManager,
    manager,
    outerUpdater: null,
    loanKey: null,
    phase: LoanPhase.ACTIVE,
    debtPriceAuthority,
    collateralPriceAuthority,
    zcf,
    loanSeat: zcf.makeEmptySeatKit().zcfSeat,
    interestSnapshot: manager.getCompoundedInterest(),
    debtSnapshot: AmountMath.makeEmpty(debtBrand),
    collateralUnderlyingBrand,
  };

  // #region Phase logic
  /**
   * @param {InnerPhase} newPhase
   */
  const assignPhase = newPhase => {
    const { phase } = state;
    const validNewPhases = validTransitions[phase];
    assert(
      validNewPhases.includes(newPhase),
      `Loan cannot transition from ${phase} to ${newPhase}`,
    );
    state.phase = newPhase;
  };

  const assertActive = () => {
    const { phase } = state;
    assert(phase === LoanPhase.ACTIVE);
  };

  const assertCloseable = () => {
    const { phase } = state;
    assert(
      phase === LoanPhase.ACTIVE || phase === LoanPhase.LIQUIDATED,
      X`to be closed a loan must be active or liquidated, not ${phase}`,
    );
  };
  // #endregion

  /**
   * Called whenever the debt is paid or created through a transaction,
   * but not for interest accrual.
   *
   * @param {Amount} newDebt - principal and all accrued interest
   */
  const updateDebtSnapshot = newDebt => {
    state.debtSnapshot = newDebt;
    state.interestSnapshot = manager.getCompoundedInterest();
  };

  /**
   * @param {Amount<'nat'>} oldDebt - prior principal and all accrued interest
   * @param {Amount<'nat'>} newDebt - actual principal and all accrued interest
   */
  const updateDebtAccounting = (oldDebt, newDebt) => {
    updateDebtSnapshot(newDebt);

    assertDebtDeltaNotZero(oldDebt, newDebt);
    manager.applyDebtDelta(oldDebt, newDebt);

    state.loanKey = manager.refreshLoanPriorityByKey(
      state.loanKey,
      idInManager,
    );
  };

  /**
   * The actual current debt, including accrued interest.
   *
   * This looks like a simple getter but it does a lot of the heavy lifting for
   * interest accrual. Rather than updating all records when interest accrues,
   * the loan manager updates just its rolling compounded interest. Here we
   * calculate what the current debt is given what's recorded in this loan and
   * what interest has compounded since this loan record was written.
   *
   * @see getNormalizedDebt
   * @returns {Amount<'nat'>}
   */
  const getCurrentDebt = () => {
    return calculateCurrentDebt(
      state.debtSnapshot,
      state.interestSnapshot,
      manager.getCompoundedInterest(),
    );
  };

  /**
   * The normalization puts all debts on a common time-independent scale since
   * the launch of this loan manager. This allows the manager to order loans
   * by their debt-to-collateral ratios without having to mutate the debts as
   * the interest accrues.
   *
   * @see getActualDebAmount
   * @returns {Amount<'nat'>} as if the loan was open at the launch of this manager, before any interest accrued
   */
  const getNormalizedDebt = () => {
    return reverseInterest(state.debtSnapshot, state.interestSnapshot);
  };

  const getCollateralAllocated = seat => {
    console.log('collateralBrand', collateralBrand);
    return seat.getAmountAllocated('Collateral', collateralBrand);
  };

  const getCollateralUnderlyingAllocated = seat => {
    return seat.getAmountAllocated('CollateralUnderlying', collateralUnderlyingBrand);
  };

  const getDebtAllocated = seat => seat.getAmountAllocated('Debt', debtBrand);

  const assertLoanHoldsNoRun = () => {
    const { loanSeat } = state;
    assert(
      AmountMath.isEmpty(getDebtAllocated(loanSeat)),
      X`Loan should be empty of RUN`,
    );
  };

  /**
   * @param {Amount} collateralAmount
   * @param {Ratio} exchangeRate
   * @returns {Promise<*>}
   */
  const maxDebtFor = async (collateralAmount, exchangeRate) => {
    console.log('maxDebtFor: exchangeRate', exchangeRate);
    const correspondingUnderlyingCollateral = floorMultiplyBy(
      collateralAmount,
      exchangeRate,
    );
    const quoteAmount = await E(collateralPriceAuthority).quoteGiven(
      correspondingUnderlyingCollateral,
      manager.getThirdCurrencyBrand(),
    );
    // floorDivide because we want the debt ceiling lower
    return floorDivideBy(
      getAmountOut(quoteAmount),
      manager.getLiquidationMargin(),
    );
  };

  /**
   * @param {Amount} proposedUnderlyingDebt
   * @returns {Promise<undefined>}
   */
  const getRequestedDebtValue = async proposedUnderlyingDebt => {
    const quoteAmount = await E(debtPriceAuthority).quoteGiven(
      proposedUnderlyingDebt,
      manager.getThirdCurrencyBrand(),
    );
    return quoteAmount;
  };

  /**
   * @param {Amount} collateralAmount - Should be a protocolToken
   * @param {Amount} proposedUnderlyingDebt - Should be in the underlying brand of this pool
   * @param {Ratio} exchangeRate - The exchange rate between the protocolToken presented
   * as collateral and the underlying asset of that protocolToken
   * @returns {Promise<*>}
   */
  const assertSufficientCollateral = async (
    collateralAmount,
    proposedUnderlyingDebt,
    exchangeRate,
  ) => {
    const maxDebtValueAmount = await maxDebtFor(collateralAmount, exchangeRate);
    const requestedDebtQuote = await getRequestedDebtValue(
      proposedUnderlyingDebt,
    );
    assert(
      AmountMath.isGTE(
        maxDebtValueAmount,
        getAmountOut(requestedDebtQuote),
        manager.getThirdCurrencyBrand(),
      ),
      X`Requested ${q(proposedUnderlyingDebt)} exceeds max ${q(
        maxDebtValueAmount,
      )}`,
    );
  };

  /**
   *
   * @returns {Amount<'nat'>}
   */
  const getCollateralAmount = () => {
    const { loanSeat, phase } = state;
    console.log('loanSeatAllocations', loanSeat.getCurrentAllocation());
    console.log('Phase', phase);
    console.log('Exited', loanSeat.hasExited());
    // getCollateralAllocated would return final allocations
    return loanSeat.hasExited()
      ? AmountMath.makeEmpty(collateralBrand)
      : getCollateralAllocated(loanSeat);
  };

  /**
   *
   * @returns {Amount<'nat'>}
   */
  const getCollateralUnderlyingAmount = () => {
    const { loanSeat, phase } = state;
    console.log("loanSeatAllocations", loanSeat.getCurrentAllocation());
    console.log("Phase", phase);
    console.log("Exited", loanSeat.hasExited());

    return loanSeat.hasExited()
      ? AmountMath.makeEmpty(collateralBrand)
      : getCollateralUnderlyingAllocated(loanSeat);
  };

  const snapshotState = newPhase => {
    const {
      debtSnapshot: debt,
      interestSnapshot: interest,
      collateralUnderlyingBrand,
    } = state;

    return harden({
      liquidationRatio: manager.getLiquidationMargin(),
      debtSnapshot: { debt, interest },
      locked: getCollateralAmount(),
      loanState: newPhase,
      collateralUnderlyingBrand,
    });
  };

  const updateUiState = () => {
    const { outerUpdater } = state;
    if (!outerUpdater) {
      console.warn('updateUiState called after outerUpdater removed');
      return;
    }
    const { phase } = state;
    const uiState = snapshotState(phase);
    trace('updateUiState', uiState);

    switch (phase) {
      case LoanPhase.ACTIVE:
      case LoanPhase.LIQUIDATING:
        outerUpdater.updateState(uiState);
        break;
      case LoanPhase.CLOSED:
      case LoanPhase.LIQUIDATED:
        outerUpdater.finish(uiState);
        state.outerUpdater = null;
        break;
      default:
        throw Error(`unreachable loan phase: ${phase}`);
    }
  };

  /**
   * Call must check for and remember shortfall
   *
   * @param {Amount} newDebt
   */
  const liquidated = newDebt => {
    updateDebtSnapshot(newDebt);

    assignPhase(LoanPhase.LIQUIDATED);
    updateUiState();
  };

  const liquidating = () => {
    assignPhase(LoanPhase.LIQUIDATING);
    updateUiState();
  };

  /**
   * @type {OfferHandler}
   * */
  const closeHook = async seat => {
    assertCloseable();
    const { phase, loanSeat } = state;
    const proposal = seat.getProposal();
    const currentDebt = getCurrentDebt();
    if (phase === LoanPhase.ACTIVE) {
      assertProposalShape(seat, {
        give: { Debt: null },
        want: { Collateral: null },
      });

      // you're paying off the debt, you get everything back. If you were
      // underwater, we should have liquidated some collateral earlier: we
      // missed our chance.
      const {
        give: { Debt: debtOffered },
      } = proposal;

      // you must pay off the entire remainder but if you offer too much, we won't
      // take more than you owe
      assert(
        AmountMath.isGTE(debtOffered, currentDebt),
        X`Offer ${debtOffered} is not sufficient to pay off debt ${currentDebt}`,
      );

      // Return any overpayment
      seat.incrementBy(
        loanSeat.decrementBy(
          harden({ Collateral: getCollateralAllocated(loanSeat) }),
        ),
      );
      manager.stageUnderlyingAllocation(proposal);
      seat.decrementBy(harden({ Debt: currentDebt }));
      manager.reallocateBetweenSeats(seat, loanSeat);
    } else if (phase === LoanPhase.LIQUIDATED) {
      // Simply reallocate loan assets to the offer seat.
      // Don't take anything from the offer, even if loan is underwater.
      seat.incrementBy(loanSeat.decrementBy(loanSeat.getCurrentAllocation()));
      zcf.reallocate(seat, loanSeat);
    } else {
      throw new Error('only active and liquidated loans can be closed');
    }

    seat.exit();
    assignPhase(LoanPhase.CLOSED);
    updateDebtAccounting(currentDebt, AmountMath.makeEmpty(debtBrand));
    updateUiState();

    assertLoanHoldsNoRun();
    loanSeat.exit();

    return 'your loan is closed, thank you for your business';
  };

  const makeCloseInvitation = () => {
    assertCloseable();
    return zcf.makeInvitation(closeHook, 'CloseLoan');
  };

  /**
   * Calculate the target level for Collateral for the loanSeat and
   * clientSeat implied by the proposal. If the proposal wants Collateral,
   * transfer that amount from loan to client. If the proposal gives
   * Collateral, transfer the opposite direction. Otherwise, return the current level.
   *
   * @param seat
   * @returns {{loan, client}|{loan: Amount<'nat'>, client: Amount<'nat'>}}
   */
  const targetCollateralLevels = seat => {
    const { loanSeat } = state;
    const proposal = seat.getProposal();
    const startLoanAmount = getCollateralAllocated(loanSeat);
    const startClientAmount = getCollateralAllocated(seat);
    if (proposal.want.Collateral) {
      return {
        loan: AmountMath.subtract(startLoanAmount, proposal.want.Collateral),
        client: AmountMath.add(startClientAmount, proposal.want.Collateral),
      };
    } else if (proposal.give.Collateral) {
      return {
        loan: AmountMath.add(startLoanAmount, proposal.give.Collateral),
        client: AmountMath.subtract(
          startClientAmount,
          proposal.give.Collateral,
        ),
      };
    } else {
      return {
        loan: startLoanAmount,
        client: startClientAmount,
      };
    }
  };

  /**
   * Stage the collateral on the seats according to the proposal
   * @param {ZCFSeat} seat
   */
  const transferCollateral = seat => {
    const { loanSeat } = state;
    const proposal = seat.getProposal();
    if (proposal.want.Collateral) {
      seat.incrementBy(
        loanSeat.decrementBy(harden({ Collateral: proposal.want.Collateral })),
      );
    } else if (proposal.give.Collateral) {
      loanSeat.incrementBy(
        seat.decrementBy(harden({ Collateral: proposal.give.Collateral })),
      );
    }
  };

  /**
   * Calculate the target Debt level for the loanSeat and clientSeat implied
   * by the proposal. If the proposal wants debt, transfer that amount
   * from loan to client. If the proposal gives debt, transfer the
   * opposite direction. Otherwise, return the current level.
   *
   * Since we don't allow the debt to go negative, we will reduce the amount we
   * accept when the proposal says to give more Debt than are owed.
   *
   * @param {ZCFSeat} seat
   * @returns {{loan: Amount, client: Amount}}
   */
  const targetDebtLevels = seat => {
    const clientAllocation = getDebtAllocated(seat);
    const proposal = seat.getProposal();
    if (proposal.want.Debt) {
      return {
        loan: AmountMath.makeEmpty(debtBrand),
        client: AmountMath.add(clientAllocation, proposal.want.Debt),
      };
    } else if (proposal.give.Debt) {
      const currentDebt = getCurrentDebt();
      const acceptedDebt = AmountMath.isGTE(proposal.give.Debt, currentDebt)
        ? currentDebt
        : proposal.give.Debt;

      return {
        loan: acceptedDebt,
        client: AmountMath.subtract(clientAllocation, acceptedDebt),
      };
    } else {
      return {
        loan: AmountMath.makeEmpty(debtBrand),
        client: clientAllocation,
      };
    }
  };

  /**
   * Calculate the fee, the amount to mint and the resulting debt
   *
   * @param {ProposalRecord} proposal
   * @param {{loan: Amount, client: Amount}} debtAfter
   */
  const calculateNewDebt = (proposal, debtAfter) => {
    let newDebt;
    const currentDebt = getCurrentDebt();
    if (proposal.want.Debt) {
      newDebt = AmountMath.add(currentDebt, proposal.want.Debt);
    } else if (proposal.give.Debt) {
      newDebt = AmountMath.subtract(currentDebt, debtAfter.loan);
    } else {
      newDebt = currentDebt;
    }
    return newDebt;
  };

   /**
   * Return the max debt supported by current Collateral as modified by proposal
   */
  const getMaxDebtByCollateral = async (targetCollateralAmount, targetDebtAmount) => {
    const oldUpdater = state.outerUpdater;
    const [
      maxDebtForOriginalTarget,
      requestedQuoteInCompareBrand,
    ] = await Promise.all([
      maxDebtFor(
        targetCollateralAmount,
        manager.getExchangeRateForPool(collateralUnderlyingBrand),
      ),
      E(debtPriceAuthority).quoteGiven(
        targetDebtAmount,
        manager.getThirdCurrencyBrand(),
      ),
    ]);
    const requestedDebtInCompareBrand = getAmountOut(
      requestedQuoteInCompareBrand,
    );

    assert(
      oldUpdater === state.outerUpdater,
      X`Transfer during loan adjustment`,
    );
    assertActive();

    const priceOfCollateralInCompareBrand = makeRatioFromAmounts(
      maxDebtForOriginalTarget,
      targetCollateralAmount,
    );

    return {
      maxDebtForOriginalTarget,
      requestedDebtInCompareBrand,
      priceOfCollateralInCompareBrand,
    };
  };

  /**
   * Allow loan holders to adjust their loans by,
   * - Let them borrow more money
   * - Let them pay their debt
   * - Let them put some more collateral and borrow some more money
   *
   * Logic here is very similar to the one in vault.js of VaultFactory.
   * But we've adjuted it for our scenario.
   *
   * @param {ZCFSeat} clientSeat
   * @param {Object} offerArgs
   */
  const adjustBalancesHook = async (clientSeat, offerArgs) => {
    assertBalancesHookArgs(offerArgs);

    const collateralUnderlyingBrand = offerArgs.collateralUnderlyingBrand;
    const oldUpdater = state.outerUpdater;
    const proposal = clientSeat.getProposal();
    const oldDebt = getCurrentDebt();

    trace('adjustBalancesHook: proposal', proposal);
    assertOnlyKeys(proposal, ['Collateral', 'Debt']);

    const targetCollateralAmount = targetCollateralLevels(clientSeat).loan;
    const targetDebtAmount = targetDebtLevels(clientSeat).client;

    const {
      maxDebtForOriginalTarget,
      requestedDebtInCompareBrand,
      priceOfCollateralInCompareBrand,
    } = await getMaxDebtByCollateral(targetCollateralAmount, targetDebtAmount);

    // After the AWAIT, we retrieve the loan's allocations again.
    const collateralAfter = targetCollateralLevels(clientSeat);
    const debtAfter = targetDebtLevels(clientSeat);
    const newDebt = calculateNewDebt(proposal, debtAfter);

    // Get new balances after calling the priceAuthority, so we can compare
    // to the debt limit based on the new values.
    const loanCollateral =
      collateralAfter.loan || AmountMath.makeEmpty(collateralBrand);

    trace('adjustBalancesHook', {
      targetCollateralAmount,
      loanCollateral,
      requestedDebtInCompareBrand,
      targetDebtAmount,
      newDebt,
    });

    // If the collateral decreased after the await, we pro-rate maxDebt
    if (AmountMath.isGTE(targetCollateralAmount, loanCollateral)) {
      // We can pro-rate maxDebt because the quote is either linear (price is
      // unchanging) or super-linear (meaning it's an AMM. When the volume sold
      // falls, the proceeds fall less than linearly, so this is a conservative
      // choice.) floorMultiply because the debt ceiling should constrain more.
      const maxDebtAfter = floorMultiplyBy(
        loanCollateral,
        priceOfCollateralInCompareBrand,
      );
      assert(
        AmountMath.isGTE(maxDebtAfter, requestedDebtInCompareBrand),
        X`The requested debt ${q(
          requestedDebtInCompareBrand,
        )} is more than the collateralization ratio allows: ${q(maxDebtAfter)}`,
      );

    } else if (
      // When the re-checked collateral was larger than the original amount, we
      // should restart, unless the new debt is less than the original target
      // (in which case, we're fine to proceed with the reallocate)
      !AmountMath.isGTE(maxDebtForOriginalTarget, requestedDebtInCompareBrand)
    ) {
      return adjustBalancesHook(clientSeat);
    }

    const { loanSeat } = state;
    transferCollateral(clientSeat);
    manager.transferDebt(clientSeat, getCurrentDebt());
    manager.reallocateBetweenSeats(loanSeat, clientSeat);

    updateDebtAccounting(oldDebt, newDebt);

    updateUiState();
    clientSeat.exit();

    return 'We have adjusted your balances, thank you for your business';
  };

  const makeAdjustBalancesInvitation = () => {
    assertActive();
    return zcf.makeInvitation(adjustBalancesHook, 'AdjustBalances');
  };

  /**
   * @param {ZCFSeat} borrowerSeat
   * @param {ZCFSeat} poolSeat
   * @param {Loan} loan
   * @param {Ratio} exchangeRate
   * @param {String} loanKey
   * @returns {Promise<LoanKit>}
   */
  const initLoanKit = async (
    borrowerSeat,
    poolSeat,
    loan,
    exchangeRate,
    loanKey,
  ) => {
    assert(
      AmountMath.isEmpty(state.debtSnapshot),
      X`loan must be empty initially`,
    );
    const oldDebt = getCurrentDebt();
    const oldCollateral = getCollateralAmount();
    trace('initLoanKit start: collateral', { oldDebt, oldCollateral });

    // get the payout to provide access to the collateral if the
    // contract abandons
    const {
      give: { Collateral: collateralAmount },
      want: { Debt: proposedDebtAmount },
    } = borrowerSeat.getProposal();

    trace('initLoanKit', {
      collateralAmount,
      proposedDebtAmount,
      currentAllocation: poolSeat.getCurrentAllocation(),
    });

    await assertSufficientCollateral(
      collateralAmount,
      proposedDebtAmount,
      exchangeRate,
    );

    const { loanSeat } = state;

    const underlyingKeywordRecord = poolSeat.decrementBy(
      harden({ Underlying: proposedDebtAmount }),
    );
    borrowerSeat.incrementBy(
      harden({ Debt: underlyingKeywordRecord.Underlying }),
    );
    loanSeat.incrementBy(
      borrowerSeat.decrementBy(harden({ Collateral: collateralAmount })),
    );
    zcf.reallocate(borrowerSeat, loanSeat, poolSeat);

    const loanKit = makeLoanKit(innerLoan, state.assetNotifier);
    state.outerUpdater = loanKit.loanUpdater;
    state.loanKey = loanKey;
    updateDebtAccounting(oldDebt, proposedDebtAmount);
    updateUiState();

    return loanKit;
  };

  /** @type Loan */
  const innerLoan = Far('innerLoan', {
    getLoanSeat: () => state.loanSeat,
    getPhase: () => state.phase,
    initLoanKit: (seat, poolSeat, exchangeRate, loanKey) =>
      initLoanKit(seat, poolSeat, innerLoan, exchangeRate, loanKey),
    liquidating,
    liquidated,
    makeAdjustBalancesInvitation,
    makeCloseInvitation,
    getCollateralAmount,
    getCollateralUnderlyingAmount,
    getCurrentDebt,
    getNormalizedDebt,
  });

  return innerLoan;
};
