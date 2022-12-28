import lendingPoolDefaults from '../../ui/src/generated/lendingPoolDefaults.js';

/**
 * We assume the first proposal will for adding the PAN Pool
 *
 */

const { PAN_ISSUER_BOARD_ID } = lendingPoolDefaults;

const config = harden({
  underlyingIssuerId: PAN_ISSUER_BOARD_ID,
  keyword: 'PAN',
  decimalPlaces: 8,
  deadline: 100n,
  riskControls: {
    borrowable: false,
    usableAsCol: false,
    limitValue: 1_000n,
  },
  priceOutInUnits: 200n,
  lockValueInUnits: 20_000n,
  vote: true,
});

export const POOL_PROPOSAL_CONFIG = config;