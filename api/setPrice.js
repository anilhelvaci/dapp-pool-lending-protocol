// import priceConfig from './priceConfig';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults';
import { makeRatio } from '@agoric/zoe/src/contractSupport';

const setPrice = async homeP => {
  const home = await homeP;
  const scratch = home.scratch;
  const board = home.board;

  const {
    VAN_ISSUER_BOARD_ID,
    VAN_USD_PRICE_AUTH_ID,
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

  console.log('Setting PAN/USD price to 195...');
  await E(priceAuth).setPrice(
    makeRatio(
      195n * 10n ** 6n, brandOut,
      10n ** 8n, brandIn
    )
  );

  console.log('Done.');
};

export default setPrice;