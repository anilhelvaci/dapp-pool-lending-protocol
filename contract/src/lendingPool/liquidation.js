// @ts-check
// @jessie-check

import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import { makeRatio, offerTo } from '@agoric/zoe/src/contractSupport/index.js';
import { makeTracer } from '../makeTracer.js';

const trace = makeTracer('LIQ');

/**
 * Liquidates a Loan, using the strategy to parameterize the particular
 * contract being used. The strategy provides a KeywordMapping and proposal
 * suitable for `offerTo()`, and an invitation.
 *
 * Once collateral has been sold using the contract, we burn the amount
 * necessary to cover the debt and return the remainder.
 *
 * @param {ZCF} zcf
 * @param {Loan} loan
 * @param {Liquidator}  liquidator
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
  loan.liquidating();

  const debt = loan.getCurrentDebt();

  const loanZcfSeat = loan.getLoanSeat();

  const collateralToSell = loanZcfSeat.getAmountAllocated('Collateral');

  const { deposited: redeemDeposited, userSeatPromise: redeemSeat } = await offerTo(
    zcf,
    makeRedeemInvitation(collateralBrand),
    harden({ Collateral: 'Protocol', CollateralUnderlying: 'Underlying' }),
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

  const collateralUnderlyingToSell = loanZcfSeat.getAmountAllocated('CollateralUnderlying', collateralBrand);

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
  transferLiquidatedFund(loanZcfSeat);
  debtPaid(debt);
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
