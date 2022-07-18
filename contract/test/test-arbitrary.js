import { test } from '@agoric/swingset-vat/tools/prepare-test-env-ava.js';

import '@agoric/zoe/exported.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { E } from '@agoric/eventual-send';
import { setupAssets } from './lendingPool/helpers.js';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import {
  ceilDivideBy, ceilMultiplyBy,
  floorMultiplyBy, getAmountOut,
  makeRatio,
  makeRatioFromAmounts,
  natSafeMath,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { makePriceManager } from '../src/lendingPool/priceManager.js';
import { makeLiquidationObserver } from '../src/lendingPool/liquidationObserver.js';
import { LARGE_DENOMINATOR, SECONDS_PER_YEAR, BASIS_POINTS } from '../src/interest.js';
import { makeScalarMap } from '@agoric/store';
import { Far } from '@endo/marshal';
import { fromVaultKey, toVaultKey } from '@agoric/run-protocol/src/vaultFactory/storeUtils.js';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';
import { waitForPromisesToSettle } from './lendingPool/test-lendingPool.js';
import { makeNotifierKit, observeNotifier } from '@agoric/notifier';
import { calculateExchangeRate } from '../src/protocolMath.js';
import { makeInterestCalculator } from '@agoric/run-protocol/src/interest.js';

const { subtract } = natSafeMath;

/**
 * This is the place where we test things about sdk and its methods.
 * Tests here do not consist of any business logic, only for exploring
 * the sdk and trying stuff.
 */

const makeObserver = () => {
  return harden({
    updateState: state => {
      console.log(`${state.notifierName}:`);
    },
    fail: reason => console.log(`${reason}`),
    finish: done => console.log(`${done}`),
  })
}

const ONE_DAY = 60n * 60n * 24n;
const ONE_MONTH = ONE_DAY * 30n;
const ONE_YEAR = ONE_MONTH * 12n;
const HUNDRED_THOUSAND = 100000n;
const TEN_MILLION = 10000000n;

test('math', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();

  const actualBrandIn = vanBrand;
  const actualBrandOut = usdBrand;
  const unitAmountIn = AmountMath.make(vanBrand, 100n);
  const currentPrice = 105n;

  const calcAmountOut = amountIn => {
    AmountMath.coerce(actualBrandIn, amountIn);

    return AmountMath.make(
      actualBrandOut,
      natSafeMath.floorDivide(
        natSafeMath.multiply(currentPrice, amountIn.value),
        unitAmountIn.value,
      ),
    );
  };
  const calcAmountIn = amountOut => {
    AmountMath.coerce(actualBrandOut, amountOut);
    return AmountMath.make(
      actualBrandOut,
      natSafeMath.floorDivide(
        natSafeMath.multiply(unitAmountIn.value, amountOut.value),
        currentPrice,
      ),
    );
  };

  const testAmountIn = AmountMath.make(vanBrand, 111111111n);
  const testAmountOut = calcAmountOut(testAmountIn);
  const calculatedAmountIn = calcAmountIn(testAmountOut);
  console.log('[TEST_AMOUNT_OUT]', testAmountOut);
  console.log('[CALC_AMOUNT_IN]', calculatedAmountIn);
  console.log('[DIFF]', natSafeMath.subtract(testAmountOut.value, testAmountIn.value));
  t.is('test', 'test');
});

test("price-observer-test", async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    agVanKit: {brand: agVanBrand}
  } = setupAssets();

  const timer = buildManualTimer(console.log, 0n, SECONDS_PER_YEAR);

  const vanUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand),
    timer
  });

  const panUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(180n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand),
    timer,
  });

  const priceManager = makePriceManager({});

  await E(priceManager).addNewWrappedPriceAuthority(vanBrand, vanUsdPriceAuthority, usdBrand);
  await E(priceManager).addNewWrappedPriceAuthority(panBrand, panUsdPriceAuthority, usdBrand);

  const wrappedVanUsdPriceAuth = await E(priceManager).getWrappedPriceAuthority(vanBrand);
  const wrappedPanUsdPriceAuth = await E(priceManager).getWrappedPriceAuthority(panBrand);

  const liqObserver = makeLiquidationObserver(
    harden({
      wrappedCollateralPriceAuthority: wrappedVanUsdPriceAuth,
      wrappedDebtPriceAuthority: wrappedPanUsdPriceAuth,
      liquidationMargin: makeRatio(150n, usdBrand),
      loanData: {
        debt: AmountMath.make(panBrand, 35n * 10n ** 6n),
        collateral: AmountMath.make(agVanBrand, 10n ** 8n * 50n),
        collateralUnderlyingDecimals: 8,
        debtDecimals: 8,
        collateralUnderlyingBrand: vanBrand,
        compareBrand: usdBrand
      },
      getExchangeRateForPool: brand => makeRatioFromAmounts(AmountMath.make(vanBrand, 2000000n),
        AmountMath.make(agVanBrand, BigInt(LARGE_DENOMINATOR))),
    }));

  E(vanUsdPriceAuthority).setPrice(makeRatio(65n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  // await new Promise(resolve => setTimeout(resolve, 1000))
  // await waitForPromisesToSettle();
  E(panUsdPriceAuthority).setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // await waitForPromisesToSettle()
  E(panUsdPriceAuthority).setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // await waitForPromisesToSettle()
  E(panUsdPriceAuthority).setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // await waitForPromisesToSettle()
  E(panUsdPriceAuthority).setPrice(makeRatio(192n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // await waitForPromisesToSettle()
  E(panUsdPriceAuthority).setPrice(makeRatio(131n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // await waitForPromisesToSettle();


  await new Promise(resolve => setTimeout(resolve, 1000))

  E(vanUsdPriceAuthority).setPrice(makeRatio(65n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  t.is("ss", "ss")
});

test('map-test', async t => {
  await new Promise(resolve => setTimeout(resolve, 5000))
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();

  const map = makeScalarMap('test');

  const methodUnderTest = (normalizedDebt, collateral) => {
    const c = Number(collateral.value);
    const d = normalizedDebt.value
      ? Number(normalizedDebt.value)
      : Number.EPSILON;
    return ((c / d) / Number(10n ** 20n)).toFixed(50);
  };

  const testAmountNumeratorOne = AmountMath.make(vanBrand,  4n * 10n ** 7n );
  const testAmountDenominatorOne = AmountMath.make(panBrand, 50n * 10n ** 8n);
  const numberPartOne = methodUnderTest(testAmountNumeratorOne, testAmountDenominatorOne);
  const loanIdOne = '1';
  const keyOne = `${numberPartOne}:${loanIdOne}`

  const testAmountNumeratorTwo = AmountMath.make(vanBrand, 61n * 10n ** 6n);
  const testAmountDenominatorTwo = AmountMath.make(panBrand, 50n * 10n ** 8n);
  const numberPartTwo = methodUnderTest(testAmountNumeratorTwo, testAmountDenominatorTwo);
  const loanIdTwo = '2';
  const keyTwo = `${numberPartTwo}:${loanIdTwo}`

  const testAmountNumeratorThree = AmountMath.make(vanBrand, 60n * 10n ** 6n );
  const testAmountDenominatorThree = AmountMath.make(panBrand, 50n * 10n ** 8n);
  const numberPartThree = methodUnderTest(testAmountNumeratorThree, testAmountDenominatorThree);
  const loanIdThree = '3';
  const keyThree = `${numberPartThree}:${loanIdThree}`

  map.init(keyTwo, undefined);
  map.init(keyThree, undefined);
  map.init(keyOne, undefined);
  map.init(Far(makeRatioFromAmounts(testAmountNumeratorOne, testAmountDenominatorOne)), undefined);
  const keyArray = Array.from(map.keys());
  keyArray.forEach(key => console.log(key));

  // console.log("keys", keyTwo > keyOne);
  // console.log("keys", keyThree > keyOne);
  //
  // console.log("last", keyArray[keyArray.length - 1]);

  t.is("test", "test");
});

test('store-utils-test', async t => {
  await new Promise(resolve => setTimeout(resolve, 5000))
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();

  const vaultKey = toVaultKey(
    AmountMath.make(vanBrand, 10n ** 8n),
    AmountMath.make(panBrand, 3n * 10n ** 8n),
    '1'
  );

  console.log(vaultKey);

  const map = makeScalarMap('test');

  const testAmountNumeratorOne = AmountMath.make(vanBrand,  4n * 10n ** 7n );
  const testAmountDenominatorOne = AmountMath.make(panBrand, 50n * 10n ** 8n);
  const keyOne = toVaultKey(testAmountNumeratorOne, testAmountDenominatorOne, '1');

  const testAmountNumeratorTwo = AmountMath.make(vanBrand, 61n * 10n ** 6n);
  const testAmountDenominatorTwo = AmountMath.make(panBrand, 50n * 10n ** 8n);
  const keyTwo = toVaultKey(testAmountNumeratorTwo, testAmountDenominatorTwo, '2');

  const testAmountNumeratorThree = AmountMath.make(vanBrand, 60n * 10n ** 6n );
  const testAmountDenominatorThree = AmountMath.make(panBrand, 50n * 10n ** 8n);
  const keyThree = toVaultKey(testAmountNumeratorThree, testAmountDenominatorThree, '3');

  map.init(keyTwo, undefined);
  map.init(keyThree, undefined);
  map.init(keyOne, undefined);
  // map.init(Far(makeRatioFromAmounts(testAmountNumeratorOne, testAmountDenominatorOne)), undefined);
  const keyArray = Array.from(map.keys());
  keyArray.forEach(key => console.log(key));
  keyArray.forEach(key => console.log(fromVaultKey(key)));

  t.is("test", "test");
});

test('principal-money-from-compounded', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();

  const compoundedInterest = makeRatio(100027321431303571702n, vanBrand, 100000000000000000000n);
  const principal = AmountMath.make(vanBrand, 15555554n);
  const totalDebt = floorMultiplyBy(principal, compoundedInterest);

  t.is(totalDebt.value, 15559804n);
});

test('price-authority-test', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();

  const timer = buildManualTimer(console.log);

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 103n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 10n ** 8n),
    quoteInterval: 1n,
  });

  const quote105 = await vanUsdPriceAuthority.quoteGiven(
    AmountMath.make(vanBrand, 4n * 10n ** 8n),
    usdBrand,
  );

  t.deepEqual(getAmountOut(quote105), AmountMath.make(usdBrand, 420n));
  await timer.tick();
  await waitForPromisesToSettle();

  const quote103 = await vanUsdPriceAuthority.quoteGiven(
    AmountMath.make(vanBrand, 4n * 10n ** 8n),
    usdBrand,
  );
  t.deepEqual(getAmountOut(quote103), AmountMath.make(usdBrand, 412n));

  await timer.tick();
  await waitForPromisesToSettle();

  const quote101 = await vanUsdPriceAuthority.quoteGiven(
    AmountMath.make(vanBrand, 4n * 10n ** 8n),
    usdBrand,
  );
  t.deepEqual(getAmountOut(quote101), AmountMath.make(usdBrand, 404n));
});

test('notifier', async t => {
  const { updater: assetUpdaterOne, notifier: assetNotiferOne } = makeNotifierKit();
  const { updater: assetUpdaterTwo, notifier: assetNotiferTwo } = makeNotifierKit();
  const { updater: assetUpdaterThree, notifier: assetNotiferThree } = makeNotifierKit();

  observeNotifier(assetNotiferOne, makeObserver());
  observeNotifier(assetNotiferTwo, makeObserver());
  observeNotifier(assetNotiferThree, makeObserver());

  assetUpdaterOne.updateState(harden({
    notifierName: 'Notifier-ONE'
  }));

  console.log('----Waiting----')
  await new Promise(resolve => setTimeout(resolve, 1000));

  assetUpdaterTwo.updateState(harden({
    notifierName: 'Notifier-TWO'
  }));

  console.log('----Waiting----')
  await new Promise(resolve => setTimeout(resolve, 1000));

  assetUpdaterThree.updateState(harden({
    notifierName: 'Notifier-THREE'
  }));

  t.is('dummy', 'dummy');
});

test('any', async t => {
  const pro1 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro1' }), 100);
  });

  const pro2 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro2' }), 110);
  });

  const pro3 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro3' }), 30000);
  });

  const pro4 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro4' }), 40000);
  });

  let promises = {pro1, pro2, pro3, pro4};

  let response = await Promise.race(Object.values(promises))

  delete promises[response.id]

  console.log(response);
  console.log(promises);

  response = await Promise.race(Object.values(promises))
  console.log(response);
  console.log(promises);

  t.is('dummy', 'dummy');
});

test('timer', async t => {
  const pro1 = new Promise((resolve, reject) => {
    setTimeout(() => resolve({ id: 'pro1' }), 100);
  });
  const timer = buildManualTimer(console.log);

  const periodNotifier = E(timer).makeNotifier(
    5n,
    3n,
  );

  const timerObserve= {
    updateState: updateTime =>{
      console.log('update', updateTime)

    },
    fail: reason => {

    },
    finish: done => {

    },
  }

  observeNotifier(periodNotifier, timerObserve);

  // for (let i = 0; i < 10; i++) {
  //   timer.tick();
  //   // await pro1;
  // }
  // await waitForPromisesToSettle();

  await timer.tick();
  t.is('dummy', 'dummy');
});

test('how-many-to-mint', t => {
  const { issuer: underlyingIssuer, mint: underlyingMint, brand: underlyingBrand }
    = makeIssuerKit('underlying', AssetKind.NAT, harden({ decimalPlaces: 8 }));

  const { issuer: protocolIssuer, mint: protocolMint, brand: protocolBrand }
    = makeIssuerKit('protocol', AssetKind.NAT, harden({ decimalPlaces: 6 }));

  t.is(underlyingBrand.getDisplayInfo().decimalPlaces, 8);
  t.is(protocolBrand.getDisplayInfo().decimalPlaces, 6);

  let exchangeRate = makeRatio(200n, underlyingBrand, 10000n, protocolBrand);

  t.is(exchangeRate.numerator.brand.getDisplayInfo().decimalPlaces, 8);
  t.is(exchangeRate.denominator.brand.getDisplayInfo().decimalPlaces, 6);

  const depositAmount = AmountMath.make(underlyingBrand, 111111111n);

  const protocolMintAmount = ceilDivideBy(depositAmount, exchangeRate);

  console.log('[CEIL_DIVIDE_BY]', protocolMintAmount);

  exchangeRate = calculateExchangeRate(depositAmount, AmountMath.make(underlyingBrand, 200n), protocolMintAmount);

  const redeemAmount = ceilMultiplyBy(protocolMintAmount, exchangeRate);
  console.log('[CEIL_MULTIPLY_BY]', redeemAmount);
  const protift = subtract(redeemAmount.value, depositAmount.value);
  console.log('[PROFIT]', protift);
  const protfitRatio = Number(protift) / Number(depositAmount.value);
  console.log('[PROFIT_RATIO]', protfitRatio);
});

test('interest', async t => {
  const { issuer: underlyingIssuer, mint: underlyingMint, brand: underlyingBrand }
    = makeIssuerKit('underlying', AssetKind.NAT, harden({ decimalPlaces: 8 }));

  const { issuer: protocolIssuer, mint: protocolMint, brand: protocolBrand }
    = makeIssuerKit('protocol', AssetKind.NAT, harden({ decimalPlaces: 6 }));

  let exchangeRate = makeRatio(200n, underlyingBrand, BASIS_POINTS, protocolBrand);
  const calculator = makeInterestCalculator(exchangeRate, ONE_DAY, ONE_MONTH);

  const debtStatus = {
    newDebt: HUNDRED_THOUSAND,
    latestInterestUpdate: 0n,
    interest: 0n,
  };

  const depositAmount = AmountMath.make(underlyingBrand, 111111111n);
  const protocolMintAmount = ceilDivideBy(depositAmount, exchangeRate);
  console.log('[CEIL_DIVIDE_BY]', protocolMintAmount);

  const borrowAmount = AmountMath.make(underlyingBrand, HUNDRED_THOUSAND);
  const cash = AmountMath.subtract(depositAmount, borrowAmount);

  const calculatedInterest = calculator.calculate(debtStatus, ONE_DAY * 7n);
  t.deepEqual(calculatedInterest, {
    latestInterestUpdate: ONE_DAY * 7n,
    interest: 42n,
    newDebt: 100042n,
  });
  console.log('[NEW_DEBT]', calculatedInterest.newDebt);

  const accruedBorrowAmount = AmountMath.make(underlyingBrand, calculatedInterest.newDebt);

  exchangeRate = calculateExchangeRate(cash, accruedBorrowAmount, protocolMintAmount);

  const redeemAmountExpected = AmountMath.make(underlyingBrand, 111111153n);
  const redeemAmountActual = ceilMultiplyBy(protocolMintAmount, exchangeRate);
  console.log('[REDEEM_ACTUAL]', redeemAmountActual);
  t.deepEqual(redeemAmountActual, redeemAmountExpected);
})
