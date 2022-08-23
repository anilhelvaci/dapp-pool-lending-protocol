import { E } from "@endo/far";
import { AmountMath } from "@agoric/ertp";
import lendingPoolDefaults from "../ui/src/generated/lendingPoolDefaults.js";
import { parseAsNat } from "@agoric/ui-components/dist/display/natValue/parseAsNat.js";

export default async function addPanToPool(homeP) {
  const home = await homeP;
  const scratch = home.scratch;
  const zoe = home.zoe;
  const board = home.board;
  const wallet = home.wallet;
  let liqAmountValue;

  const protocolPursePetname = 'AgVAN Purse';

  if (process.env.POOL_LIQ_AMOUNT) {
    liqAmountValue = parseAsNat(process.env.POOL_LIQ_AMOUNT);
  } else {
    liqAmountValue = 10n;
  }

  const { VAN_ASSET_CREATOR_FACET_ID, VAN_ISSUER_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID } = lendingPoolDefaults;

  const [panAssetCreatorFacet, panIssuer, panBrand, panDisplayInfo, lendingPoolPublicFaucet] = await Promise.all([
    E(scratch).get(VAN_ASSET_CREATOR_FACET_ID),
    E(board).getValue(VAN_ISSUER_BOARD_ID),
    E(E(board).getValue(VAN_ISSUER_BOARD_ID)).getBrand(),
    E(E(E(board).getValue(VAN_ISSUER_BOARD_ID)).getBrand()).getDisplayInfo(),
    E(zoe).getPublicFacet(E(board).getValue(LENDING_POOL_INSTANCE_BOARD_ID))
  ]);

  const panAmount = AmountMath.make(panBrand, liqAmountValue * 10n ** BigInt(panDisplayInfo.decimalPlaces));

  // Get the liquidity first
  const proposal = {
    give: {},
    want: {
      VAN: panAmount
    }
  };

  console.log('Getting VAN from the faucet...');
  const [panFaucetSeat, panPoolMan] = await Promise.all([
    E(zoe).offer(
      E(panAssetCreatorFacet).makeFaucetInvitation(),
      harden(proposal),
      harden({})
    ),
    E(lendingPoolPublicFaucet).getPool(panBrand)
  ]);

  console.log('Getting the payout...');
  const [panLiquidity, protocolAmountOut] = await Promise.all([
    E(panFaucetSeat).getPayout("VAN"),
    E(panPoolMan).getProtocolAmountOut(panAmount)
  ]);

  const depositProposal = {
    give: {
      Underlying: panAmount
    },
    want: {
      Protocol: protocolAmountOut
    }
  };

  const paymentKeywordRecord = {
    Underlying: panLiquidity
  };

  console.log('Depositing liquidity...');
  const depositOfferSeat = await E(zoe).offer(
    E(panPoolMan).makeDepositInvitation(),
    harden(depositProposal),
    harden(paymentKeywordRecord)
  );

  console.log('Getting protocol payment...');
  const [protocolPayment, protocolPurse] = await Promise.all([
    E(depositOfferSeat).getPayout('Protocol'),
    E(wallet).getPurse(protocolPursePetname)
  ]);

  // console.log('Depositing protocol...')
  // await E(protocolPurse).deposit(protocolPayment);

  console.log('Done...');
}