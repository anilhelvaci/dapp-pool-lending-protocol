// @ts-check
import '@agoric/zoe/exported.js';
import { makeScalarMap } from '@agoric/store';
import { Far } from '@endo/marshal';
import { Nat } from '@agoric/nat';
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';

/**
 * Since our LendinPool protocol works with multiple priceAuthorities,
 * we thought that it might be a good idea to gather those priceAuthorities
 * in a place. It served well because there are scenarios where a particular pool
 * needs a quote from another pools priceAuthority.
 *
 * We create a notifier that will be giving updates everytime there's a new brandOut
 * price for 1 unit of brandIn. This comes handy because we use these notifiers
 * when observing the liquidation.
 *
 * @see LiquidationObserver
 *
 * @param {Object} options
 * @returns {ERef<PriceManager>}
 */
export const makePriceManager = (options) => {
  /** @type {MapStore<Brand, WrappedPriceAuthority>} */
  const priceAuthorities = makeScalarMap('priceAuthorities');

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

  const getWrappedPriceAuthority = (key) => {
    return priceAuthorities.get(key);
  }

  return Far('PriceManager', {
    addNewWrappedPriceAuthority,
    getWrappedPriceAuthority: getWrappedPriceAuthority,
  });
}