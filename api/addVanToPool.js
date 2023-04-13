import { E } from "@endo/far";
import { AmountMath } from "@agoric/ertp";
import lendingPoolDefaults from "../ui/src/generated/lendingPoolDefaults.js";
import { parseAsNat } from "@agoric/ui-components/dist/display/natValue/parseAsNat.js";

export default async function addVanToPool(homeP) {
  const home = await homeP;
  const scratch = home.scratch;
  const zoe = home.zoe;
  const board = home.board;
  const wallet = home.wallet;
  let liqAmountValue;

  const protocolPursePetname = ['LendingPool','AgVAN'];

  if (process.env.POOL_LIQ_AMOUNT) {
    liqAmountValue = parseAsNat(process.env.POOL_LIQ_AMOUNT);
  } else {
    liqAmountValue = 10n;
  }

  const { VAN_ASSET_INSTANCE_BOARD_ID, VAN_ISSUER_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID } = lendingPoolDefaults;

  const vanInstanceP = E(board).getValue(VAN_ASSET_INSTANCE_BOARD_ID);
  const vanIssuerP = E(board).getValue(VAN_ISSUER_BOARD_ID);
  const vanBrandP = E(vanIssuerP).getBrand();
  const lendingPoolInstanceP = E(board).getValue(LENDING_POOL_INSTANCE_BOARD_ID);

  const [vanAssetPublicFacet, vanIssuer, vanBrand, vanDisplayInfo, lendingPoolPublicFaucet] = await Promise.all([
    E(zoe).getPublicFacet(vanInstanceP),
    vanIssuerP,
    vanBrandP,
    E(vanBrandP).getDisplayInfo(),
    E(zoe).getPublicFacet(lendingPoolInstanceP)
  ]);

  const vanAmount = AmountMath.make(vanBrand, liqAmountValue * 10n ** BigInt(vanDisplayInfo.decimalPlaces));

  // Get the liquidity first
  const proposal = {
    give: {},
    want: {
      VAN: vanAmount
    }
  };

  console.log('Getting VAN from the faucet...');
  const [vanFaucetSeat, vanPoolMan] = await Promise.all([
    E(zoe).offer(
      await E(vanAssetPublicFacet).makeFaucetInvitation(),
      harden(proposal),
      harden({})
    ),
    E(lendingPoolPublicFaucet).getPool(vanBrand)
  ]);

  console.log('Getting the payout...');
  const [vanLiquidity, protocolAmountOut, payouts, offerResult] = await Promise.all([
    E(vanFaucetSeat).getPayout("VAN"),
    E(vanPoolMan).getProtocolAmountOut(vanAmount),
    E(vanFaucetSeat).getPayouts(),
    E(vanFaucetSeat).getOfferResult(),
  ]);

  console.log('Payouts', payouts);
  console.log('OfferResult', offerResult);

  const depositProposal = {
    give: {
      Underlying: vanAmount
    },
    want: {
      Protocol: protocolAmountOut
    }
  };

  const paymentKeywordRecord = {
    Underlying: vanLiquidity
  };

  console.log("VAN", await E(vanIssuer).getAmountOf(vanLiquidity));
  console.log("Proposal", depositProposal);

  console.log('Depositing liquidity...');
  const depositOfferSeat = await E(zoe).offer(
    E(vanPoolMan).makeDepositInvitation(),
    harden(depositProposal),
    harden(paymentKeywordRecord)
  );

  // console.log('Getting protocol payment...');
  // const [protocolPayment, protocolPurse] = await Promise.all([
  //   E(depositOfferSeat).getPayout('Protocol'),
  //   E(wallet).getPurse(protocolPursePetname)
  // ]);
  //
  // console.log('Depositing protocol...')
  // await E(protocolPurse).deposit(protocolPayment);

  console.log('Done...');
}