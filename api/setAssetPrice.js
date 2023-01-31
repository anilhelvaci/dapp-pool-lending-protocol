import lendingPoolDefaults from '@agoric/dapp-treasury-ui/src/generated/lendingPoolDefaults.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import newPoolConfig from './newPoolConfig.js';
import { E } from '@endo/far';
import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';

const setAssetPrice = async (homeP) => {
  const {
    getIstBrandAndIssuer,
    getValueFromScracth,
    getBrandAndIssuerFromBoard,
  } = await makeSoloHelpers(homeP);

  const { keyword } = newPoolConfig;

  const NEW_PRICE_VAL = 240n;
  const ASSET_IST_PRICE_AUTH_ID = `${keyword}_IST_PRICE_AUTH_ID`;
  const ASSET_ISSUER_BOARD_ID = `${keyword}_ISSUER_BOARD_ID`;

  console.log('Getting priceAuthority...');
  const [{ value: priceAuth }, { brand: brandIn }, { istBrand: brandOut }] = await Promise.all([
    getValueFromScracth(lendingPoolDefaults[ASSET_IST_PRICE_AUTH_ID]),
    getBrandAndIssuerFromBoard(lendingPoolDefaults[ASSET_ISSUER_BOARD_ID]),
    getIstBrandAndIssuer(),
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