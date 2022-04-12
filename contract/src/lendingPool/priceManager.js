// @ts-check
import '@agoric/zoe/exported.js';
import { makeScalarBigMapStore } from '@agoric/swingset-vat/src/storeModule';

export const makePriceManager = (options) => {
  /** @type {MapStore<string, InnerVault>} */
  const priceAuthorities = makeScalarBigMapStore('priceAuthorities');
  /** @type {MapStore<string, InnerVault>} */
  const supportedAssetPublicFacets = makeScalarBigMapStore('supportedAssetPublicFacets');

  const addNewPriceAuthority = (key, value) => {
    priceAuthorities.init(key, value);
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

  return harden({
    addNewPriceAuthority,
    addNewSupportedAssetPublicFacet,
    getPriceAuthority,
    getsupportedAssetPublicFacets
  })
}