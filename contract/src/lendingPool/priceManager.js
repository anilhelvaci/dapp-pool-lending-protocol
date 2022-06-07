// @ts-check
import '@agoric/zoe/exported.js';
// import { makeScalarBigMapStore } from '@agoric/swingset-vat/src/storeModule.js';
import { makeScalarMap } from '@agoric/store';
import { Far } from '@endo/marshal';
import { Nat } from '@agoric/nat';
import { E } from '@agoric/eventual-send';
import { AmountMath } from '@agoric/ertp';
/** @type PriceManager*/
export const makePriceManager = (options) => {
  /** @type {MapStore<Brand, PriceAuthority>} */
  const priceAuthorities = makeScalarMap('priceAuthorities');
  /** @type {MapStore<string, InnerLoan>} */
  const supportedAssetPublicFacets = makeScalarMap('supportedAssetPublicFacets');

  /**
   * @param {Brand} brandIn
   * @param {PriceAuthority} priceAuthority
   * @param {Brand} compareBrand
   */
  const addNewWrappedPriceAuthority = async (brandIn, priceAuthority, compareBrand) => {
    const displayInfo = await E(brandIn).getDisplayInfo();
    const decimalPlaces = displayInfo?.decimalPlaces || 0n;
    console.log('[DISPLAY_INFO]', displayInfo);
    const notifier = E(priceAuthority).makeQuoteNotifier(AmountMath.make(brandIn, 10n ** Nat(decimalPlaces)), compareBrand);
    priceAuthorities.init(brandIn, harden({ priceAuthority, notifier }));
    console.log('[PRICE_AUTHS]', priceAuthorities.keys());
    return notifier;
  }

  const addNewSupportedAssetPublicFacet = (key, value) => {
    supportedAssetPublicFacets.init(key, value);
  }

  const getWrappedPriceAuthority = (key) => {
    return priceAuthorities.get(key);
  }

  const getsupportedAssetPublicFacets = (key) => {
    return supportedAssetPublicFacets.get(key);
  }

  const priceManager = Far('PriceManager', {
    addNewWrappedPriceAuthority,
    addNewSupportedAssetPublicFacet,
    getWrappedPriceAuthority: getWrappedPriceAuthority,
    getsupportedAssetPublicFacets
  })

  return priceManager;
}