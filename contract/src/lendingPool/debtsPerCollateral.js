import { makeScalarMap} from '@agoric/store';
import { makeInnerLoan } from './loan.js';
import { E } from '@agoric/eventual-send';
import { Far } from '@endo/marshal';
import {
  makeRatioFromAmounts,
} from '@agoric/zoe/src/contractSupport/index.js';
import { liquidationDetailTerms, liquidate } from './liquidation.js';
import { makeTracer } from '../makeTracer.js';
import { ratioGTE } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeLiquidationObserver } from './liquidationObserver.js';
import { makeLoanStoreUtils } from './loanStoreUtils.js';

const trace = makeTracer("DebtsPerCollateral");

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

  const collateralDecimalPlaces = collateralDisplayInfo?.decimalPlaces || 0n;
  const debtDecimalPlaces = debtDisplayInfo?.decimalPlaces || 0n;

  let loanCounter = 0;

  /** @type {MapStore<string, InnerLoan>} */
  const loans = makeScalarMap('loans');
  const loansToLiquidate = makeScalarMap('loansToLiquidate');
  const orderedLoans = makeLoanStoreUtils();
  const managerMethods = harden({
    ...manager,
    removeLoan: orderedLoans.removeLoan,
    refreshLoanPriorityByAttributes: orderedLoans.refreshLoanPriorityByAttributes,
    refreshLoanPriorityByKey: orderedLoans.refreshLoanPriorityByKey,
    removeLoanByAttributes: orderedLoans.removeLoanByAttributes
  });

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

  const addNewLoan = async (seat, underlyingAssetSeat, exchangeRate) => {
    loanCounter += 1;
    const loanId = String(loanCounter);
    console.log("addNewLoan")
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

  const scheduleLiquidation = async () => {
    const closestLoan = orderedLoans.firstDebtRatio();
    if (!closestLoan) {
      return;
    }
    const {
      colLatestQuote,
      debtLatestQuote,
      loan,
    } = await liquidationObserver.schedule(closestLoan);

    Array.from(orderedLoans.entries()).forEach(
      ([key, loan]) => {

        const collateralValInCompareCurrency = liquidationObserver.getValInCompareCurrency(loan.getCollateralAmount(),
          colLatestQuote, collateralBrand, collateralDecimalPlaces, manager.getExchangeRateForPool(collateralBrand));

        const debtValueInCompareCurrency = liquidationObserver.getValInCompareCurrency(loan.getCurrentDebt(),
          debtLatestQuote, manager.getUnderlyingBrand(), debtDecimalPlaces);

        const loanDebtToCollateral = makeRatioFromAmounts(collateralValInCompareCurrency, debtValueInCompareCurrency);

        if (ratioGTE(manager.getLiquidationMargin(), loanDebtToCollateral)) {
          console.log("satıyorum")
          loansToLiquidate.init(key, loan);
          orderedLoans.removeLoan(key);
        }
      },
    );

    await executeLiquidation();
    scheduleLiquidation();
  };

  orderedLoans.setRescheduler(scheduleLiquidation);

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