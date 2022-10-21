import { assert, details as X, q } from '@agoric/assert';
import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';
import { AmountMath } from '@agoric/ertp';

const trace = makeTracer('LendingPool');

export const assertBorrowOfferArgs = offerArgs => {
  trace('borrowHook: OfferArgs', offerArgs);

  assert(typeof offerArgs == 'object', '[NO_OFFER_ARGS]');
  assert(
    offerArgs.hasOwnProperty('collateralUnderlyingBrand'),
    '[NO_OFFER_ARGS]',
  );
};

export const assertBalancesHookArgs = offerArgs => {
  trace('BalancesHook: OfferArgs', offerArgs);

  assert(typeof offerArgs == 'object');
  assert(
    offerArgs.hasOwnProperty('collateralUnderlyingBrand'),
    'OfferArgs should contain a collateralUnderlyingBrand object',
  );
};

export const assertBorrowCollateralUnderlyingBrand = (
  poolTypes,
  collateralUnderlyingBrand,
) => {
  trace('borrowHook: collateralUnderlyingBrand', collateralUnderlyingBrand);

  assert(
    poolTypes.has(collateralUnderlyingBrand),
    X`Collateral pool does not exist: ${collateralUnderlyingBrand}`,
  );
};

export const assertBorrowProposal = (
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
};

export const assertUnderlyingBrand = (poolTypes, underlyingBrand) => {
  assert(
    poolTypes.has(underlyingBrand),
    X`Not a supported pool type ${underlyingBrand}`,
  );
};

/**
 * Checks if there is enough liquidity for the hand out the proposed debt
 * and throws an error if the liquidity is not enough.
 * @param {Amount} proposedDebtAmount
 */
export const assertEnoughLiquidtyExists = (
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

export const assertDebtDeltaNotZero = (oldDebt, newDebt) => {
  assert(oldDebt != newDebt, X`Debt delta equal to zero`);
};

export const assertLiquidityFunds = loanAllocations => {
  assert(
    loanAllocations.Debt && loanAllocations.Debt !== undefined,
    'The loan has no liquidated funds',
  );
};

// The proposal is not allowed to include any keys other than these,
// usually 'Collateral' and 'RUN'.
export const assertOnlyKeys = (proposal, keys) => {
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