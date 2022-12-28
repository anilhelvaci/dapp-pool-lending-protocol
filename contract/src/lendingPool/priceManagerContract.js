// @ts-check
import { Far } from '@endo/marshal';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import { Nat } from '@agoric/nat';
import '@agoric/zoe/exported.js';
import { makeScalarMap } from '@agoric/store';
import { E } from '@endo/far';

/**
 * This the place where we wrap the PriceManager inside a vat.
 * @see {PriceManager} to learn more about the functionality.
 */

/** @type {ContractStartFn} */
export async function start(zcf) {

  const priceAuthorities = makeScalarMap('priceAuthorities');

  /**
   * @param {Brand} brandIn
   * @param {PriceAuthority} priceAuthority
   * @param {Brand} compareBrand
   */
  const addNewWrappedPriceAuthority = async (brandIn, priceAuthority, compareBrand) => {
    if (priceAuthorities.has(brandIn)) {
      const { notifier } = priceAuthorities.get(brandIn);
      return notifier;
    }

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


  /** @type ERef<PriceManager>*/
  const publicFacet = Far('PriceManager', {
    addNewWrappedPriceAuthority,
    getWrappedPriceAuthority,
  })

  const creatorFacet = Far('faucetInvitationMaker', {});

  return harden({ creatorFacet, publicFacet });
}
