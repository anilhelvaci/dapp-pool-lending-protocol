import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';

const {
  VAN_ISSUER_BOARD_ID,
  VAN_ASSET_INSTANCE_BOARD_ID,
  PAN_ISSUER_BOARD_ID,
  PAN_ASSET_INSTANCE_BOARD_ID,
} = lendingPoolDefaults;

const config = {
  VAN: {
    issuerId: VAN_ISSUER_BOARD_ID,
    assetId: VAN_ASSET_INSTANCE_BOARD_ID,
    keyword: 'VAN',
    riskControls: {
      borrowable: true,
      usableAsCol: true,
      limitValue: 100_000n,
    },
    displayInfo: {
      decimalPlaces: 8,
    },
    ammConfig: {
      centralValue: 110n * 100n,
      secondaryValue: 100n,
    },
    priceOutInUnits: 110n,
  },
  PAN: {
    issuerId: PAN_ISSUER_BOARD_ID,
    assetId: PAN_ASSET_INSTANCE_BOARD_ID,
    keyword: 'PAN',
    riskControls: {
      borrowable: true,
      usableAsCol: true,
      limitValue: 100_000n,
    },
    displayInfo: {
      decimalPlaces: 8,
    },
    ammConfig: {
      centralValue: 200n * 100n,
      secondaryValue: 100n,
    },
    priceOutInUnits: 200n,
  }
};

export const POOL_CONFIG = harden(config);