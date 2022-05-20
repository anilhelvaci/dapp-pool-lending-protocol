// @ts-check
import { Far } from '@endo/marshal';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import { Nat } from '@agoric/nat';
import '@agoric/zoe/exported.js';
import { makeScalarMap } from '@agoric/store';
import { E } from '@agoric/eventual-send';

/**
 * This is a faucet that provides liquidity for the ertp asset created
 * using the parameter in terms. Just for demonstration purposes.
 */

/** @type {ContractStartFn} */
export async function start(zcf) {

  const priceAuthorities = makeScalarMap('priceAuthorities');
  /** @type {MapStore<string, InnerVault>} */
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

  const getPriceAuthority = (key) => {
    return priceAuthorities.get(key);
  }

  const getsupportedAssetPublicFacets = (key) => {
    return supportedAssetPublicFacets.get(key);
  }

  const publicFacet = Far('PriceManager', {
    addNewWrappedPriceAuthority,
    addNewSupportedAssetPublicFacet,
    getPriceAuthority,
    getsupportedAssetPublicFacets
  })

  const creatorFacet = Far('faucetInvitationMaker', {});

  return harden({ creatorFacet, publicFacet });
}
