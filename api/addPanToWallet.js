import { E } from '@endo/far';
import { AmountMath } from "@agoric/ertp";
import lendingPoolDefaults from "../ui/src/generated/lendingPoolDefaults.js";
import { parseAsNat } from "@agoric/ui-components/dist/display/natValue/parseAsNat.js";

export default async function addVanToWallet(homeP) {
  const home = await homeP;
  const zoe = home.zoe;
  const board = home.board;
  const wallet = home.wallet;
  const scratch = home.scratch;

  let liqAmountValue;
  const pursePetname = ['LendingPool', 'PAN']

  if (process.env.LIQUIDITY_AMOUNT) {
    liqAmountValue = parseAsNat(process.env.LIQUIDITY_AMOUNT);
  } else {
    liqAmountValue = 10n;
  }

  const {
    PAN_ASSET_CREATOR_FACET_ID,
    PAN_ISSUER_BOARD_ID,
  } = lendingPoolDefaults;

  console.log("Getting necessary stuff...");
  const [panAssetCreatorFacet, panIssuer, panBrand, panDisplayInfo] = await Promise.all([
    E(scratch).get(PAN_ASSET_CREATOR_FACET_ID),
    E(board).getValue(PAN_ISSUER_BOARD_ID),
    E(E(board).getValue(PAN_ISSUER_BOARD_ID)).getBrand(),
    E(E(E(board).getValue(PAN_ISSUER_BOARD_ID)).getBrand()).getDisplayInfo()
  ]);

  const proposal = {
    give: {},
    want: {
      PAN: AmountMath.make(panBrand, liqAmountValue * 10n ** BigInt(panDisplayInfo.decimalPlaces))
    }
  };

  console.log("Getting PAN from the faucet...");
  const [faucetSeat, panPurse] = await Promise.all([
    E(zoe).offer(
      E(panAssetCreatorFacet).makeFaucetInvitation(),
      harden(proposal),
      harden({})
    ),
    E(wallet).getPurse(pursePetname)
  ]);

  console.log("Getting payout...");
  const payout = await E(faucetSeat).getPayout("PAN");

  console.log("Depositing PAN to wallet...");
  await E(panPurse).deposit(
    payout
  );

  console.log("Done...");

}