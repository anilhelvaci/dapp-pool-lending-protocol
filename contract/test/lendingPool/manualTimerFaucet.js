// @ts-check
import { Far } from '@endo/marshal';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';

export const start = async (zcf) => {
  const creatorFacet = Far("creatorFacet", {
    makeManualTimer: (options) => buildManualTimer(console.log, options.startValue, options.timeStep)
  });
  const publicFacet = Far("creatorFacet", {
    hello: () => "Hello from ManualTimerFaucet"
  })
  return harden({ creatorFacet, publicFacet });
}