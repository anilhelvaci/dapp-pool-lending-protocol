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
  makeRatio,
} from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import { Nat } from '@agoric/nat';

export const makeDebtsPerCollateral = (
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
  const collateralDisplayInfoP = E(collateralBrand).getDisplayInfo();
  const debtDisplayInfoP = E(manager.getUnderlyingBrand()).getDisplayInfo();
  let vaultCounter = 0;
  /** @type {MapStore<string, InnerVault>} */
  const vaults = makeScalarMap('vaults');
  const vaultsToLiquidate = makeScalarMap('vaultsToLiquidate');

  const quoteManager = makeQuoteManager();

  // initialize notifiers
  const collateralPriceNotifier = wrappedCollateralPriceAuthority.notifier;
  const liquidationNotifier = E(timer).makeNotifier(
    0n,
    timingParams[PRICE_CHECK_PERIOD_KEY].value,
  );

  // set observers
  const liquidationObserver = {
    updateState: updateTime => {
      // checkLiiquiditaions();
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

  const checkLiiquiditaions = async () => {
    const collateralDisplayInfo = await collateralDisplayInfoP;
    const collateralDecimalPlaces = collateralDisplayInfo?.decimalPlaces || 0n;

    const debtDisplayInfo = await debtDisplayInfoP;
    const debtDecimalPlaces = debtDisplayInfo?.decimalPlaces || 0n;

    Array.from(vaults.entries()).forEach(
       ([key, vault]) => {
        const collateralValInCompareCurrency = getValInCompareCurrenct(vault.getCollateralAmount(),
          quoteManager.getLatestQuote(), collateralBrand, collateralDecimalPlaces);

        const debtValueInCompareCurrency = getValInCompareCurrenct(vault.getCurrentDebt(),
          manager.getLatestUnderlyingQuote(), manager.getUnderlyingBrand(), debtDecimalPlaces);

        const vaultDebtToCollateral = makeRatioFromAmounts(debtValueInCompareCurrency, collateralValInCompareCurrency);

        if (ratioGTE(vaultDebtToCollateral, manager.getLiquidationMargin())) {
          vaultsToLiquidate.init(key, vault);
          vaults.delete(key);
        }
      },
    );

    // executeLiquidation here
  };

  const getValInCompareCurrenct = (amountIn, latestQuote, scaleBrand, scaleDecimalPlaces) => {
    return ceilMultiplyBy(
      amountIn,
      makeRatioFromAmounts(getAmountOut(latestQuote),
        AmountMath.make(scaleBrand, 10 ** Nat(scaleDecimalPlaces)))
    );
  }

  return Far('DebtsPerCollateral', {
    addNewVault
  })
};