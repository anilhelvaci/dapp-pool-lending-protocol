// @ts-check

// The code in this file requires an understanding of Autodux.
// See: https://github.com/ericelliott/autodux
import autodux from 'autodux';

export const initial = {
  approved: true,
  connected: false,
  purses: /** @type {PursesJSONState[] | null} */ (null),
  brandToInfo: /** @type {Array<[Brand, BrandInfo]>} */ ([]),
  lendingPool: (null),
  markets: (null),
  prices: (null), // {brandIn: quote}
  loan: /** @type { Loan | null } */ (null),
  loanAsset: /** @type { AssetState | null } */ (null),
  loans: (null),
  snackbarState: { open: false, message: '', stick: null },
};

/**
 * @type {{
 *   reducer: TreasuryReducer,
 *   initial: TreasuryState,
 *   actions: TreasuryActions,
 * }}
 *
 * @typedef {{
 *    setApproved: (payload: boolean) => TreasuryReducer,
 *    setConnected: (payload: boolean) => TreasuryReducer,
 *    setPurses: (payload: typeof initial.purses) => TreasuryReducer,
 *    createVault: (payload: { id: string, vault: VaultData }) => TreasuryReducer,
 *    mergeBrandToInfo: (payload: typeof initial.brandToInfo ) => TreasuryReducer,
 *    addToBrandToInfo: (payload: typeof initial.brandToInfo) => TreasuryReducer,
 *    setCollaterals: (payload: typeof initial.collaterals) => TreasuryReducer,
 *    resetState: () => TreasuryReducer,
 *    mergeRUNStakeHistory: (payload: typeof initial.RUNStakeHistory) => TreasuryReducer,
 *    setTreasury: (payload: typeof initial.treasury) => TreasuryReducer,
 *    setVaultCollateral: (payload: typeof initial.vaultCollateral) => TreasuryReducer,
 *    setVaultConfiguration: (payload: typeof initial.vaultConfiguration) => TreasuryReducer,
 *    setVaultToManageId: (payload: typeof initial.vaultToManageId) => TreasuryReducer,
 *    updateVault: (v: { id: string, vault: VaultData }) => TreasuryReducer,
 *    resetVault: () => TreasuryReducer,
 *    initVaults: () => TreasuryReducer,
 *    setLoan: (payload: typeof initial.loan) => TreasuryReducer,
 *    setLoanAsset: (payload: typeof initial.loanAsset) => TreasuryReducer,
 *    setLoadTreasuryError: (payload: string | null) => TreasuryReducer,
 *    setRUNStake: (payload: typeof initial.RUNStake) => TreasuryReducer,
 * }} TreasuryActions
 */
export const {
  reducer,
  initial: defaultState,
  actions: {
    setApproved,
    setConnected,
    setPurses,
    mergeBrandToInfo,
    setLendingPool,
    setMarkets,
    createMarket,
    addPrice,
    initLoans,
    updateMarket,
    updatePrice,
    setLoan,
    setLoanAsset,
    createLoan,
    updateLoan,
    setSnackbarState,
    hasMarket,
    initMarkets,
  },
  // @ts-ignore tsc can't tell that autodux is callable
} = autodux({
  slice: 'treasury',
  initial,
  actions: {
    initLoans: state => {
      return { ...state, loans: {} };
    },
    initMarkets: state => {
      return {...state, markets: {}};
    },
    createMarket: (state, { id, market }) => {
      return {
        ...state,
        markets: {
          ...state.markets,
          [id]: market,
        },
      };
    },
    createLoan: (state, { id, loan }) => {
      return {
        ...state,
        loans: {
          ...state.loans,
          [id]: loan,
        },
      };
    },
    addPrice: (state, { id, quote }) => {
      return {
        ...state,
        prices: {
          ...state.prices,
          [id]: quote,
        },
      };
    },
    updateMarket: ({ markets, ...state }, { id, market }) => {
      const oldMarketData = markets && markets[id];
      return {
        ...state,
        markets: { ...markets, [id]: { ...oldMarketData, ...market } },
      };
    },
    hasMarket: ({ markets }, brand) => markets && markets[brand],
    updatePrice: ({ prices, ...state }, { id, quote }) => {
      return {
        ...state,
        prices: { ...prices, [id]: { ...quote } },
      };
    },
    updateLoan: ({ loans, ...state }, { id, loan }) => {
      const oldLoanData = loans && loans[id];
      return {
        ...state,
        loans: { ...loans, [id]: { ...oldLoanData, ...loan } },
      };
    },
    /** @type {(state: TreasuryState) => TreasuryState} */
    resetState: state => ({
      ...state,
      purses: null,
      collaterals: null,
      inputPurse: null,
      outputPurse: null,
      inputAmount: null,
      outputAmount: null,
    }),
    /** @type {(state: TreasuryState, newBrandToInfo: Array<[Brand, BrandInfo]>) => TreasuryState} */
    mergeBrandToInfo: (state, newBrandToInfo) => {
      const merged = new Map([...state.brandToInfo, ...newBrandToInfo]);

      const brandToInfo = [...merged.entries()];
      return {
        ...state,
        brandToInfo,
      };
    },
  },
});
