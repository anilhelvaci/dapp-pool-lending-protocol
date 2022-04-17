// @ts-check
import '@agoric/zoe/exported.js';
import { makeScalarBigMapStore } from '@agoric/swingset-vat/src/storeModule.js';
import { Far } from '@endo/marshal';
/** @type PriceManager*/
export const makePriceManager = (options) => {
  /** @type {MapStore<Brand, PriceAuthority>} */
  const priceAuthorities = makeScalarBigMapStore('priceAuthorities');
  /** @type {MapStore<string, InnerVault>} */
  const supportedAssetPublicFacets = makeScalarBigMapStore('supportedAssetPublicFacets');

  const addNewPriceAuthority = (key, value) => {
    priceAuthorities.init(key, value);
    console.log('[PRICE_AUTHS]', priceAuthorities.keys());
  }

  const addNewSupportedAssetPublicFacet = (key, value) => {
    supportedAssetPublicFacets.init(key, value);
  }

  const getPriceAuthority = (key) => {
    return priceAuthorities.get(key);
  }

  const getsupportedAssetPublicFacets = (key) => {
    return supportedAssetPublicFacets.get(key);
  }

  const priceManager = Far('PriceManager', {
    addNewPriceAuthority,
    addNewSupportedAssetPublicFacet,
    getPriceAuthority,
    getsupportedAssetPublicFacets
  })

  return priceManager;
}