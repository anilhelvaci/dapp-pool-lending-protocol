// @ts-check
import '@agoric/zoe/exported.js';

import { E } from '@agoric/eventual-send';
import {
  assertProposalShape,
  getAmountOut,
  makeRatioFromAmounts,
  ceilMultiplyBy,
  floorMultiplyBy,
  floorDivideBy,
} from '@agoric/zoe/src/contractSupport/index.js';

import { assert } from '@agoric/assert';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';
import { makeTracer } from '../makeTracer.js';
import { calculateCurrentDebt, reverseInterest } from '../interest-math.js';
import { makeLoanKit } from './loanKit.js';

const { details: X, quote: q } = assert;

const trace = makeTracer('IV');

/**
 * @file This has most of the logic for a Loan, to borrow RUN against collateral.
 *
 * The logic here is for InnerLoan which is the majority of logic of loans but
 * the user view is the `Loan` value contained in LoanKit.
 */

/**
 * Constants for loan phase.
 *
 * ACTIVE       - loan is in use and can be changed
 * LIQUIDATING  - loan is being liquidated by the loan manager, and cannot be changed by the user
 * TRANSFER     - loan is able to be transferred (payments and debits frozen until it has a new owner)
 * CLOSED       - loan was closed by the user and all assets have been paid out
 * LIQUIDATED   - loan was closed by the manager, with remaining assets paid to owner
 */
export const LoanPhase = /** @type {const} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
  TRANSFER: 'transfer',
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
 * @typedef {LoanPhase[keyof typeof LoanPhase]} OuterPhase
 *
 * @typedef {Object} LoanUIState
 * @property {Amount<NatValue>} locked Amount of Collateral locked
 * @property {{run: Amount<NatValue>, interest: Ratio}} debtSnapshot Debt of 'run' at the point the compounded interest was 'interest'
 * @property {Ratio} interestRate Annual interest rate charge
 * @property {Ratio} liquidationRatio
 * @property {OuterPhase} loanState
 */

/**
 * @typedef {Object} InnerLoanManagerBase
 * @property {(oldDebt: Amount, newDebt: Amount) => void} applyDebtDelta
 * @property {() => Brand} getCollateralBrand
 * @property {() => void} reallocateBetweenSeats
 * @property {() => Ratio} getCompoundedInterest - coefficient on existing debt to calculate new debt
 * @property {(oldDebt: Amount, oldCollateral: Amount, loanId: LoanId) => void} updateLoanPriority
 * @property {() => Brand} getThirdCurrencyBrand
 * @property {(seat: ZCFSeat, currentDebt: Amount) => void} transferDebt
 * @property {(brand: Brand) => Ratio} getExchangeRateForPool
 * @property {(proposal: Proposal) => void} stageUnderlyingAllocation
 */

/**
 * @typedef {Readonly<{
 * assetNotifier: Notifier<import('./poolManager.js').AssetState>,
 * idInManager: LoanId,
 * manager: InnerLoanManagerBase & GetLoanParams,
 * priceAuthority: ERef<PriceAuthority>,
 * mint: ZCFMint,
 * loanSeat: ZCFSeat,
 * zcf: ContractFacet,
 * }>} ImmutableState
 */

/**
 * Snapshot is of the debt and compounded interest when the principal was last changed.
 *
 * @typedef {{
 * interestSnapshot: Ratio,
 * outerUpdater: IterationObserver<LoanUIState> | null,
 * phase: InnerPhase,
 * debtSnapshot: Amount<NatValue>,
 * }} MutableState
 */

/**
 * @param {ContractFacet} zcf
 * @param {InnerLoanManagerBase & GetLoanParams} manager
 * @param {Notifier<import('./poolManager.js').AssetState>} assetNotifier
 * @param {LoanId} idInManager
 * @param {Brand} debtBrand
 * @param {ERef<PriceAuthority>} debtPriceAuthority
 * @param {ERef<PriceAuthority>} collateralPriceAuthority
 */
export const makeInnerLoan = (
  zcf,
  manager,
  assetNotifier,
  idInManager,
  debtBrand,
  debtPriceAuthority,
  collateralPriceAuthority
) => {
  // CONSTANTS
  const collateralBrand = manager.getCollateralBrand();
  // const { brand: debtBrand } = mint.getIssuerRecord();
  console.log("makeInnerLoan")
  /**
   * State object to support virtualization when available
   *
   * @type {ImmutableState & MutableState}
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
    // mint,
    zcf,

    // loanSeat will hold the collateral until the loan is retired. The
    // payout from it will be handed to the user: if the loan dies early
    // (because the loanFactory vat died), they'll get all their
    // collateral back. If that happens, the issuer for the RUN will be dead,
    // so their loan will be worthless.
    loanSeat: zcf.makeEmptySeatKit().zcfSeat,

    // Two values from the same moment
    interestSnapshot: manager.getCompoundedInterest(),
    /** @type {any} cast */
    debtSnapshot: AmountMath.makeEmpty(debtBrand),
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
    // update local state
    // @ts-expect-error newDebt is actually Amount<NatValue>
    state.debtSnapshot = newDebt;
    state.interestSnapshot = manager.getCompoundedInterest();
  };

  /**
   * @param {Amount} oldDebt - prior principal and all accrued interest
   * @param {Amount} newDebt - actual principal and all accrued interest
   */
  const updateDebtAccounting = (oldDebt, newDebt) => {
    // const newDebt = AmountMath.add(oldDebt, targetDebt);
    updateDebtSnapshot(newDebt);
    // update loan manager which tracks total debt
    manager.applyDebtDelta(oldDebt, newDebt);
    // update position of this loan in liquidation priority queue
    // manager.refreshLoanPriority(getNormalizedDebt(), oldCollateral, idInManager);
    state.loanKey = manager.refreshLoanPriorityByKey(state.loanKey, idInManager);
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
   * @returns {Amount<NatValue>}
   */
  const getCurrentDebt = () => {
    return calculateCurrentDebt(
      state.debtSnapshot,
      state.interestSnapshot,
      manager.getCompoundedInterest(),
    );
  };

  const getCurrentDebtValueInCompareCurrencyForm = async () => {
    const currentDebt = getCurrentDebt();
    const quoteAmount = await E(debtPriceAuthority).quoteGiven(
      currentDebt,
      manager.getThirdCurrencyBrand(),
    );

    return getAmountOut(quoteAmount);
  }

  /**
   * The normalization puts all debts on a common time-independent scale since
   * the launch of this loan manager. This allows the manager to order loans
   * by their debt-to-collateral ratios without having to mutate the debts as
   * the interest accrues.
   *
   * @see getActualDebAmount
   * @returns {Amount<NatValue>} as if the loan was open at the launch of this manager, before any interest accrued
   */
  const getNormalizedDebt = () => {
    return reverseInterest(state.debtSnapshot, state.interestSnapshot);
  };

  const getCollateralAllocated = seat => {
    console.log("collateralBrand", collateralBrand)
    return seat.getAmountAllocated('Collateral', collateralBrand);
  }
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
    console.log("maxDebtFor: exchangeRate", exchangeRate);
    const correspondingUnderlyingCollateral = calculateCollateralUnderlyingIn(collateralAmount, exchangeRate);
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
   * @param {Amount} protocolCollateralAmount
   * @param {Ratio} exchangeRate
   */
  const calculateCollateralUnderlyingIn = (protocolCollateralAmount, exchangeRate) => {
    return floorMultiplyBy(
      protocolCollateralAmount,
      exchangeRate
    )
  };

  /**
   * @param {Amount} proposedUnderlyingDebt
   * @returns {Promise<undefined>}
   */
  const getRequestedDebtValue = async (proposedUnderlyingDebt) => {
    const quoteAmount = await E(debtPriceAuthority).quoteGiven(
      proposedUnderlyingDebt,
      manager.getThirdCurrencyBrand(),
    );
    return quoteAmount;
  }

  /**
   * @param {Amount} collateralAmount - Should be a protocolToken
   * @param {Amount} proposedUnderlyingDebt - Should be in the underlying brand of this pool
   * @param {Amount} exchangeRate - The exchange rate between the protocolToken presented
   * as collateral and the underlying asset of that protocolToken
   * @returns {Promise<*>}
   */
  const assertSufficientCollateral = async (
    collateralAmount,
    proposedUnderlyingDebt,
    exchangeRate
  ) => {
    const maxDebtValueAmount = await maxDebtFor(collateralAmount, exchangeRate);
    const requestedDebtQuote = await getRequestedDebtValue(proposedUnderlyingDebt);
    assert(
      AmountMath.isGTE(maxDebtValueAmount,
        getAmountOut(requestedDebtQuote),
        manager.getThirdCurrencyBrand()),
      X`Requested ${q(proposedUnderlyingDebt)} exceeds max ${q(maxDebtValueAmount)}`,
    );
  };

  /**
   *
   * @returns {Amount<NatValue>}
   */
  const getCollateralAmount = () => {
    const { loanSeat, phase } = state;
    console.log("loanSeatAllocations", loanSeat.getCurrentAllocation());
    console.log("Phase", phase);
    console.log("Exited", loanSeat.hasExited());
    // getCollateralAllocated would return final allocations
    return loanSeat.hasExited()
      ? AmountMath.makeEmpty(collateralBrand)
      : getCollateralAllocated(loanSeat);
  };

  const getCurrentCollateralValueInCompareCurrencyForm = async () => {
    const collateralAmount = getCollateralAmount();
    const quote = await E(debtPriceAuthority).quoteGiven(
      collateralAmount,
      manager.getThirdCurrencyBrand(),
    );

    return getAmountOut(quote);
  }

  /**
   *
   * @param {OuterPhase} newPhase
   */
  const snapshotState = newPhase => {
    const { debtSnapshot: debt, interestSnapshot: interest } = state;
    /** @type {LoanUIState} */
    return harden({
      // TODO move manager state to a separate notifer https://github.com/Agoric/agoric-sdk/issues/4540
      interestRate: manager.getCurrentBorrowingRate(),
      liquidationRatio: manager.getLiquidationMargin(),
      // XXX 'run' is implied by the brand in the amount
      debtSnapshot: { debt, interest },
      locked: getCollateralAmount(),
      // newPhase param is so that makeTransferInvitation can finish without setting the loan's phase
      // TODO refactor https://github.com/Agoric/agoric-sdk/issues/4415
      loanState: newPhase,
    });
  };

  // call this whenever anything changes!
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

  /** @type {OfferHandler} */
  const closeHook = async seat => {
    assertCloseable();
    const { phase, loanSeat } = state;
    const proposal = seat.getProposal();
    if (phase === LoanPhase.ACTIVE) {
      assertProposalShape(seat, {
        give: { Debt: null },
        want: { Collateral: null },
      });

      // you're paying off the debt, you get everything back. If you were
      // underwater, we should have liquidated some collateral earlier: we
      // missed our chance.
      const currentDebt = getCurrentDebt();
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
      seat.decrementBy(harden({ Debt: debtOffered }));
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
    updateDebtSnapshot(AmountMath.makeEmpty(debtBrand));
    updateUiState();

    assertLoanHoldsNoRun();
    loanSeat.exit();

    return 'your loan is closed, thank you for your business';
  };

  const makeCloseInvitation = () => {
    assertCloseable();
    return zcf.makeInvitation(closeHook, 'CloseLoan');
  };

  // The proposal is not allowed to include any keys other than these,
  // usually 'Collateral' and 'RUN'.
  const assertOnlyKeys = (proposal, keys) => {
    const onlyKeys = clause =>
      Object.getOwnPropertyNames(clause).every(c => keys.includes(c));

    assert(
      onlyKeys(proposal.give),
      X`extraneous terms in give: ${proposal.give}`,
    );
    assert(
      onlyKeys(proposal.want),
      X`extraneous terms in want: ${proposal.want}`,
    );
  };

  // Calculate the target level for Collateral for the loanSeat and
  // clientSeat implied by the proposal. If the proposal wants Collateral,
  // transfer that amount from loan to client. If the proposal gives
  // Collateral, transfer the opposite direction. Otherwise, return the current level.
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
   * by the proposal. If the proposal wants collateral, transfer that amount
   * from loan to client. If the proposal gives collateral, transfer the
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
      // We don't allow debt to be negative, so we'll refund overpayments
      // TODO this is the same as in `transferDebt`
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
      newDebt = AmountMath.add(proposal.want.Debt, currentDebt);
    } else if (proposal.give.Debt) {
      newDebt = AmountMath.subtract(currentDebt, debtAfter.loan);
    } else {
      newDebt = currentDebt;
    }
    return newDebt;
  };

  /**
   * Adjust principal and collateral (atomically for offer safety)
   *
   * @param {ZCFSeat} clientSeat
   * @param {Object} offerArgs
   */
  const adjustBalancesHook = async (clientSeat, offerArgs) => {
    assert(typeof offerArgs == 'object');
    assert(offerArgs.hasOwnProperty('collateralUnderlyingBrand'));
    const collateralUnderlyingBrand = offerArgs.collateralUnderlyingBrand;

    const oldUpdater = state.outerUpdater;
    const proposal = clientSeat.getProposal();
    const oldDebt = getCurrentDebt();
    console.log("adjustBalancesHook: proposal", proposal);
    assertOnlyKeys(proposal, ['Collateral', 'Debt']);
    const targetCollateralAmount = targetCollateralLevels(clientSeat).loan;
    const targetDebt = targetDebtLevels(clientSeat).client;
    // max debt supported by current Collateral as modified by proposal
    const [maxDebtForOriginalTarget, requestedQuoteInCompareBrand] =
      await Promise.all([
        maxDebtFor(targetCollateralAmount, manager.getExchangeRateForPool(collateralUnderlyingBrand)),
        E(debtPriceAuthority).quoteGiven(
          targetDebt,
          manager.getThirdCurrencyBrand(),
        )
      ]);
    const requestedDebtInCompareBrand = getAmountOut(requestedQuoteInCompareBrand);
    assert(
      oldUpdater === state.outerUpdater,
      X`Transfer during loan adjustment`,
    );
    assertActive();

    const priceOfCollateralInCompareBrand = makeRatioFromAmounts(
      maxDebtForOriginalTarget,
      targetCollateralAmount,
    );

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
      targetDebt,
      newDebt
    });

    // If the collateral decreased, we pro-rate maxDebt
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

      // When the re-checked collateral was larger than the original amount, we
      // should restart, unless the new debt is less than the original target
      // (in which case, we're fine to proceed with the reallocate)
    } else if (!AmountMath.isGTE(maxDebtForOriginalTarget, requestedDebtInCompareBrand)) {
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
   * @param {InnerLoan} innerLoan
   * @param {Ratio} exchangeRate
   * @param {String} loanKey
   */
  const initLoanKit = async (borrowerSeat, poolSeat, innerLoan, exchangeRate, loanKey) => {
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
    console.log('[COLLATERAL_AMOUNT]', collateralAmount);
    console.log('[DEBT_AMOUNT]', proposedDebtAmount);
    console.log('[POOL_SEAT]', poolSeat.getCurrentAllocation());

    await assertSufficientCollateral(collateralAmount, proposedDebtAmount, exchangeRate);

    const { loanSeat } = state;

    const underlyingKeywordRecord = poolSeat.decrementBy(harden({ Underlying: proposedDebtAmount }));
    borrowerSeat.incrementBy(harden({Debt: underlyingKeywordRecord.Underlying}));
    loanSeat.incrementBy(
      borrowerSeat.decrementBy(harden({ Collateral: collateralAmount })),
    );
    zcf.reallocate(borrowerSeat, loanSeat, poolSeat);

    const loanKit = makeLoanKit(innerLoan, state.assetNotifier);
    state.outerUpdater = loanKit.loanUpdater;
    updateUiState();
    state.loanKey = loanKey;
    updateDebtAccounting(oldDebt, proposedDebtAmount);

    return loanKit;
  };

  /**
   *
   * @param {ZCFSeat} seat
   * @returns {LoanKit}
   */
  const makeTransferInvitationHook = seat => {
    assertCloseable();
    seat.exit();
    // eslint-disable-next-line no-use-before-define
    const loanKit = makeLoanKit(innerLoan, state.assetNotifier);
    state.outerUpdater = loanKit.loanUpdater;
    updateUiState();

    return loanKit;
  };

  const innerLoan = Far('innerLoan', {
    getLoanSeat: () => state.loanSeat,

    initLoanKit: (seat, poolSeat, exchangeRate, loanKey) => initLoanKit(seat, poolSeat, innerLoan, exchangeRate, loanKey),
    liquidating,
    liquidated,

    makeAdjustBalancesInvitation,
    makeCloseInvitation,
    makeTransferInvitation: () => {
      const { outerUpdater } = state;
      if (outerUpdater) {
        outerUpdater.finish(snapshotState(LoanPhase.TRANSFER));
        state.outerUpdater = null;
      }
      return zcf.makeInvitation(makeTransferInvitationHook, 'TransferLoan');
    },

    // for status/debugging
    getCollateralAmount,
    getCurrentCollateralValueInCompareCurrencyForm,
    getCurrentDebt,
    getCurrentDebtValueInCompareCurrencyForm,
    getNormalizedDebt,
  });

  // return { innerLoan, testMethods: { maxDebtFor, assertSufficientCollateral } };
  return innerLoan
};

/** @typedef {ReturnType<typeof makeInnerLoan>} InnerLoan */
