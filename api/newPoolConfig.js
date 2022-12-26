export default {
  issuerId: '', // Should be left empty
  assetId: '', // Should be left empty
  keyword: 'HOP',
  displayInfo: {
    decimalPlaces: 8,
  },
  ammConfig: {
    centralValue: 150n * 100n,
    secondaryValue: 100n,
  },
  priceOutInUnits: 150n,
  riskControls: {
    borrowable: false,
    usableAsCol: false,
    limitValue: 5_000n,
  },
};