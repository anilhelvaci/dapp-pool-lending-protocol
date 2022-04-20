// @ts-check
import '@agoric/zoe/exported.js';
import { makeScalarBigMapStore } from '@agoric/swingset-vat/src/storeModule.js';
import { Far } from '@endo/marshal';
import { Nat } from '@agoric/nat';
import { E } from '@agoric/eventual-send';
import { AmountMath } from '@agoric/ertp';
/** @type PriceManager*/
export const makePriceManager = (options) => {
  /** @type {MapStore<Brand, PriceAuthority>} */
  const priceAuthorities = makeScalarBigMapStore('priceAuthorities');
  /** @type {MapStore<string, InnerVault>} */
  const supportedAssetPublicFacets = makeScalarBigMapStore('supportedAssetPublicFacets');

  /**
   * @param {Brand} brandIn
   * @param {PriceAuthority} priceAuthority
   * @param {Brand} compareBrand
   */
  const addNewWrappedPriceAuthority = async (brandIn, priceAuthority, compareBrand) => {
    const displayInfo = await E(brandIn).getDisplayInfo();
    const decimalPlaces = displayInfo?.decimalPlaces || 0n;
    console.log('[DISPLAY_INFO]', displayInfo);
    const notfier = priceAuthority.makeQuoteNotifier(AmountMath.make(brandIn, 10n ** Nat(decimalPlaces)), compareBrand);
    priceAuthorities.init(brandIn, harden({ priceAuthority, notfier }));
    console.log('[PRICE_AUTHS]', priceAuthorities.keys());
    return notfier;
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
    addNewWrappedPriceAuthority,
    addNewSupportedAssetPublicFacet,
    getPriceAuthority,
    getsupportedAssetPublicFacets
  })

  return priceManager;
}