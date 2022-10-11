import lendingPoolDefaults from '@agoric/dapp-treasury-ui/src/generated/lendingPoolDefaults.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import newPoolConfig from './newPoolConfig.js';
import { E } from '@endo/far';

const setAssetPrice = async (homeP) => {
  const home = await homeP;
  const { scratch, board } = home;
  const { assetConfig: { keyword } } = newPoolConfig;

  const NEW_PRICE_VAL = 240n;

  const {
    ASSET_ISSUER_BOARD_ID,
    ASSET_USD_PRICE_AUTH_ID,
    USD_ISSUER_BOARD_ID,
  } = lendingPoolDefaults;

  console.log('Getting priceAuthority...');
  const [priceAuth, brandIn, brandOut] = await Promise.all([
    E(scratch).get(ASSET_USD_PRICE_AUTH_ID),
    E(E(board).getValue(ASSET_ISSUER_BOARD_ID)).getBrand(),
    E(E(board).getValue(USD_ISSUER_BOARD_ID)).getBrand(),
  ]);

  console.log(`Setting ${keyword}/USD price to ${NEW_PRICE_VAL}...`);
  await E(priceAuth).setPrice(
    makeRatio(
      NEW_PRICE_VAL * 10n ** 6n, brandOut,
      10n ** 8n, brandIn
    )
  );

  console.log('Done.');
};

export default setAssetPrice;