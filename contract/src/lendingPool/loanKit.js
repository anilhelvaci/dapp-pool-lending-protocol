// @ts-check
import { makeNotifierKit } from '@agoric/notifier';
import '@agoric/zoe/exported.js';
import { Far } from '@endo/marshal';

const { details: X } = assert;

/**
 * @typedef {{
 * inner: InnerLoan | null,
 * }} State
 */
/**
 *
 * @param {InnerLoan} innerLoan
 */
const wrapLoan = innerLoan => {
  /** @type {NotifierRecord<LoanUIState>} */
  const { updater, notifier } = makeNotifierKit();

  /** @type {State} */
  const state = {
    inner: innerLoan,
  };

  // Throw if this wrapper no longer owns the inner loan
  const owned = v => {
    const { inner } = state;
    // console.log('OUTER', v, 'INNER', inner);
    assert(inner, X`Using ${v} after transfer`);
    return inner;
  };

  /**
   * Public API of the loan.
   *
   * @see {InnerLoan} for the internal API it wraps.
   */
  const loan = Far('loan', {
    getNotifier: () => notifier,
    makeAdjustBalancesInvitation: () =>
      owned(loan).makeAdjustBalancesInvitation(),
    makeCloseInvitation: () => owned(loan).makeCloseInvitation(),
    /**
     * Starting a transfer revokes the outer loan. The associated updater will
     * get a special notification the the loan is being transferred.
     */
    makeTransferInvitation: () => {
      const tmpInner = owned(loan);
      state.inner = null;
      return tmpInner.makeTransferInvitation();
    },
    // for status/debugging
    getCollateralAmount: () => owned(loan).getCollateralAmount(),
    getCurrentDebt: () => owned(loan).getCurrentDebt(),
    getNormalizedDebt: () => owned(loan).getNormalizedDebt(),
  });
  return { loan, loanUpdater: updater };
};

/**
 * Create a kit of utilities for use of the (inner) loan.
 *
 * @param {InnerLoan} inner
 * @param {Notifier<import('./poolManager.js').AssetState>} assetNotifier
 */
export const makeLoanKit = (inner, assetNotifier) => {
  const { loan, loanUpdater } = wrapLoan(inner);
  const loanKit = harden({
    assetNotifier,
    loanNotifier: loan.getNotifier(),
    invitationMakers: Far('invitation makers', {
      AdjustBalances: loan.makeAdjustBalancesInvitation,
      CloseLoan: loan.makeCloseInvitation,
      TransferLoan: loan.makeTransferInvitation,
    }),
    loan,
    loanUpdater,
  });
  return loanKit;
};

/** @typedef {(ReturnType<typeof makeLoanKit>)} LoanKit */
