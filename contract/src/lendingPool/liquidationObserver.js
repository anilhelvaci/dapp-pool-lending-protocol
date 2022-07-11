import { observeNotifier } from '@agoric/notifier';
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
import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';

const tracer = makeTracer('LiquidationObserver');

/**
 * The purpose of this module is the observe and notify the interested other modules
 * about whether a specific loan is underwater or not. The main challenge is, there is no
 * priceAuthority where the brandIn is the collateral brand and the brandOut is the debt brand.
 * In our scenario we only have priceAuthorities brandIn is the collateral brand and brandOut
 * is the compareCurrency. The liquidationMargin is a ratio of the value of collateral in the compareCurrency
 * to the value of debt in the compareCurrency. That is why we need to be aware of the prices changes on both sides.
 * Because the value of collateral in terms of compareCurrency might go down meanwhile the value of debt going up.
 * Our approach here to be notified on every price change for both priceAuthorities where we receive a new quote
 * for one unit of brandIn(10n ** Nat(decimalPlaces)). Once we receive a new quote from any of priceAuthorities
 * we feed that quote to a generator function `checkLiquidation`. This function gets the new quote and compares it to
 * debt and collateral amounts of the loan at hand. This loan is specified in the `schedule` function.
 *
 * @see checkLiquidation
 * @see schedulde
 *
 * @param {LiquidationObserverOptions} options
 * @returns {LiquidationObserver}
 */
export const makeLiquidationObserver = (
  {
    wrappedCollateralPriceAuthority,
    wrappedDebtPriceAuthority,
    liquidationMargin,
    loanData,
    getExchangeRateForPool
  },
) => {

  const { debtBrand, collateralUnderlyingDecimals, debtDecimals,
    collateralUnderlyingBrand, compareBrand } = loanData;

  /**
   * @template T
   * @param {CheckLiquidationOptions<T>} options
   * @return {Generator<{state: string}, {state: string}, *>}
   */
  function* checkLiquidation({ colQuote, debtQuote, liqPromiseKit, loan }) {
    let colLatestQuote = colQuote;
    let debtLatestQuote = debtQuote;

    let state = "initial"
    const { brand: collateralUnderlyingBrand } = getAmountIn(colLatestQuote);
    let updates = {};

    while (true) {
      updates = yield {state};
      colLatestQuote = updates.colQuote && updates.colQuote !== undefined ? updates.colQuote : colLatestQuote;
      debtLatestQuote = updates.debtQuote && updates.debtQuote !== undefined ? updates.debtQuote : debtLatestQuote;
      tracer('Quotes & Updates', {
        colQuoteOut: getAmountOut(colLatestQuote),
        debtQuoteOut: getAmountOut(debtLatestQuote),
        updates
      });
      const collateral = loan.getCollateralAmount();
      const debt = loan.getCurrentDebt();
      const colValInCompare = getValInCompareCurrency(collateral, colLatestQuote,
        collateralUnderlyingBrand, collateralUnderlyingDecimals, getExchangeRateForPool(collateralUnderlyingBrand));

      const debtValInCompare = getValInCompareCurrency(debt, debtLatestQuote,
        debt.brand, debtDecimals, undefined);

      const colToDebtRatio = makeRatioFromAmounts(colValInCompare, debtValInCompare);

      if (ratioGTE(liquidationMargin, colToDebtRatio)) {
        liqPromiseKit.resolve({colLatestQuote, debtLatestQuote, loan});
        return { state: 'Liquidating' };
      }
      state = 'Active';
    }
  }

  /**
   *
   * @type GetValInCompareCurrency
   */
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

  // TODO Figure out what to do if any of the notifiers fall into 'fail' or 'finish' state
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

  /**
   * Called from the debtsPerCollateral when there's a new loan with a closer
   * debt/collateral ratio.
   *
   * @param {Loan} loan
   * @returns {Promise<{debtLatestQuote: PriceQuote, colLatestQuote: PriceQuote, loan: Loan}>}
   */
  const schedule = async (loan) => {
    if (checkLiqGenerator !== undefined) {
      checkLiqGenerator.return();
    }

    const { debtQuote, colQuote } = await getQuotes();
    const liqPromiseKit = makePromiseKit(); // This promise resolves when checkLiquidation returns

    checkLiqGenerator = checkLiquidation({ colQuote, debtQuote, liqPromiseKit, loan });
    checkLiqGenerator.next();
    return liqPromiseKit.promise;
  }

  /**
   * This method is used to fetch the initial quotes for debt and collateral
   *
   * @return {Promise<{colQuote: PriceQuote, debtQuote: PriceQuote}>}
   */
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