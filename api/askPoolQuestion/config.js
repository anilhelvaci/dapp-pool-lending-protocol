const config = harden({
  underlyingIssuerId: '',
  keyword: '',
  decimalPlaces: 6,
  deadline: 100n,
  riskControls: {
    borrowable: false,
    usableAsCol: false,
    limitValue: 1_000n,
  },
  price: {
    numeratorValue: 0n, // Brand Out
    denominatorValue: 0n, // Brand In
  },
  vote: true,
});

export const POOL_PROPOSAL_CONFIG = config;