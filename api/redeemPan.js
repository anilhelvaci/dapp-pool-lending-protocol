import { E } from '@endo/far';
import { parseAsNat } from '@agoric/ui-components/dist/display/natValue/parseAsNat';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults';


const redeemPan = async (homeP) => {

  const home = await homeP;
  const scratch = home.scratch;
  const zoe = home.zoe;
  const board = home.board;
  const wallet = home.wallet;
  let liqAmountValue;

  const protocolPursePetname = 'AgPAN Purse';
  const underleyinPursePetname = 'PAN Purse';

  const { PAN_ASSET_CREATOR_FACET_ID, PAN_ISSUER_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID } = lendingPoolDefaults;

  const [panIssuer, panBrand, panDisplayInfo, lendingPoolPublicFaucet, walletBridge] = await Promise.all([
    E(board).getValue(PAN_ISSUER_BOARD_ID),
    E(E(board).getValue(PAN_ISSUER_BOARD_ID)).getBrand(),
    E(E(E(board).getValue(PAN_ISSUER_BOARD_ID)).getBrand()).getDisplayInfo(),
    E(zoe).getPublicFacet(E(board).getValue(LENDING_POOL_INSTANCE_BOARD_ID)),
    E(wallet).getBridge()
  ]);

};

export default redeemPan;