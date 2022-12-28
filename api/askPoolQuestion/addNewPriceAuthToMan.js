import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../../ui/src/generated/lendingPoolDefaults.js';
import { POOL_PROPOSAL_CONFIG } from './config.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { E } from '@endo/far';

const addNewPriceAuthToMan = async homeP => {
  const {
    getValueFromBoard,
    getValueFromScracth,
    getBrandAndIssuerFromBoard,
    getIstBrandAndIssuer,
  } = await makeSoloHelpers(homeP);

  const {
    PRICE_MANAGER_PUBLIC_FACET_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
    TIMER_ID,
  } = lendingPoolDefaults;

  const { underlyingIssuerId } = POOL_PROPOSAL_CONFIG;

  const [
    { value: priceAuthCF },
    { value: priceManPF },
    { brand: underlyingBrand },
    { istBrand },
    { value: timer },
  ] = await Promise.all([
    getValueFromScracth(PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID),
    getValueFromBoard(PRICE_MANAGER_PUBLIC_FACET_BOARD_ID),
    getBrandAndIssuerFromBoard(underlyingIssuerId),
    getIstBrandAndIssuer(),
    getValueFromScracth(TIMER_ID),
  ]);

  console.log('Making priceAuth...');
  const underlyingPriceAuthority = await E(priceAuthCF).makeManualPriceAuthority({
    actualBrandIn: underlyingBrand,
    actualBrandOut: istBrand,
    initialPrice: makeRatio(POOL_PROPOSAL_CONFIG.priceOutInUnits * 10n ** 6n, istBrand,
      10n ** BigInt(POOL_PROPOSAL_CONFIG.decimalPlaces), underlyingBrand),
    timer
  });

  console.log('Adding new priceAuthority to priceManager...');
  await E(priceManPF).addNewWrappedPriceAuthority(underlyingBrand, underlyingPriceAuthority, istBrand);
  console.log('Done.');

};

export default harden(addNewPriceAuthToMan);
