// Agoric branded logo used for page titles and headers.
export const AGORIC_LOGO_URL =
  'https://agoric.com/wp-content/themes/agoric_2021_theme/assets/img/logo.svg';

export const VaultStatus = /** @type {const} */ ({
  PENDING: 'Pending Wallet Acceptance',
  ERROR: 'Error in Offer',
  INITIATED: 'Loan Initiated',
  LIQUIDATED: 'Liquidated',
  LOADING: 'Loading',
  CLOSED: 'Closed',
  DECLINED: 'Declined',
});
/** @typedef {typeof VaultStatus[keyof typeof VaultStatus]} VaultStatus */

export const LoanStatus = /** @type {const} */ ({
  ACTIVE: 'active',
  OPEN: 'open',
  CLOSED: 'closed',
  PROPOSED: 'proposed',
  PENDING: 'pending',
  COMPLETE: 'complete',
  ERROR: 'error',
  LOADING: 'loading',
});
/** @typedef {typeof LoanStatus[keyof typeof LoanStatus]} LoanStatus */

export const OperationType = {
  DEPOSIT: 'deposit',
  BORROW: 'borrow',
  REDEEM: 'redeem',
  ADJUST: 'adjust',
  CLOSE: 'close',
};

export const AdjustActions = {
  GIVE: 'give',
  WANT: 'want',
  NO_ACTION: 'no-action',
};