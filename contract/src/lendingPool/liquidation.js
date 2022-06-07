// @ts-check
// @jessie-check

import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import { makeRatio, offerTo } from '@agoric/zoe/src/contractSupport/index.js';
import { makeTracer } from '../makeTracer.js';

const trace = makeTracer('LIQ');

/**
 * Liquidates a Vault, using the strategy to parameterize the particular
 * contract being used. The strategy provides a KeywordMapping and proposal
 * suitable for `offerTo()`, and an invitation.
 *
 * Once collateral has been sold using the contract, we burn the amount
 * necessary to cover the debt and return the remainder.
 *
 * @param {ZCF} zcf
 * @param {Vault} vault
 * @param {Liquidator}  liquidator
 * @param {MakeRedeemInvitation} makeRedeemInvitation
 * @param {Brand} collateralBrand
 * @param {Issuer} collateralUnderlyingIssuer
 * @param {Ratio} penaltyRate
 * @param {TransferLiquidatedFund} transferLiquidatedFund
 * @param {DebtPaid} debtPaid
 * @returns {Promise<Vault>}
 */
const liquidate = async (
  zcf,
  vault,
  liquidator,
  makeRedeemInvitation,
  collateralBrand,
  collateralUnderlyingIssuer,
  penaltyRate,
  transferLiquidatedFund,
  debtPaid
) => {
  trace('liquidate start', vault);
  vault.liquidating();

  const debt = vault.getCurrentDebt();

  const vaultZcfSeat = vault.getVaultSeat();

  const collateralToSell = vaultZcfSeat.getAmountAllocated('Collateral');

  const { deposited: redeemDeposited, userSeatPromise: redeemSeat } = await offerTo(
    zcf,
    makeRedeemInvitation(collateralBrand),
    harden({ Collateral: 'Protocol', CollateralUnderlying: 'Underlying' }),
    harden({
      give: { Protocol: collateralToSell },
      want: { Underlying: AmountMath.makeEmpty(collateralBrand) },
    }),
    vaultZcfSeat,
    vaultZcfSeat,
    undefined
  );
  await redeemDeposited;
  trace(`liq prep`, { collateralToSell, debt, liquidator });

  const collateralUnderlyingToSell = vaultZcfSeat.getAmountAllocated('CollateralUnderlying', collateralBrand);

  const { deposited, userSeatPromise: liqSeat } = await offerTo(
    zcf,
    E(liquidator).makeLiquidateInvitation(),
    harden({ CollateralUnderlying: 'In', Debt: 'Out' }),
    harden({
      give: { In: collateralUnderlyingToSell },
      want: { Out: AmountMath.makeEmpty(debt.brand) },
    }),
    vaultZcfSeat,
    vaultZcfSeat,
    harden({ debt, penaltyRate }),
  );
  trace(` offeredTo`, { collateralToSell, debt });

  await deposited;
  transferLiquidatedFund(vaultZcfSeat);
  debtPaid(debt);
  vault.liquidated(AmountMath.makeEmpty(debt.brand));
  return vault;
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
