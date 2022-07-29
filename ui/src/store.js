// @ts-check

// The code in this file requires an understanding of Autodux.
// See: https://github.com/ericelliott/autodux
import autodux from 'autodux';
import { VaultStatus } from './constants';

export const initial = {
  approved: true,
  connected: false,
  account: null,
  purses: /** @type {PursesJSONState[] | null} */ (null),
  brandToInfo: /** @type {Array<[Brand, BrandInfo]>} */ ([]),
  RUNStakeHistory: /** @type {Record<string, HistoryItem>} */ ({}),
  // Vault state
  treasury: /** @type { VaultState | null } */ (null),
  lendingPool: (null),
  markets: (null),
  prices: (null), // {brandIn: quote}
  vaultCollateral: /** @type { CollateralInfo | null } */ (null),
  vaultConfiguration: null,
  vaults: /** @type {Record<string, VaultData> | null} */ (null),
  collaterals: /** @type { Collaterals | null } */ (null),
  vaultToManageId: /** @type {string | null} */ (null),
  loadTreasuryError: /** @type {string | null} */ null,
  RUNStake: /** @type { RUNStakeState | null } */ (null),
  loan: /** @type { Loan | null } */ (null),
  loanAsset: /** @type { AssetState | null } */ (null),
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
    addToBrandToInfo,
    setCollaterals,
    resetState,
    setTreasury,
    setLendingPool,
    setMarkets,
    setVaultCollateral,
    setVaultConfiguration,
    createVault,
    createMarket,
    addPrice,
    initVaults,
    setVaultToManageId,
    updateVault,
    updateMarket,
    updatePrice,
    resetVault,
    setLoadTreasuryError,
    mergeRUNStakeHistory,
    setRUNStake,
    setLoan,
    setLoanAsset,
  },
  // @ts-ignore tsc can't tell that autodux is callable
} = autodux({
  slice: 'treasury',
  initial,
  actions: {
    /** @type {(state: TreasuryState) => TreasuryState} */
    initVaults: state => {
      return { ...state, vaults: {} };
    },
    /** @type {(state: TreasuryState, v: { id: string, vault: VaultData }) => TreasuryState} */
    createVault: (state, { id, vault }) => {
      return {
        ...state,
        vaults: {
          ...state.vaults,
          [id]: vault,
        },
      };
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
    addPrice: (state, { id, quote }) => {
      return {
        ...state,
        prices: {
          ...state.prices,
          [id]: quote,
        },
      };
    },
    /** @type {(state: TreasuryState, v: { id: string, vault: VaultData }) => TreasuryState} */
    updateVault: ({ vaults, ...state }, { id, vault }) => {
      const oldVaultData = vaults && vaults[id];
      const status = vault.liquidated
        ? VaultStatus.LIQUIDATED
        : (vault.status ?? oldVaultData?.status);
      return {
        ...state,
        vaults: { ...vaults, [id]: { ...oldVaultData, ...vault, status } },
      };
    },
    updateMarket: ({ markets, ...state }, { id, market }) => {
      const oldMarketData = markets && markets[id];
      return {
        ...state,
        markets: { ...markets, [id]: { ...oldMarketData, ...market } },
      };
    },
    updatePrice: ({ prices, ...state }, { id, quote }) => {
      return {
        ...state,
        prices: { ...prices, [id]: { ...quote } },
      };
    },
    /** @type {(state: TreasuryState) => TreasuryState} */
    resetVault: state => ({
      ...state,
      vaultCollateral: null,
      vaultConfiguration: null,
    }),
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
    /** @type {(state: TreasuryState, newRUNStakeHistory: Record<string, HistoryItem>) => TreasuryState} */
    mergeRUNStakeHistory: (state, newRUNStakeHistory) => {
      return {
        ...state,
        RUNStakeHistory: {
          ...state.RUNStakeHistory,
          ...newRUNStakeHistory,
        },
      };
    },
  },
});
