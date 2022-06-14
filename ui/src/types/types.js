/**
 * @typedef {object} CollateralInfo
 *
 * @property {Brand} brand - the brand of the potential collateral
 *
 * @property {Ratio} liquidationMargin - the ratio below which
 * collateral will be liquidated to satisfy the debt. Example:
 * RUN125/RUN100
 *
 * @property {Ratio} marketPrice - price of one unit of collateral in
 * run, where unit is the commonly understood unit indicated by
 * decimalPlaces (e.g. ETH, not wei). Example: RUN1/moola1
 *
 * @property {string} petname - the petname from the user's wallet for
 *   this brand. Example: "moola"
 *
 * @property {Ratio} stabilityFee - the fee for the loan. Example:
 * RUN50/RUN10000
 *
 * @property {Ratio} interestRate - the interest to be charged on a
 * regular basis. The interest is added to the outstanding debt.
 */

/**
 * @typedef {Array<CollateralInfo>} Collaterals
 */

/**
 * @typedef {string | string[]} Petname A petname can either be a plain string
 * or a path for which the first element is a petname for the origin, and the
 * rest of the elements are a snapshot of the names that were first given by that
 * origin.  We are migrating away from using plain strings, for consistency.
 */

/**
 * @typedef {object} PursesJSONState
 * @property {Brand} brand
 * @property {string} brandBoardId  the board ID for this purse's brand
 * @property {string=} depositBoardId the board ID for the deposit-only facet of
 * this purse
 * @property {Petname} brandPetname the petname for this purse's brand
 * @property {Petname} pursePetname the petname for this purse
 * @property {any} displayInfo the brand's displayInfo
 * @property {any} value the purse's current balance
 * @property {any} currentAmountSlots
 * @property {any} currentAmount
 */

/**
 * @typedef {object} BrandInfo
 * @property {Issuer} issuer
 * @property {Brand} brand
 * @property {AssetKind} assetKind
 * @property {number | undefined} decimalPlaces
 * @property {Petname} petname - the petname for the brand from the user
 */

/**
 * @typedef { typeof import('../store').initial } TreasuryState
 *
 * @typedef { React.Reducer<TreasuryState, TreasuryAction> } TreasuryReducer
 *
 * @typedef { any } TreasuryAction This should probably be a big union type
 * but specifying it doesn't seem cost-effective just now.
 *
 * @typedef {React.Dispatch<React.Reducer<TreasuryState, TreasuryAction>>} TreasuryDispatch
 */

/**
 * @typedef {{
 *   instance?: Instance,
 *   ammAPI?: ERef<MultipoolAutoswapPublicFacet>,
 *   centralBrand?: Brand,
 *   otherBrands?: Record<string, Brand>,
 * }} AutoswapState
 */

/**
 * @typedef  { import('@agoric/run-protocol/src/vaultFactory/vault').VaultUIState } VaultUIState
 */

/**
 * @typedef { import('@agoric/run-protocol/src/vaultFactory/vaultManager').AssetState } AssetState
 */

/**
 * @typedef {{
 *   status: import('../constants').VaultStatus,
 *   liquidated?: boolean,
 *   locked?: VaultUIState['locked'],
 *   collateralizationRatio?: Ratio,
 *   debtSnapshot?: VaultUIState['debtSnapshot'],
 *   interestRate?:  VaultUIState['interestRate'],
 *   liquidationRatio?: VaultUIState['liquidationRatio'],
 *   asset?: AssetState,
 *   err?: Error,
 * }} VaultData
 */

/**
 * @typedef {{
 *   instance: Instance,
 *   treasuryAPI: unknown,
 *   runIssuer: Issuer,
 *   runBrand: Brand,
 *   priceAuthority: ERef<PriceAuthority>,
 * }} VaultState
 */

/**
 * @typedef { import('@agoric/run-protocol/src/runStake/runStake').RunStakePublic } RunStakePublic
 */

/**
 * @typedef { import('@agoric/run-protocol/src/runStake/runStake').RunStakeTerms } RunStakeTerms
 */

/**
 * @typedef { import('../constants').LoanStatus } LoanStatus
 */

/**
 * @typedef {{
 * data: VaultData,
 * id: string,
 * status: LoanStatus
 * }} Loan
 */

/**
 * @typedef {{
 *   RUNStakeAPI: RunStakePublic,
 *   RUNStakeTerms: RunStakeTerms,
 *   instanceBoardId: string,
 *   installationBoardId: string,
 * }} RUNStakeState
 */

/**
 * @typedef { import('@agoric/wallet/api/src/types').RecordMetadata } RecordMetadata
 */

/**
 * @typedef {{
 *   priorOfferId?: string
 * }} ContinuingInvitation
 */

/**
 * @typedef {{
 *   meta: RecordMetadata,
 *   proposalForDisplay: Record<string, any>
 *   continuingInvitation?: ContinuingInvitation,
 * }} HistoryItem
 */
