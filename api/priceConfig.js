import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';

const args = process.argv.slice(2);

const {
  VAN_USD_PRICE_AUTH_ID,
  VAN_ISSUER_BOARD_ID,
  PAN_USD_PRICE_AUTH_ID,
  PAN_ISSUER_BOARD_ID
} = lendingPoolDefaults;

const priceAuthorities = {
  van: {
    scratchId: VAN_USD_PRICE_AUTH_ID,
    issuerBoardId: VAN_ISSUER_BOARD_ID
  },
  pan: {
    scratchId: PAN_USD_PRICE_AUTH_ID,
    issuerBoardId: PAN_ISSUER_BOARD_ID
  }
};

const priceConfig = {
  priceVal: args[0] ? args[0] : 100,
  priceAuthority: args[1] ? priceAuthorities[args[1]] : priceAuthorities["van"],
};

console.log(priceConfig)
export default priceConfig;

