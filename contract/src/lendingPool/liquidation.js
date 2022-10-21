// @ts-check
// @jessie-check

import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import { makeRatio, offerTo } from '@agoric/zoe/src/contractSupport/index.js';
import { makeTracer } from '@agoric/inter-protocol/src/makeTracer.js';

const trace = makeTracer('LIQ');

/**
 * Our current liquidation logic is implemented here. To liquidate a loan
 * we first need to redeem the collateral because it's a LendingPool protocolToken.
 * After a successful redeem operation, we expect an underlyingToken for the
 * protocolToken we just redeemed. For instance; imagine a loan with debtBrand of
 * PAN, collateralBrand of AgVAN. If we redeem the collateral, we should have some
 * amount of VAN at hand. We do redeem first because we assume there is no market
 * for AgVAN/PAN in the AMM. We also assume that the AMM has no VAN/PAN pool but it
 * has VAN/CentralBrand and PAN/CentralBrand. The AMM uses a virtual double pool
 * to make the VAN/PAN trade happen.
 *
 * After we have our VANs, we feed it into our current liquidation contract
 * and the liquidation contract makes the AMM trade happen. Once the AMM trade
 * is successful, we transfer the funds accordingly.
 *
 * @param {ZCF} zcf
 * @param {Loan} loan
 * @param {LiquidatorCreatorFacet}  liquidator
 * @param {MakeRedeemInvitation} makeRedeemInvitation
 * @param {Brand} collateralBrand
 * @param {Issuer} collateralUnderlyingIssuer
 * @param {Ratio} penaltyRate
 * @param {TransferLiquidatedFund} transferLiquidatedFund
 * @param {DebtPaid} debtPaid
 * @returns {Promise<Loan>}
 */
const liquidate = async (
  zcf,
  loan,
  liquidator,
  makeRedeemInvitation,
  collateralBrand,
  collateralUnderlyingIssuer,
  penaltyRate,
  transferLiquidatedFund,
  debtPaid
) => {
  trace('liquidate start', loan);
  loan.liquidating(); // update loan state

  const debt = loan.getCurrentDebt();
  const loanZcfSeat = loan.getLoanSeat();

  // Get the collateral, remember it's a protocolToken
  const collateralToSell = loanZcfSeat.getAmountAllocated('Collateral');

  // Call the redeem hook in the lendingPool contract
  const { deposited: redeemDeposited, userSeatPromise: redeemSeat } = await offerTo(
    zcf,
    makeRedeemInvitation(collateralBrand),
    harden({ Collateral: 'Protocol', CollateralUnderlying: 'Underlying' }), // CollateralUnderlying is the keyword we use for the underlyingToken corresponding to the protocolToken redeemed
    harden({
      give: { Protocol: collateralToSell },
      want: { Underlying: AmountMath.makeEmpty(collateralBrand) },
    }),
    loanZcfSeat,
    loanZcfSeat,
    undefined
  );
  await redeemDeposited;
  trace(`liq prep`, { collateralToSell, debt, liquidator });

  // Get the underlyingTokens for the redeemed protocolTokens
  const collateralUnderlyingToSell = loanZcfSeat.getAmountAllocated('CollateralUnderlying', collateralBrand);

  // Call the liquidation contract
  const { deposited, userSeatPromise: liqSeat } = await offerTo(
    zcf,
    E(liquidator).makeLiquidateInvitation(),
    harden({ CollateralUnderlying: 'In', Debt: 'Out' }),
    harden({
      give: { In: collateralUnderlyingToSell },
      want: { Out: AmountMath.makeEmpty(debt.brand) },
    }),
    loanZcfSeat,
    loanZcfSeat,
    harden({ debt, penaltyRate }),
  );
  trace(` offeredTo`, { collateralToSell, debt });

  await deposited;
  debtPaid(debt);
  transferLiquidatedFund(loanZcfSeat);

  // Update loan state
  loan.liquidated(AmountMath.makeEmpty(debt.brand));
  return loan;
};

const liquidationDetailTerms = debtBrand =>
  harden({
    MaxImpactBP: 50n,
    OracleTolerance: makeRatio(30n, debtBrand),
    AMMMaxSlippage: makeRatio(30n, debtBrand),
  });
/** @typedef {ReturnType<typeof liquidationDetailTerms>} LiquidationTerms */

harden(liquidate);
harden(liquidationDetailTerms);

export { liquidate, liquidationDetailTerms };
