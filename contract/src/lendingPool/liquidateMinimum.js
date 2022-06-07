// @ts-check

// import { E } from '@endo/eventual-send';
import {
  ceilMultiplyBy,
  offerTo,
} from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import { Far, E } from '@endo/far';

import { makeTracer } from '../makeTracer.js';

const trace = makeTracer('LiqMin', false);

/**
 * This contract liquidates the minimum amount of vault's collateral necessary
 * to satisfy the debt. It uses the AMM's swapOut, which sells no more than
 * necessary. Because it has offer safety, it can refuse the trade. When that
 * happens, we fall back to selling using the default strategy, which currently
 * uses the AMM's swapIn instead.
 *
 * @param {ZCF<{
 *   amm: XYKAMMPublicFacet,
 * }>} zcf
 */
const start = async zcf => {
  const { amm } = zcf.getTerms();

  /**
   * @param {ZCFSeat} debtorSeat
   * @param {object} options
   * @param {Amount<'nat'>} options.debt Debt before penalties
   * @param {Ratio} options.penaltyRate
   */
  const handleLiquidationOffer = async (
    debtorSeat,
    { debt: originalDebt, penaltyRate, collateralUnderlyingIssuer },
  ) => {
    console.log("Pools", await E(amm).getAllPoolBrands());
    // XXX does not distribute penalties anywhere
    const { zcfSeat: penaltyPoolSeat } = zcf.makeEmptySeatKit();
    const penalty = ceilMultiplyBy(originalDebt, penaltyRate);
    const debtWithPenalty = AmountMath.add(originalDebt, penalty);
    // const debtWithPenalty = originalDebt;
    console.log("Proposal", debtorSeat.getProposal())
    const debtBrand = originalDebt.brand;
    const {
      give: { In: amountIn },
    } = debtorSeat.getProposal();
    // await zcf.saveIssuer(collateralUnderlyingIssuer, "In");
    console.log("originalDebt", originalDebt)
    console.log("debtWithPenalty", debtWithPenalty)
    const { amountOut: debtPriceInCollateral } = await E(amm).getInputPrice(
      debtWithPenalty,
      AmountMath.makeEmpty(amountIn.brand)
    );

    const collateralToSell = AmountMath.min(debtPriceInCollateral, amountIn);

    const swapInvitation = await E(amm).makeSwapInInvitation();
    const liquidationProposal = harden({
      want: { Out: originalDebt },
      give: { In: collateralToSell },
    });
    console.log("liquidationProposal", liquidationProposal);
    console.log("swapInvitation", swapInvitation);
    const { deposited, userSeatPromise: liqSeat } = await offerTo(
      zcf,
      swapInvitation,
      undefined, // The keywords were mapped already
      liquidationProposal,
      debtorSeat,
      debtorSeat,
      undefined
    );

    const amounts = await deposited;
    trace(`Liq results`, {
      debtWithPenalty,
      amountIn,
      paid: debtorSeat.getCurrentAllocation(),
      amounts,
      debtPriceInCollateral
    });
    console.log("LiqOfferResult", await E(liqSeat).getOfferResult());
    // Now we need to know how much was sold so we can pay off the debt.
    // We can use this seat because only liquidation adds debt brand to it..
    const debtPaid = debtorSeat.getAmountAllocated('Out', debtBrand);
    console.log("debtPaid", debtPaid);

    // const penaltyPaid = AmountMath.min(penalty, debtPaid);
    //
    // // Allocate penalty portion of proceeds to a seat that will hold it for transfer to reserve
    // // penaltyPoolSeat.incrementBy(
    // //   debtorSeat.decrementBy(harden({ Out: penaltyPaid })),
    // // );
    // zcf.reallocate(debtorSeat);

    debtorSeat.exit();
  };

  /**
   * @type {ERef<Liquidator>}
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
