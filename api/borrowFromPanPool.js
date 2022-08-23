import { parseAsNat } from '@agoric/ui-components/dist/display/natValue/parseAsNat.js';
import lendingPoolDefaults from "../ui/src/generated/lendingPoolDefaults.js";
import { AmountMath } from '@agoric/ertp';
import { E } from '@endo/far';
import { floorDivideBy } from '@agoric/zoe/src/contractSupport';

export default async function borrowFromPanPool(homeP) {
  const home = await homeP;
  const zoe = home.zoe;
  const board = home.board;
  const wallet = home.wallet;

  const borrowAmountValue = process.env.BORROW_VALUE ? parseAsNat(process.env.BORROW_VALUE) : 4n;
  const panDecimalValue = process.env.DECIMAL_VALUE ? parseAsNat(process.env.DECIMAL_VALUE) : 6n;
  const collateralUnderlyingValue = process.env.COLLATERAL_VALUE ? parseAsNat(process.env.COLLATERAL_VALUE) : 1n;

  const collateralPursePetname = 'AgVAN Purse';
  const underlyingPursePetname = 'PAN Purse';


  const { PAN_ISSUER_BOARD_ID, VAN_ISSUER_BOARD_ID, AGVAN_ISSUER_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID } = lendingPoolDefaults;

  console.log("Getting stuff from board...");
  const [panBrand,lendingPoolPublicFacet, agVanBrand, agVanDisplayInfo, vanBrand, vanDisplayInfo ] = await Promise.all([
    E(E(board).getValue(PAN_ISSUER_BOARD_ID)).getBrand(),
    E(zoe).getPublicFacet(E(board).getValue(LENDING_POOL_INSTANCE_BOARD_ID)),
    E(E(board).getValue(AGVAN_ISSUER_BOARD_ID)).getBrand(),
    E(E(E(board).getValue(AGVAN_ISSUER_BOARD_ID)).getBrand()).getDisplayInfo(),
    E(E(board).getValue(VAN_ISSUER_BOARD_ID)).getBrand(),
    E(E(E(board).getValue(VAN_ISSUER_BOARD_ID)).getBrand()).getDisplayInfo(),
  ]);

  const collateralUnderlyingAmount = AmountMath.make(vanBrand,collateralUnderlyingValue * 10n ** BigInt(vanDisplayInfo.decimalPlaces) )

  const collateralAmount = floorDivideBy(collateralUnderlyingAmount,
    await E(E(lendingPoolPublicFacet).getPool(vanBrand)).getExchangeRate());

  console.log("Getting collateralPayment and underlyingPurse...");
  const [collateralPayment, underlyingPurse] = await Promise.all([
    E(
      E(wallet).getPurse(collateralPursePetname),
    ).withdraw(collateralAmount),
    E(wallet).getPurse(underlyingPursePetname),
  ]);

  const borrowInvitation = E(lendingPoolPublicFacet).makeBorrowInvitation();

  const debtProposal = {
    give: { Collateral: collateralAmount },
    want: { Debt: AmountMath.make(panBrand, borrowAmountValue * 10n ** panDecimalValue) },
  };

  const debtPaymentKeywordRecord = {
    Collateral: collateralPayment
  }

  console.log("Sending borrow offer...");
  // Send offer
  const borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  console.log("Getting borrow payout...");
  const borrowPayout = await E(borrowerUserSeat).getPayout('Debt');

  console.log("Depositing borrowed money...");
  await E(underlyingPurse).deposit(borrowPayout);

  console.log("Borrowing: done...");
}