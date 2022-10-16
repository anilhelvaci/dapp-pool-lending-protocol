// General
/**
 * @template T
 * @typedef {Object} PromiseKit A reified Promise
 * @property {(value: ERef<T>) => void} resolve
 * @property {(reason: any) => void} reject
 * @property {Promise<T>} promise
 */

/**
 * @callback GetExhangeRateForPool
 *
 * @param {Brand} brand
 * @returns {Ratio} exchangeRate
 */

/**
 * @callback GetValInCompareCurrency
 *
 * @param {Amount<'nat'>} amountIn
 * @param {PriceQuote} latestQuote
 * @param {Brand} scaleBrand
 * @param {number} scaleDecimalPlaces
 * @param {Ratio} [collateralExchangeRate]
 * @returns {Amount<"nat">}
 */

/**
 * @callback MakeRedeemInvitation
 *
 * @param {Brand} brand
 * @returns {Promise<Invitation>}
 */

/**
 * @callback DebtPaid
 *
 * @param {Amount<'nat'>} originalDebt
 * @returns {Amount<'nat'>}
 */

/**
 * @callback TransferLiquidatedFund
 *
 * @param {ZCFSeat} loanSeat
 * @return {void}
 */

// PriceManager
/**
 * @typedef {Object} PriceManager
 * @property {(brand: Brand) => ERef<WrappedPriceAuthority>} getWrappedPriceAuthority
 * @property {(brandIn: Brand,
 * priceAuthority: PriceAuthority,
 * compareBrand: Brand) => ERef<Notifier<PriceQuote>>} addNewWrappedPriceAuthority
 * @property {bigint} chargingPeriod
 * @property {bigint} recordingPeriod
 * @property {bigint} priceCheckPeriod
 */

/**
 * @typedef {Object} WrappedPriceAuthority
 * @property {PriceAuthority} priceAuthority
 * @property {Promise<Notifier<PriceQuote>>} notifier - This notifier is
 * set up in way that it is fired when there is change in the price of
 * 1 unit of (10 ** decimalPlaces) brandIn against the brandOut
 */

// DebtsPerCollateral
/**
 * @typedef {Object} DebtsPerCollateral
 * @property {(seat: ZCFSeat, underlyinAssetSeat: ZCFSeat, exchangeRate: Ratio) => Promise} addNewLoan
 * @property {(liquidationInstall: Installation, ammPublicFacet: XYKAMMPublicFacet) => Promise} setupLiquidator
 */

// PoolManager
/**
 * @typedef {Object} ManagerShared
 * @property {() => Ratio} getLiquidationMargin
 * @property {() => Ratio} getCurrentBorrowingRate
 * @property {() => Amount} getTotalDebt
 * @property {() => Ratio} getInitialExchangeRate
 * @property {() => Ratio} getExchangeRate
 * @property {(underlyingAmount: Amount) => Amount} getProtocolAmountOut
 * @property {(brand: Brand) => WrappedPriceAuthority} getPriceAuthorityForBrand
 * @property {() => NatValue} getChargingPeriod
 * @property {() => NatValue} getRecordingPeriod
 * @property {() => Brand} getProtocolBrand
 * @property {() => Issuer} getProtocolIssuer
 * @property {() => Amount} getProtocolLiquidity
 * @property {(underlyingBrand: Brand) => Amount } getUnderlyingLiquidity
 * @property {() => Brand} getUnderlyingBrand
 * @property {() => Issuer} getUnderlyingIssuer
 * @property {(proposedDebtAmount: Amount) => void} enoughLiquidityForProposedDebt
 * @property {() => Brand} getThirdCurrencyBrand
 * @property {(brand: Brand, protocolAmount: Amount) => Amount} protocolToUnderlying
 */

/**
 * @typedef {Object & ManagerShared} ManagerFacet
 // * @extends {ManagerShared}
 * @property {(oldDebt: Amount<'nat'>, newDebt: Amount<'nat'>) => void} applyDebtDelta
 * @property {(loanSeat: ZCFSeat, clientSeat: ZCFSeat) => void} reallocateBetweenSeats
 * @property {(loanSeat: ZCFSeat) => void} stageUnderlyingAllocation
 * @property {(seat: ZCFSeat, currentDebt: Amount) => void} transferDebt
 * @property {() => Brand} getCollateralBrand
 * @property {() => Ratio} getCompoundedInterest
 * @property {GetExhangeRateForPool} getExchangeRateForPool
 * @property {(underlyingBrand: Brand) => Invitation} makeRedeemInvitation
 * @property {TransferLiquidatedFund} transferLiquidatedFund
 * @property {(originalDebt: Amount) => Amount} debtPaid
 * @property {() => Ratio} getPenaltyRate
 */

/**
 * @typedef {ManagerShared} PoolManager
 * @property {(seat:ZCFSeat, exchangeRate: Ratio) => LoanKit} makeBorrowKit
 * @property {() => Invitation} makeDepositInvitation
 * @property {(seat: ZCFSeat) => string} redeemHook
 * @property {() => Notifier<AssetState>} getNotifier
 */

/**
 * @typedef {Object} AssetState
 * @property {Ratio} compoundedInterest - Total amount of interest that has been applied to this pool
 * @property {Ratio} latestInterestRate - The latest interest rate accrued to this pool, represented in annual form
 * @property {bigint} latestInterestUpdate - The last time an interest is accrued
 * @property {Amount<'nat'>} totalDebt
 * @property {Ratio} exchangeRate - The rate between protoclToken and underlyingAsset, effected by totalBorrow and protocolSupply
 * @property {Amount} underlyingLiquidity
 * @property {Amount} protocolLiquidity
 */


// LendingPool
/**
 * @typedef {Object} LendingPoolCreatorFacet
 * @property {() => string} helloFromCreator
 * @property {(
 * underlyingIssuer: Issuer,
 * underlyingKeyword: string,
 * rates: Object, priceAuthority:
 * PriceAuthority) => ERef<PoolManager>} addPoolType
 */

/**
 * @typedef {Object} LendingPoolPublicFacet
 * @property {() => string} helloWorld
 * @property {(brand: Brand) => boolean} hasPool
 * @property {(keyword: string) => void} hasKeyword
 * @property {(brand: Brand) => PoolManager} getPool
 * @property {() => Promise<Invitation>} makeBorrowInvitation
 * @property {(brand: Brand) => Promise<Invitation>} makeRedeemInvitation
 * @property {(brand: Brand) => Promise<Invitation>} makeDepositInvitation
 *
 */

/**
 * @typedef {StandardTerms | Object} LendingPoolTerms
 * @property {XYKAMMPublicFacet} ammPublicFacet
 * @property {PriceManager} priceManager
 * @property {TimerService} timerService
 * @property {Installation} liquidationInstall
 * @property {Object} loanTimingParams
 * @property {Brand} compareCurrencyBrand
 */

// Loan
/**
 * @typedef {Object} Loan

 * @property {() => ZCFSeat} getLoanSeat
 * @property {() => string} getPhase
 * @property {() => void} liquidating
 * @property {(amount: Amount<'nat'>) => void} liquidated
 * @property {(seat: ZCFSeat, poolSeat: ZCFSeat, exchangeRate: Ratio, loanKey: string) => Promise<LoanKit>} initLoanKit
 * @property {() => Promise<Invitation>} makeAdjustBalancesInvitation
 * @property {() => Promise<Invitation>} makeCloseInvitation
 * @property {() => Amount<'nat'>} getCollateralAmount
 * @property {() => Amount<'nat'>} getCurrentDebt
 * @property {() => Amount<'nat'>} getNormalizedDebt
 */

/**
 * @typedef {Object} LoanKit
 * @property {Object} publicNotifiers
 * @property {Notifier<AssetState>} publicNotifiers.assetNotifier
 * @property {Notifier<Object>} publicNotifiers.loanNotifier
 * @property {Object} invitationMakers
 * @property {() => Promise<Invitation>} invitationMakers.AdjustBalances
 * @property {() => Promise<Invitation>} invitationMakers.CloseLoan
 * @property {WrappedLoan} loan
 * @property {any} loanUpdater
 */

/**
 * @typedef {Object} WrappedLoan
 * @property {() => Notifier<Object>} getNotifier
 * @property {() => Promise<Invitation>} makeAdjustBalancesInvitation
 * @property {() => Promise<Invitation>} makeCloseInvitation
 * @property {() => Amount<'nat'>} getCollateralAmount
 * @property {() => Amount<'nat'>} getCurrentDebt
 * @property {() => Amount<'nat'>} getNormalizedDebt
 */

/**
 * @typedef {{
 * inner: Loan | null,
 * }} State
 */

// LoanStore
/**
 * @typedef {Object} LoanStore
 * @property {(laonId: string, loan: Loan) => string} addLoan
 * @property {(oldDebt: Amount<'nat'>, oldCollateral: Amount<'nat'>, loanId: string) => void} refreshLoanPriorityByAttributes
 * @property {(key: string, loanId: string) => string} refreshLoanPriorityByKey
 * @property {(key: string) => Loan} removeLoan
 * @property {(oldDebt: Amount<'nat'>, oldCollateral: Amount<'nat'>, loanId: string) => Loan} removeLoanByAttributes
 * @property {() => Loan} firstDebtRatio
 * @property {Object} entries
 * @property {(scheduler) => void} setRescheduler
 */

// LiquidationObserver
/**
 * @typedef {Object} LiquidationObserver
 * @property {(loan: Loan) => Promise<{debtLatestQuote: PriceQuote, colLatestQuote: PriceQuote, loan: Loan}>} schedule
 * @property {GetValInCompareCurrency} getValInCompareCurrency
 */

/**
 * @typedef {Object} LiquidationObserverOptions
 * @property {WrappedPriceAuthority} wrappedCollateralPriceAuthority
 * @property {WrappedPriceAuthority} wrappedDebtPriceAuthority
 * @property {Ratio} liquidationMargin
 * @property {Object} loanData
 * @property {GetExhangeRateForPool} getExchangeRateForPool
 */

/**
 * @typedef {Object} CheckLiquidationOptions
 * @template T
 * @property {PriceQuote} colQuote
 * @property {PriceQuote} debtQuote
 * @property {PromiseKit<T>} liqPromiseKit
 * @property {Loan} loan
 */

// Liquidator
/**
 * @typedef {Object} LiquidatorCreatorFacet
 * @property {() => Promise<Invitation>} makeLiquidateInvitation
 */

// Params
/**
 * @typedef {Object} Rates
 * @property {Ratio} liquidationMargin
 * @property {Ratio} baseRate
 * @property {Ratio} multipilierRate
 * @property {Ratio} initialExchangeRate
 * @property {Ratio} penaltyRate
 */

/**
 * @typedef {LoanTiming & Object} LendingPoolTiming
 * @property {NatValue} priceCheckPeriod
 */

/**
 * @typedef {Object} TestContext
 * @property {ZoeService} zoe
 */