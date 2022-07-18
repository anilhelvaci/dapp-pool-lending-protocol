// @ts-check
import { makeScalarMap} from '@agoric/store';
import { makeInnerLoan } from './loan.js';
import { E } from '@agoric/eventual-send';
import { Far } from '@endo/marshal';
import {
  makeRatioFromAmounts,
} from '@agoric/zoe/src/contractSupport/index.js';
import { liquidationDetailTerms, liquidate } from './liquidation.js';
import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';
import { ratioGTE } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeLiquidationObserver } from './liquidationObserver.js';
import { makeLoanStoreUtils } from './loanStoreUtils.js';

const trace = makeTracer("DebtsPerCollateral");

/**
 * This is the place where we gather loans that have the same collateral type.
 * For instance, say the underlying asset for this pool is PAN and our protocol
 * accepts AgVAN ptorocol tokens as one collateral type. All loans that have
 * the AgVAN as its collateral are gathered here. Public API exposed from this
 * module is;
 * - addNewLoan: Adds a new loan that has the same collateral type as all the others
 *   in this one. Returns a kit that includes some utility objects to manage
 *   the loan.
 * - setupLiquidator: Sets a liquidator contract to support different type of
 *   liquidation behavor for the loans stored in this module.
 *
 * One other important job that this module does is to keep a liquidationObserver
 * object. DebtsPerCollateral schedules a liquidation condition by telling the
 * liquidationObserver about the closest loan to the liquidatio margin
 * and once the closest loan is underwater it executes the liquidation.
 *
 * @param {ZCF} zcf
 * @param {Brand} collateralBrand
 * @param {Brand} debtBrand
 * @param {Notifier<AssetState>} assetNotifier
 * @param {WrappedPriceAuthority} wrappedCollateralPriceAuthority
 * @param {PriceAuthority} underlyingPriceAuthority
 * @param {Promise<Notifier<PriceQuote>>} underlyingPriceNotifier
 * @param {ManagerFacet} manager
 * @param {TimerService} timer
 * @param {Object} timingParams
 * @returns {Promise<DebtsPerCollateral>}
 */
export const makeDebtsPerCollateral = async (
  zcf,
  collateralBrand,
  debtBrand,
  assetNotifier,
  wrappedCollateralPriceAuthority,
  underlyingPriceAuthority,
  underlyingPriceNotifier,
  manager,
  timer,
  timingParams,
) => {
  console.log("making makeDebtsPerCollateral")

  const debtIssuer = zcf.getIssuerForBrand(debtBrand);
  const collateralIssuer = zcf.getIssuerForBrand(collateralBrand);

  const [debtDisplayInfo, collateralDisplayInfo] = await Promise.all([
    E(manager.getUnderlyingBrand()).getDisplayInfo(),
    E(collateralBrand).getDisplayInfo()
  ]);

  const collateralDecimalPlaces = collateralDisplayInfo?.decimalPlaces || 0;
  const debtDecimalPlaces = debtDisplayInfo?.decimalPlaces || 0;

  let loanCounter = 0;

  const loansToLiquidate = makeScalarMap('loansToLiquidate');
  /** @type {LoanStore}*/
  const orderedLoans = makeLoanStoreUtils();
  const managerMethods = harden({
    ...manager,
    removeLoan: orderedLoans.removeLoan,
    refreshLoanPriorityByAttributes: orderedLoans.refreshLoanPriorityByAttributes,
    refreshLoanPriorityByKey: orderedLoans.refreshLoanPriorityByKey,
    removeLoanByAttributes: orderedLoans.removeLoanByAttributes
  });

  /** @type LiquidationObserver */
  const liquidationObserver = makeLiquidationObserver({
    wrappedCollateralPriceAuthority,
    wrappedDebtPriceAuthority: { priceAuthority: underlyingPriceAuthority, notifier: underlyingPriceNotifier },
    liquidationMargin: manager.getLiquidationMargin(),
    loanData: {
      collateralUnderlyingDecimals: collateralDecimalPlaces,
      debtDecimals: debtDecimalPlaces,
      debtBrand,
      collateralUnderlyingBrand: collateralBrand,
      compareBrand: manager.getThirdCurrencyBrand()
    },
    getExchangeRateForPool: manager.getExchangeRateForPool
  });

  const liquidation = {
    instance: undefined,
    liquidator: undefined
  }

  /**
   *
   * @param {ZCFSeat} seat
   * @param {ZCFSeat} underlyingAssetSeat
   * @param {Ratio} exchangeRate
   * @returns {Promise<LoanKit>}
   */
  const addNewLoan = async (seat, underlyingAssetSeat, exchangeRate) => {
    loanCounter += 1;
    const loanId = String(loanCounter);
    /** @type Loan */
    const innerLoan = makeInnerLoan(
      zcf,
      managerMethods,
      assetNotifier,
      loanId,
      debtBrand,
      underlyingPriceAuthority,
      wrappedCollateralPriceAuthority.priceAuthority,
    );

    const loanKey = orderedLoans.addLoan(loanId, innerLoan);
    const loanKit = await innerLoan.initLoanKit(seat, underlyingAssetSeat, exchangeRate, loanKey);
    seat.exit();
    return loanKit;
  };

  /**
   *
   *
   */
  const scheduleLiquidation = async () => {
    const closestLoan = orderedLoans.firstDebtRatio();
    if (!closestLoan) {
      return;
    }
    const {
      colLatestQuote,
      debtLatestQuote,
      loan
    } = await liquidationObserver.schedule(closestLoan);

    Array.from(orderedLoans.entries()).forEach(
      ([key, loan]) => {

        const collateralValInCompareCurrency = liquidationObserver.getValInCompareCurrency(loan.getCollateralAmount(),
          colLatestQuote, collateralBrand, collateralDecimalPlaces, manager.getExchangeRateForPool(collateralBrand));

        const debtValueInCompareCurrency = liquidationObserver.getValInCompareCurrency(loan.getCurrentDebt(),
          debtLatestQuote, manager.getUnderlyingBrand(), debtDecimalPlaces);

        const loanDebtToCollateral = makeRatioFromAmounts(collateralValInCompareCurrency, debtValueInCompareCurrency);

        if (ratioGTE(manager.getLiquidationMargin(), loanDebtToCollateral)) {
          loansToLiquidate.init(key, loan);
          orderedLoans.removeLoan(key);
        }
      },
    );

    await executeLiquidation();
    scheduleLiquidation();
  };

  orderedLoans.setRescheduler(scheduleLiquidation);

  /**
   *
   * @return {Promise<Awaited<unknown>[]>}
   */
  const executeLiquidation = async () => {
    console.log("insideExecuteLiquidation")
    console.log("loansToLiquidateSize", Array.from(loansToLiquidate.entries()).length)
    // Start all promises in parallel
    // XXX we should have a direct method to map over entries
    const liquidations = Array.from(loansToLiquidate.entries()).map(
      async ([key, loan]) => {
        trace('liquidating', loan.getLoanSeat().getProposal());

        try {
          // Start liquidation (loanState: LIQUIDATING)
          await liquidate(
            zcf,
            loan,
            liquidation.liquidator,
            manager.makeRedeemInvitation,
            collateralBrand,
            debtIssuer,
            manager.getPenaltyRate(),
            manager.transferLiquidatedFund,
            manager.debtPaid
          )

          loansToLiquidate.delete(key);
        } catch (e) {
          // XXX should notify interested parties
          console.error('liquidateAndRemove failed with', e);
        }
      },
    );
    return Promise.all(liquidations);
  };

  /**
   *
   * @param {Installation} liquidationInstall
   * @param {XYKAMMPublicFacet} ammPublicFacet
   */
  const setupLiquidator = async (
    liquidationInstall,
    ammPublicFacet
  ) => {
    const zoe = zcf.getZoeService();
    const liquidationTerms = liquidationDetailTerms(collateralBrand);

    trace('setup liquidator', {
      collateralBrand,
      liquidationTerms,
    });
    const { creatorFacet, instance } = await E(zoe).startInstance(
      liquidationInstall,
      harden({ In: collateralIssuer, Out: debtIssuer }),
      harden({
        ...liquidationTerms,
        amm: ammPublicFacet,
      }),
    );
    trace('setup liquidator complete', {
      instance,
      old: liquidation.instance,
      equal: liquidation.instance === instance,
    });
    liquidation.instance = instance;
    liquidation.liquidator = creatorFacet;
  };

  return Far('DebtsPerCollateral', {
    addNewLoan,
    setupLiquidator,
  })
};