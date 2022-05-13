// @ts-check
import { Far } from '@endo/marshal';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';

export const start = async (zcf) => {
  console.log("mdlaşksfşas")
  const creatorFacet = Far("creatorFacet", {
    makeScriptedPriceAuthority: (options) => makeScriptedPriceAuthority(options)
  });
  const publicFacet = Far("creatorFacet", {
    hello: () => "Hello from PriceAuthortiyFaucet"
  })
  return harden({ creatorFacet, publicFacet });
}