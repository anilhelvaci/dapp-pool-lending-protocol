import { makeScalarMap} from '@agoric/store';
import { makeInnerVault } from './vault.js';
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

  let vaultCounter = 0;

  /** @type {MapStore<string, InnerVault>} */
  const vaults = makeScalarMap('vaults');
  const vaultsToLiquidate = makeScalarMap('vaultsToLiquidate');
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
    vaultData: {
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

  const addNewVault = async (seat, underlyingAssetSeat, exchangeRate) => {
    vaultCounter += 1;
    const vaultId = String(vaultCounter);
    console.log("addNewVault")
    const innerVault = makeInnerVault(
      zcf,
      managerMethods,
      assetNotifier,
      vaultId,
      debtBrand,
      underlyingPriceAuthority,
      wrappedCollateralPriceAuthority.priceAuthority,
    );

    const vaultKey = orderedLoans.addLoan(vaultId, innerVault);
    const vaultKit = await innerVault.initVaultKit(seat, underlyingAssetSeat, exchangeRate, vaultKey);
    seat.exit();
    return vaultKit;
  };

  const scheduleLiquidation = async () => {
    const closestVault = orderedLoans.firstDebtRatio();
    if (!closestVault) {
      return;
    }
    const {
      colLatestQuote,
      debtLatestQuote,
      vault,
    } = await liquidationObserver.schedule(closestVault);

    Array.from(orderedLoans.entries()).forEach(
      ([key, vault]) => {

        const collateralValInCompareCurrency = liquidationObserver.getValInCompareCurrency(vault.getCollateralAmount(),
          colLatestQuote, collateralBrand, collateralDecimalPlaces, manager.getExchangeRateForPool(collateralBrand));

        const debtValueInCompareCurrency = liquidationObserver.getValInCompareCurrency(vault.getCurrentDebt(),
          debtLatestQuote, manager.getUnderlyingBrand(), debtDecimalPlaces);

        const vaultDebtToCollateral = makeRatioFromAmounts(collateralValInCompareCurrency, debtValueInCompareCurrency);

        if (ratioGTE(manager.getLiquidationMargin(), vaultDebtToCollateral)) {
          console.log("satıyorum")
          vaultsToLiquidate.init(key, vault);
          orderedLoans.removeLoan(key);
        }
      },
    );

    await executeLiquidation();
    scheduleLiquidation();
  };

  orderedLoans.setRescheduler(scheduleLiquidation);

  const liquidateFirstVault = async () => {
    const firstVault = vaults.get("1");
    await liquidate(
      zcf,
      firstVault,
      liquidation.liquidator,
      manager.makeRedeemInvitation,
      collateralBrand,
      debtIssuer,
      manager.getPenaltyRate(),
      manager.transferLiquidatedFund
    )
  }

  const executeLiquidation = async () => {
    console.log("insideExecuteLiquidation")
    console.log("vaultsToLiquidateSize", Array.from(vaultsToLiquidate.entries()).length)
    // Start all promises in parallel
    // XXX we should have a direct method to map over entries
    const liquidations = Array.from(vaultsToLiquidate.entries()).map(
      async ([key, vault]) => {
        trace('liquidating', vault.getVaultSeat().getProposal());

        try {
          // Start liquidation (vaultState: LIQUIDATING)
          await liquidate(
            zcf,
            vault,
            liquidation.liquidator,
            manager.makeRedeemInvitation,
            collateralBrand,
            debtIssuer,
            manager.getPenaltyRate(),
            manager.transferLiquidatedFund,
            manager.debtPaid
          )

          vaultsToLiquidate.delete(key);
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
    addNewVault,
    getFirstVault: () => vaults.get("1"),
    setupLiquidator,
    liquidateFirstVault
  })
};