// @ts-check

import {
  ceilMultiplyBy,
  offerTo,
} from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import { Far, E } from '@endo/far';

import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';

const trace = makeTracer('LiqMin');

/**
 *
 * This contract is a fraction of the `liquidateMinimum` contract used in the
 * VaultFactory. We needed to implement this contract because our AMM trade is
 * between a virtual double pool where as RUN is the CentralBrand of the AMM
 * and VaultFactory lends RUN. Normally to sell the minimum amount of a token to
 * receive another token, AMM lets us use swapOut methods. On the beta branch,
 * `getPriceForOutput` method in the doublePool.js was broken, so to make the minimum
 * amount of collateral trade happen we did two swapIn operations. The first one is to
 * know the price of the debt in collateral, and in the second one we make the actual
 * trade with the debt price in collateral as the 'give' and the originalDebt as
 * the 'want'.
 *
 * The issue mentioned in beta branch is then resolved here:
 * https://github.com/Agoric/agoric-sdk/issues/5490
 */
const start = async zcf => {
  const { amm } = zcf.getTerms();

  /**
   * @param {ZCFSeat} debtorSeat
   * @param {object} options
   * @param {Amount<'nat'>} options.debt Debt before penalties
   * @param {Ratio} options.penaltyRate
   * @param {Issuer} options.collateralUnderlyingIssuer
   */
  const handleLiquidationOffer = async (
    debtorSeat,
    { debt: originalDebt, penaltyRate, collateralUnderlyingIssuer },
  ) => {

    const penalty = ceilMultiplyBy(originalDebt, penaltyRate);
    const debtWithPenalty = AmountMath.add(originalDebt, penalty); // Calculate debt wiht liquidationPenalty
    trace('Proposal', debtorSeat.getProposal());
    const debtBrand = originalDebt.brand;
    const {
      give: { In: amountIn }, // amountIn is the whole collateral in the loan
    } = debtorSeat.getProposal();

    trace('Debts', {
      originalDebt,
      debtWithPenalty
    })

    const { amountOut: debtPriceInCollateral } = await E(amm).getInputPrice(
      debtWithPenalty, // The amount of collateral required in order to receive the amount of debtWithPenalty
      AmountMath.makeEmpty(amountIn.brand)
    );

    const collateralToSell = AmountMath.min(debtPriceInCollateral, amountIn); // Get whichever one is minimum

    const swapInvitation = await E(amm).makeSwapInInvitation();
    const liquidationProposal = harden({
      want: { Out: originalDebt },
      give: { In: collateralToSell },
    });

    trace('liquidationProposal & swapInvitation', {
      liquidationProposal,
      swapInvitation
    })

    // Send offer
    const { deposited, userSeatPromise: liqSeat } = await offerTo(
      zcf,
      swapInvitation,
      undefined, // The keywords were mapped already
      liquidationProposal,
      debtorSeat,
      debtorSeat,
      undefined
    );

    // Wait for the offer to finish
    const amounts = await deposited;
    trace(`Liq results`, {
      debtWithPenalty,
      amountIn,
      paid: debtorSeat.getCurrentAllocation(),
      amounts,
      debtPriceInCollateral
    });

    const debtPaid = debtorSeat.getAmountAllocated('Out', debtBrand);
    trace("DebtPaid", debtPaid);

    debtorSeat.exit();
  };

  /**
   * @type {ERef<LiquidatorCreatorFacet>}
   */
  const creatorFacet = Far('debtorInvitationCreator (minimum)', {
    makeLiquidateInvitation: () =>
      zcf.makeInvitation(handleLiquidationOffer, 'Liquidate'),
  });

  return harden({ creatorFacet });
};

/** @typedef {ContractOf<typeof start>} LiquidationContract */

harden(start);
export { start };
