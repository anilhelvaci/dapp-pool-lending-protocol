// import { assert, details as X, q } from '@agoric/assert';
import { makeTracer } from '@agoric/inter-protocol/src/makeTracer.js';
import { AmountMath } from '@agoric/ertp';

const trace = makeTracer('LendingPool');

const { details: X, quote: q } = assert;

/**
 *
 * @param offerArgs
 * @param poolTypes
 * @return {Brand}
 */
const assertBorrowOfferArgs = (offerArgs, poolTypes) => {
  trace('borrowHook: OfferArgs', offerArgs);

  assert(typeof offerArgs == 'object', '[NO_OFFER_ARGS]');
  assert(
    offerArgs.hasOwnProperty('collateralUnderlyingBrand'),
    '[NO_OFFER_ARGS]',
  );

  const collateralUnderlyingBrand = offerArgs.collateralUnderlyingBrand;
  assertBorrowCollateralUnderlyingBrand(
    poolTypes,
    collateralUnderlyingBrand,
  );

  return collateralUnderlyingBrand;
};
harden(assertBorrowOfferArgs);

const assertBalancesHookArgs = offerArgs => {
  trace('BalancesHook: OfferArgs', offerArgs);

  assert(typeof offerArgs == 'object');
  assert(
    offerArgs.hasOwnProperty('collateralUnderlyingBrand'),
    'OfferArgs should contain a collateralUnderlyingBrand object',
  );
};
harden(assertBalancesHookArgs);

const assertBorrowCollateralUnderlyingBrand = (
  poolTypes,
  collateralUnderlyingBrand,
) => {
  trace('borrowHook: collateralUnderlyingBrand', collateralUnderlyingBrand);

  assert(
    poolTypes.has(collateralUnderlyingBrand),
    X`Collateral pool does not exist: ${collateralUnderlyingBrand}`,
  );
};
harden(assertBorrowCollateralUnderlyingBrand);

const assertBorrowProposal = (
  poolTypes,
  borrowerSeat,
  collateralUnderlyingPool,
) => {
  const {
    give: {
      Collateral: { brand: collateralBrand },
    },
    want: {
      Debt: { brand: borrowBrand },
    },
  } = borrowerSeat.getProposal();

  assert(
    collateralBrand === collateralUnderlyingPool.getProtocolBrand(),
    X`Not a supported collateral type ${collateralBrand}`,
  );
  assert(
    poolTypes.has(borrowBrand),
    X`Not a supported pool type ${borrowBrand}`,
  );
  return borrowBrand;
};
harden(assertBorrowProposal);

const assertUnderlyingBrand = (poolTypes, underlyingBrand) => {
  assert(
    poolTypes.has(underlyingBrand),
    X`Not a supported pool type ${underlyingBrand}`,
  );
};
harden(assertUnderlyingBrand);

/**
 * Checks if there is enough liquidity for the hand out the proposed debt
 * and throws an error if the liquidity is not enough.
 * @param {Amount} proposedDebtAmount
 * @param {ZCFSeat} underlyingAssetSeat
 * @param {Brand} underlyingBrand
 */
const assertEnoughLiquidtyExists = (
  proposedDebtAmount,
  underlyingAssetSeat,
  underlyingBrand,
) => {
  const totalLiquidity = underlyingAssetSeat.getAmountAllocated(
    'Underlying',
    underlyingBrand,
  );
  assert(
    AmountMath.isGTE(totalLiquidity, proposedDebtAmount, underlyingBrand),
    X`Requested ${q(proposedDebtAmount)} exceeds the total liquidity ${q(
      totalLiquidity,
    )}`,
  );
  console.log('assertEnoughLiquidtyExists: Enough!');
};
harden(assertEnoughLiquidtyExists);

const assertDebtDeltaNotZero = (oldDebt, newDebt) => {
  assert(oldDebt != newDebt, X`Debt delta equal to zero`);
};
harden(assertDebtDeltaNotZero);

const assertLiquidityFunds = loanAllocations => {
  assert(
    loanAllocations.Debt && loanAllocations.Debt !== undefined,
    'The loan has no liquidated funds',
  );
};
harden(assertLiquidityFunds);

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
harden(assertOnlyKeys);

const assertColLimitNotExceeded = (balanceTracer, getColLimit, proposal, colUnderlyingBrand) => {
  const {
    give: {
      Collateral: collateralAmount,
    }
  } = proposal;

  const currentBalance = balanceTracer.getBalance(collateralAmount.brand);
  const proposedBalance = AmountMath.add(currentBalance, collateralAmount);
  const colLimit = getColLimit(colUnderlyingBrand);
  console.log('@@@@@@@1', {currentBalance, proposedBalance, colLimit});
  assert(AmountMath.isGTE(colLimit, proposedBalance), X`Proposed operation exceeds the allowed collateral limit.`);
};

export {
  assertBorrowOfferArgs,
  assertBalancesHookArgs,
  assertBorrowCollateralUnderlyingBrand,
  assertBorrowProposal,
  assertUnderlyingBrand,
  assertEnoughLiquidtyExists,
  assertDebtDeltaNotZero,
  assertLiquidityFunds,
  assertOnlyKeys,
  assertColLimitNotExceeded,
};