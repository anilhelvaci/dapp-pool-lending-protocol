// import priceConfig from './priceConfig';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';

const setPanPrice = async homeP => {

  const home = await homeP;
  const { scratch, board } = home;

  const NEW_PRICE_VAL = 300n;

  const {
    USD_ISSUER_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    PAN_USD_PRICE_AUTH_ID
  } = lendingPoolDefaults;

  console.log('Getting priceAuthority...');
  const [priceAuth, brandIn, brandOut] = await Promise.all([
    E(scratch).get(PAN_USD_PRICE_AUTH_ID),
    E(E(board).getValue(PAN_ISSUER_BOARD_ID)).getBrand(),
    E(E(board).getValue(USD_ISSUER_BOARD_ID)).getBrand(),
  ]);

  console.log(`Setting PAN/USD price to ${NEW_PRICE_VAL}...`);
  await E(priceAuth).setPrice(
    makeRatio(
      NEW_PRICE_VAL * 10n ** 6n, brandOut,
      10n ** 8n, brandIn
    )
  );

  console.log('Done.');
};

export default setPanPrice;