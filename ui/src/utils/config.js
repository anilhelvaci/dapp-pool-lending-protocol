/* global process */
import { E } from '@endo/eventual-send';

// Taken from window.DAPP_CONSTANTS_JSON in index.html, defaulting to .env.local.
import defaults from '../generated/defaults';

// eslint-disable-next-line import/no-mutable-exports
let dappConfig;
export { dappConfig };

dappConfig = process.env.REACT_APP_DAPP_CONSTANTS_JSON
  ? JSON.parse(process.env.REACT_APP_DAPP_CONSTANTS_JSON)
  : defaults;

export async function refreshConfigFromWallet(walletP) {
  if (!dappConfig.ON_CHAIN_CONFIG) {
    // No refresh required.
    return;
  }

  const [method, args] = dappConfig.ON_CHAIN_CONFIG;
  const overrideConfig = await E(walletP)[method](...args);
  console.log('overriding with', {
    ...dappConfig,
    ...overrideConfig,
  });

  dappConfig = {
    ...dappConfig,
    ...overrideConfig,
  };
}
