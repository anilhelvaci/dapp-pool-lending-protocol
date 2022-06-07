import { observeIteration, observeNotifier } from '@agoric/notifier';
import { AmountMath } from '@agoric/ertp';
import {
  ceilMultiplyBy,
  floorMultiplyBy,
  makeRatioFromAmounts,
  ratioGTE,
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { makePromiseKit } from '@endo/promise-kit';
import { getAmountOut } from '@agoric/zoe/src/contractSupport/index.js';
import { getAmountIn } from '@agoric/zoe/src/contractSupport/priceQuote.js';
import { Nat } from '@agoric/nat';
import { E } from '@endo/far';

export const makeLiquidationObserver = (
  {
    wrappedCollateralPriceAuthority,
    wrappedDebtPriceAuthority,
    liquidationMargin,
    vaultData,
    getExchangeRateForPool
  },
) => {
  // console.log("liquidationMargin", liquidationMargin)
  const { debtBrand, collateralUnderlyingDecimals, debtDecimals,
    collateralUnderlyingBrand, compareBrand } = vaultData;

  function* checkLiquidation({ colQuote, debtQuote, liqPromiseKit, vault }) {
    let colLatestQuote = colQuote;
    let debtLatestQuote = debtQuote;
    // console.log("InitialQuotes", colLatestQuote, debtLatestQuote)
    let state = "initial"
    const { brand: collateralUnderlyingBrand } = getAmountIn(colLatestQuote);
    let updates = {};

    while (true) {
      updates = yield {state};
      colLatestQuote = updates.colQuote && updates.colQuote !== undefined ? updates.colQuote : colLatestQuote;
      debtLatestQuote = updates.debtQuote && updates.debtQuote !== undefined ? updates.debtQuote : debtLatestQuote;
      console.log('Quotes', getAmountOut(colLatestQuote), getAmountOut(debtLatestQuote));
      console.log('Updates', updates);
      const collateral = vault.getCollateralAmount();
      const debt = vault.getCurrentDebt();
      const colValInCompare = getValInCompareCurrency(collateral, colLatestQuote,
        collateralUnderlyingBrand, collateralUnderlyingDecimals, getExchangeRateForPool(collateralUnderlyingBrand));

      const debtValInCompare = getValInCompareCurrency(debt, debtLatestQuote,
        debt.brand, debtDecimals, undefined);

      const colToDebtRatio = makeRatioFromAmounts(colValInCompare, debtValInCompare);

      if (ratioGTE(liquidationMargin, colToDebtRatio)) {
        liqPromiseKit.resolve({colLatestQuote, debtLatestQuote, vault});
        return { state: 'Liquidating' };
      }
      state = 'Active';
    }
  }

  const getValInCompareCurrency = (amountIn, latestQuote, scaleBrand, scaleDecimalPlaces, collateralExchangeRate ) => {
    const amountOut = getAmountOut(latestQuote);
    // console.log("amountIn", amountIn)
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
  };

  let checkLiqGenerator;

  const colPriceObserver = {
    updateState: async newQuote => {
      if (checkLiqGenerator !== undefined ) {
        const state = checkLiqGenerator.next({ debtQuote: undefined, colQuote: newQuote });
        console.log("ColPriceObserver-State:", state);
      }
    },
    fail: reason => {

    },
    finish: done => {

    },
  };

  const debtPriceObserver = {
    updateState: async newQuote => {
      if (checkLiqGenerator !== undefined) {
        const state = checkLiqGenerator.next({ debtQuote: newQuote, colQuote: undefined });
        console.log("DebtPriceObserver-State:", state);
      }
    },
    fail: reason => {

    },
    finish: done => {

    },
  };

  observeNotifier(wrappedCollateralPriceAuthority.notifier, colPriceObserver);
  observeNotifier(wrappedDebtPriceAuthority.notifier, debtPriceObserver);

  const schedule = async (vault) => {
    if (checkLiqGenerator !== undefined) {
      checkLiqGenerator.return();
    }

    const { debtQuote, colQuote } = await getQuotes();
    const liqPromiseKit = makePromiseKit();

    checkLiqGenerator = checkLiquidation({ colQuote, debtQuote, liqPromiseKit, vault });
    checkLiqGenerator.next();
    return liqPromiseKit.promise;
  }

  const getQuotes = async () => {
    const [ debtQuote, colQuote ] = await Promise.all([
      E(wrappedDebtPriceAuthority.priceAuthority).quoteGiven(
        AmountMath.make(debtBrand, 10n ** BigInt(debtDecimals)),
        compareBrand,
      ),
      E(wrappedCollateralPriceAuthority.priceAuthority).quoteGiven(
        AmountMath.make(collateralUnderlyingBrand, 10n ** BigInt(collateralUnderlyingDecimals)),
        compareBrand,
      ),
    ]);

    return { debtQuote, colQuote };
  }

  return harden({ schedule, getValInCompareCurrency });
}