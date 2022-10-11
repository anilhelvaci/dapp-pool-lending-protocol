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
  const pursePetname = ['LendingPool','VAN']

  if (process.env.LIQUIDITY_AMOUNT) {
    liqAmountValue = parseAsNat(process.env.LIQUIDITY_AMOUNT);
  } else {
    liqAmountValue = 10n;
  }

  const {
    VAN_ASSET_INSTANCE_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
  } = lendingPoolDefaults;

  const vanInstanceP = E(board).getValue(VAN_ASSET_INSTANCE_BOARD_ID);
  const vanIssuerP = E(board).getValue(VAN_ISSUER_BOARD_ID);
  const vanBrandP = E(vanIssuerP).getBrand();

  console.log("Getting necessary stuff...");
  const [vanAssetPublicFacet, vanIssuer, vanBrand, vanDisplayInfo] = await Promise.all([
    E(zoe).getPublicFacet(vanInstanceP),
    vanIssuerP,
    vanBrandP,
    E(vanBrandP).getDisplayInfo()
  ]);

  const proposal = {
    give: {},
    want: {
      VAN: AmountMath.make(vanBrand, liqAmountValue * 10n ** BigInt(vanDisplayInfo.decimalPlaces))
    }
  };

  console.log("Getting VAN from the faucet...");
  const [faucetSeat, vanPurse] = await Promise.all([
    E(zoe).offer(
      E(vanAssetPublicFacet).makeFaucetInvitation(),
      harden(proposal),
      harden({})
    ),
    E(wallet).getPurse(pursePetname)
  ]);

  console.log("Getting payout...");
  const payout = await E(faucetSeat).getPayout("VAN");

  console.log("Depositing VAN to wallet...");
  await E(vanPurse).deposit(
    payout
  );

  console.log("Done...");

}