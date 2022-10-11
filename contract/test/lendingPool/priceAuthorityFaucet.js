// @ts-check
import { Far } from '@endo/marshal';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';

export const start = async (zcf) => {
  const creatorFacet = Far("creatorFacet", {
    makeManualPriceAuthority: (options) => makeManualPriceAuthority(options)
  });
  const publicFacet = Far("creatorFacet", {
    hello: () => "Hello from PriceAuthortiyFaucet"
  })
  return harden({ creatorFacet, publicFacet });
}