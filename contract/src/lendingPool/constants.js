import { BASIS_POINTS, LARGE_DENOMINATOR, SECONDS_PER_YEAR } from '../interest.js';

export const UPDATE_ASSET_STATE_OPERATION = harden({
  BORROW: 'Borrow',
  DEPOSIT: 'Deposit',
  REDEEM: 'Redeem',
  CHARGE_INTEREST: 'Charge Interest',
  APPLY_DEBT_DELTA: 'Apply Debt Delta',
  LIQUIDATED: 'liquidated',
});

export const ARITHMETIC_OPERATION = harden({
  ADD: 'add',
  SUBSTRACT: 'substract',
});

export const NUMERIC_PARAMETERS = harden({
  BASIS_POINTS,
  LARGE_DENOMINATOR,
  SECONDS_PER_YEAR,
  INITIAL_EXCHANGE_RATE_NUMERATOR: 2000000n,
  PROTOCOL_TOKEN_DECIMALS: 6,
});