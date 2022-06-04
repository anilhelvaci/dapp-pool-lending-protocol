import { makeQuoteManager } from './quoteManager.js';
import { PRICE_CHECK_PERIOD_KEY } from './params.js';
import { observeNotifier } from '@agoric/notifier';
// import { makeScalarBigMapStore } from '@agoric/swingset-vat/src/storeModule';
import { makeScalarMap} from '@agoric/store';
import { makeInnerVault } from './vault.js';
import { E } from '@agoric/eventual-send';
import { Far } from '@endo/marshal';
import {
  assertProposalShape,
  makeRatioFromAmounts,
  getAmountOut,
  getAmountIn,
  ceilMultiplyBy,
  ceilDivideBy,
  makeRatio, floorMultiplyBy,
} from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import { Nat } from '@agoric/nat';
import { liquidationDetailTerms, liquidate } from './liquidation.js';
import { makeTracer } from '../makeTracer.js';
import { ratioGTE } from '@agoric/zoe/src/contractSupport/ratio.js';

const trace = makeTracer("DebtsPerCollateral");

export const makeDebtsPerCollateral = async (
  zcf,
  collateralBrand,
  debtBrand,
  assetNotifier,
  wrappedCollateralPriceAuthority,
  underlyingPriceAuthority,
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
  console.log("making makeQuoteManager")
  const initialQuote = await E(wrappedCollateralPriceAuthority.priceAuthority).quoteGiven(
    AmountMath.make(collateralBrand, 10n ** BigInt(collateralDecimalPlaces)),
    manager.getThirdCurrencyBrand(),
  );
  const quoteManager = makeQuoteManager(initialQuote);

  // initialize notifiers
  const collateralPriceNotifier = wrappedCollateralPriceAuthority.notifier;
  const liquidationNotifier = E(timer).makeNotifier(
    0n,
    timingParams[PRICE_CHECK_PERIOD_KEY].value,
  );

  const liquidation = {
    instance: undefined,
    liquidator: undefined
  }

  // set observers
  const liquidationObserver = {
    updateState: updateTime => {
      if (updateTime > 0 ) checkLiquidations();
      console.log("updateTime", updateTime);
      console.log('[INSIDE_LIQUIDATION]')
    },
    fail: reason => {

    },
    finish: done => {

    },
  };

  const collateralPriceObserver = {
    updateState: newQuote => {
      quoteManager.updateLatestQuote(newQuote);
      console.log("zaaaaaa");
      console.log("updatedQuote", getAmountOut(quoteManager.getLatestQuote()))
    },
    fail: reason => {

    },
    finish: done => {

    },
  };

  // register observers
  observeNotifier(liquidationNotifier, liquidationObserver);
  observeNotifier(collateralPriceNotifier, collateralPriceObserver);

  const addNewVault = async (seat, underlyingAssetSeat, exchangeRate) => {
    vaultCounter += 1;
    const vaultId = String(vaultCounter);
    console.log("addNewVault")
    const innerVault = makeInnerVault(
      zcf,
      manager,
      assetNotifier,
      vaultId,
      debtBrand,
      underlyingPriceAuthority,
      wrappedCollateralPriceAuthority.priceAuthority,
    );

    vaults.init(vaultId, innerVault);

    const vaultKit = await innerVault.initVaultKit(seat, underlyingAssetSeat, exchangeRate);
    seat.exit();
    return vaultKit;
  };
  let count = 0;
  const checkLiquidations = async () => {
    console.log("Checking Liquidations")
    Array.from(vaults.entries()).forEach(
       ([key, vault]) => {
         console.log("Count:", count);
         console.log("Collateral Quote:", getAmountOut(quoteManager.getLatestQuote()))
         console.log("Debt Quote:", getAmountOut(manager.getLatestUnderlyingQuote()))
         count++;
        const collateralValInCompareCurrency = getValInCompareCurrency(vault.getCollateralAmount(),
          quoteManager.getLatestQuote(), collateralBrand, collateralDecimalPlaces, manager.getExchangeRateForPool(collateralBrand));

        const debtValueInCompareCurrency = getValInCompareCurrency(vault.getCurrentDebt(),
          manager.getLatestUnderlyingQuote(), manager.getUnderlyingBrand(), debtDecimalPlaces);

        const vaultDebtToCollateral = makeRatioFromAmounts(collateralValInCompareCurrency, debtValueInCompareCurrency);
        console.log("vaultDebtToCollateral", vaultDebtToCollateral);
        console.log("liqMargin", manager.getLiquidationMargin());
        console.log("maxCol", floorMultiplyBy(debtValueInCompareCurrency, manager.getLiquidationMargin()))
        if (ratioGTE(manager.getLiquidationMargin(), vaultDebtToCollateral)) {
          console.log("satıyorum")
          vaultsToLiquidate.init(key, vault);
          vaults.delete(key);
        }
      },
    );

    // executeLiquidation here
    await executeLiquidation();
  };



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
            manager.transferLiquidatedFund
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


  const getValInCompareCurrency = (amountIn, latestQuote, scaleBrand, scaleDecimalPlaces, collateralExchangeRate ) => {
    const amountOut = getAmountOut(latestQuote);
    console.log("amountIn", amountIn)
    let testAmount;
    if(collateralExchangeRate !== undefined) {
      testAmount = floorMultiplyBy(
        amountIn,
        collateralExchangeRate,
      );
    } else testAmount = amountIn;

    return ceilMultiplyBy(
      testAmount,
      makeRatioFromAmounts(amountOut,
        AmountMath.make(scaleBrand, 10n ** Nat(scaleDecimalPlaces)))
    );
  }

  return Far('DebtsPerCollateral', {
    addNewVault,
    getFirstVault: () => vaults.get("1"),
    setupLiquidator,
    liquidateFirstVault
  })
};