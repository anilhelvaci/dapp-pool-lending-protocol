// @ts-check
import { makeNotifierKit } from '@agoric/notifier';
import '@agoric/zoe/exported.js';
import { Far } from '@endo/marshal';

const { details: X } = assert;

/**
 *
 * @param {Loan} innerLoan
 */
const wrapLoan = innerLoan => {

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
   * @see {WrappedLoan} for the internal API it wraps.
   */
  const loan = Far('loan', {
    getNotifier: () => notifier,
    makeAdjustBalancesInvitation: () =>
      owned(loan).makeAdjustBalancesInvitation(),
    makeCloseInvitation: () => owned(loan).makeCloseInvitation(),
    // for status/debugging
    getCollateralAmount: () => owned(loan).getCollateralAmount(),
    getCollateralUnderlyingAmount: () => owned(loan).getCollateralUnderlyingAmount(),
    getCurrentDebt: () => owned(loan).getCurrentDebt(),
    getNormalizedDebt: () => owned(loan).getNormalizedDebt(),
  });
  return { loan, loanUpdater: updater };
};

/**
 * Create a kit of utilities for use of the (inner) loan.
 *
 * @param {Loan} inner
 * @param {Notifier<AssetState>} assetNotifier
 * @returns {LoanKit}
 */
export const makeLoanKit = (inner, assetNotifier) => {
  const { loan, loanUpdater } = wrapLoan(inner);
  return harden({
    uiNotifier: {
      assetNotifier,
      loanNotifier: loan.getNotifier(),
    },
    invitationMakers: Far('invitation makers', {
      AdjustBalances: loan.makeAdjustBalancesInvitation,
      CloseLoan: loan.makeCloseInvitation,
    }),
    loan,
    loanUpdater,
  });
};
