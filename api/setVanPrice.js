// import priceConfig from './priceConfig';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';

const setVanPrice = async homeP => {

  const {
    getValueFromScracth,
    getBrandAndIssuerFromBoard,
    getIstBrandAndIssuer
  } = await makeSoloHelpers(homeP);

  const NEW_PRICE_VAL = 100n;

  const {
    VAN_ISSUER_BOARD_ID,
    VAN_IST_PRICE_AUTH_ID,
  } = lendingPoolDefaults;

  console.log('Getting priceAuthority...');
  const [{ value: priceAuth }, { brand: vanBrand }, { istBrand }] = await Promise.all([
    getValueFromScracth(VAN_IST_PRICE_AUTH_ID),
    getBrandAndIssuerFromBoard(VAN_ISSUER_BOARD_ID),
    getIstBrandAndIssuer(),
  ]);

  console.log(`Setting VAN/IST price to ${NEW_PRICE_VAL}...`);
  await E(priceAuth).setPrice(
    makeRatio(
      NEW_PRICE_VAL * 10n ** 6n, istBrand,
      10n ** 8n, vanBrand
    )
  );

  console.log('Done.');
};

export default setVanPrice;