// @ts-check
import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';

const trace = makeTracer('TestST');

import { test as unknownTest } from '@agoric/zoe/tools/prepare-test-env-ava.js'; // swingset-vat to zoe
import '@agoric/zoe/exported.js';
import { deeplyFulfilled } from '@endo/marshal';

import { E } from '@endo/far';
import { makeIssuerKit, AssetKind, AmountMath } from '@agoric/ertp';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import {
  makeRatio,
  floorDivideBy,
  floorMultiplyBy,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makePromiseKit } from '@endo/promise-kit';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';
import { makePriceManager } from '../../src/lendingPool/priceManager.js';
import {
  depositMoney,
  addPool,
  makeRates,
  setupAssets,
  borrow,
  makeMarketStateChecker,
  getPoolMetadata,
  calculateUnderlyingFromProtocol,
  calculateProtocolFromUnderlying, splitCollateral, adjust, closeLoan,
} from './helpers.js';

import {
  setUpZoeForTest,
  getPath,
  startLendingPool,
  setupAmmAndElectorate,
} from './setup.js';
import { SECONDS_PER_YEAR } from '../../src/interest.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import { unsafeMakeBundleCache } from '@agoric/run-protocol/test/bundleTool.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { LoanPhase } from '../../src/lendingPool/loan.js';
import { oneMinus } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeLendingPoolAssertions } from './lendingPoolAssertions.js';
import { ADJUST_PROPOSAL_TYPE, makeLendingPoolScenarioHelpers, POOL_TYPES } from './lendingPoolScenrioHelpers.js';

const test = unknownTest;

const contractRoots = {
  faucet: './faucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  amm: '@agoric/run-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js',
};

const BASIS_POINTS = 10000n;
const secondsPerDay = SECONDS_PER_YEAR / 365n;

// Define locally to test that loanFactory uses these values
export const Phase = /** @type {Object} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
});

// Some notifier updates aren't propagating sufficiently quickly for the tests.
// This invocation (thanks to Warner) waits for all promises that can fire to
// have all their callbacks run
export async function waitForPromisesToSettle() {
  const pk = makePromiseKit();
  setImmediate(pk.resolve);
  return pk.promise;
}

/**
 * This function installs and instantiates lendingPool and amm contracts alongside
 * with all the necessary variables.
 *
 * For the tests here, we've determined 3 types of tokens to run our tests. Those
 * tokens; VAN, PAN and USD. Here we use all those digital assets to set our
 * environment up.
 *
 * @param t
 * @param {ManualTimer} timer
 * @param ammPoolsConfig
 * @returns {Promise<{zoe: *, timer: (ManualTimer|*), ammFacets: {instance: *, ammPanPoolLiquidity: *, ammCreatorFacet: *, ammPublicFacet: GovernedPublicFacet<XYKAMMPublicFacet>, ammVanPoolLiquidity: *}, lendingPool: {lendingPoolPublicFacet: unknown extends (object & {then(onfulfilled: infer F): any}) ? (F extends ((value: infer V, ...args: any) => any) ? Awaited<V> : never) : unknown, lendingPoolCreatorFacet: unknown extends (object & {then(onfulfilled: infer F): any}) ? (F extends ((value: infer V, ...args: any) => any) ? Awaited<V> : never) : unknown}, scenarioHelpers: LendingPoolScenarioHelpers, governor: {governorInstance: unknown extends (object & {then(onfulfilled: infer F): any}) ? (F extends ((value: infer V, ...args: any) => any) ? Awaited<V> : never) : unknown, governorCreatorFacet: *, governorPublicFacet: *}, assertions}>}
 */
async function setupServices(
  t,
  timer = buildManualTimer(t.log),
  ammPoolsConfig = undefined,
) {
  const {
    zoe,
    compareCurrencyKit: { brand: compCurrencyBrand, mint: compCurrencyMint },
    vanKit: { brand: vanBrand, issuer: vanIssuer, mint: vanMint },
    panKit: { brand: panBrand, issuer: panIssuer, mint: panMint },
    loanTiming,
  } = t.context;
  t.context.timer = timer;

  const {
    compareVanInitialLiquidityValue,
    comparePanInitialLiquidityValue,
    vanInitialLiquidityValue,
    panInitialLiquidityValue,
  } = ammPoolsConfig ? ammPoolsConfig : t.context.ammPoolsConfig;

  const van = value => AmountMath.make(vanBrand, value);
  const pan = value => AmountMath.make(panBrand, value);
  const usd = value => AmountMath.make(compCurrencyBrand, value);

  const compareVanPoolPayment = compCurrencyMint.mintPayment(usd(compareVanInitialLiquidityValue));

  const compLiquidityVanPool = {
    proposal: harden(usd(compareVanInitialLiquidityValue)),
    payment: compareVanPoolPayment,
  };

  const vanLiquidity = {
    proposal: van(vanInitialLiquidityValue),
    payment: vanMint.mintPayment(van(vanInitialLiquidityValue)),
  };

  const comparePanPoolPayment = compCurrencyMint.mintPayment(usd(comparePanInitialLiquidityValue));

  const compLiquidityPanPool = {
    proposal: harden(usd(comparePanInitialLiquidityValue)),
    payment: comparePanPoolPayment,
  };

  const panLiquidity = {
    proposal: pan(panInitialLiquidityValue),
    payment: panMint.mintPayment(pan(panInitialLiquidityValue)),
  };
  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    t,
    vanLiquidity,
    compLiquidityVanPool,
    panLiquidity,
    compLiquidityPanPool
  );
  const { consume, produce, instance } = space;
  // trace(t, 'amm', { ammFacets });

  const {
    installation: { produce: iProduce },
  } = space;
  iProduce.LendingPool.resolve(t.context.installation.LendingPool);
  iProduce.liquidate.resolve(t.context.installation.liquidate);
  /** @type PriceManager*/
  const priceManager = makePriceManager({});
  produce.priceManager.resolve(priceManager);

  await startLendingPool(space, { loanParams: loanTiming });

  const governorCreatorFacet = consume.lendingPoolGovernorCreator;
  /** @type {Promise<LendingPoolCreatorFacet>} */
  const lendingPoolCreatorFacetP = (
    E(governorCreatorFacet).getCreatorFacet()
  );

  /** @type {[any, LendingPoolCreatorFacet, LendingPoolPublicFacet]} */
  const [
      governorInstance,
      lendingPoolCreatorFacet,
      lendingPoolPublicFacet,
    ] = await Promise.all([
      instance.consume.lendingPoolGovernor,
      lendingPoolCreatorFacetP,
      E(governorCreatorFacet).getPublicFacet(),
    ]);

  const { g, l } = {
    g: {
      governorInstance,
      governorPublicFacet: E(zoe).getPublicFacet(governorInstance),
      governorCreatorFacet,
    },
    l: {
      lendingPoolCreatorFacet,
      lendingPoolPublicFacet,
    },
  };

  /** @type LendingPoolScenarioHelpers */
  const scenarioHelpers = makeLendingPoolScenarioHelpers(
    zoe,
    { lendingPoolCreatorFacet, lendingPoolPublicFacet },
    timer,
    compCurrencyBrand,
    vanMint,
    panMint);

  const assertions = makeLendingPoolAssertions(t);

  return {
    zoe,
    governor: g,
    lendingPool: l,
    ammFacets,
    timer,
    assertions,
    scenarioHelpers,
  };
}

/**
 * Runs before every test separetly and injects necessary data to its `context`
 * property.
 */
test.before(async t => {
  const { zoe } = setUpZoeForTest();

  const bundleCache = await unsafeMakeBundleCache('./bundles/'); // package-relative
  // note that the liquidation might be a different bundle name
  const bundles = await Collect.allValues({
    faucet: bundleCache.load(await getPath(contractRoots.faucet), 'faucet'),
    liquidate: bundleCache.load(await getPath(contractRoots.liquidate), 'liquidateMinimum'),
    LendingPool: bundleCache.load(await getPath(contractRoots.LendingPool), 'lendingPool'),
    amm: bundleCache.load(await getPath(contractRoots.amm), 'amm'),
  });
  const installation = Collect.mapValues(bundles, bundle =>
    E(zoe).install(bundle),
  );

  const { vanKit, usdKit, panKit, agVanKit } = setupAssets();

  const contextPs = {
    zoe,
    bundles,
    installation,
    electorateTerms: undefined,
    vanKit,
    compareCurrencyKit: usdKit,
    panKit,
    agVanKit,
    loanTiming: {
      chargingPeriod: 2n,
      recordingPeriod: 6n,
      priceCheckPeriod: 6n,
    },
    minInitialDebt: 50n,
    vanRates: makeRates(vanKit.brand, usdKit.brand),
    panRates: makeRates(panKit.brand, usdKit.brand),
    vanInitialLiquidity: AmountMath.make(vanKit.brand, 300n),
    panInitialLiquidity: AmountMath.make(panKit.brand, 300n),
    ammPoolsConfig: {
      compareVanInitialLiquidityValue: 1n * 100n * 10n ** 6n,
      comparePanInitialLiquidityValue: 1n * 100n * 10n ** 6n,
      vanInitialLiquidityValue: 90n * 10n ** 8n * 100n,
      panInitialLiquidityValue: 100n * 10n ** 8n * 100n
    },
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = { ...frozenCtx, bundleCache };
  // trace(t, 'CONTEXT');
});

/**
 * Here we basically test the setupServices method. This test does not have
 * any importance when it comes to work logic.
 */
test('initial', async t => {
  const services = await setupServices(t,);
  console.log('services', services);
  t.is('is', 'is');
});

/**
 * Adds a new pool to the protocol. Asserts that the pool has the underlyingBrand
 * and PoolManager received is the object that we received from the 'addPool' method.
 */
test('add-pool', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    vanRates,
  } = t.context;

  const {
    lendingPool: { lendingPoolPublicFacet },
    assertions: { assertPoolAddedCorrectly },
    scenarioHelpers: { addPool }
  } = await setupServices(t);

  const price = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const { poolManager: vanPoolMan } = await addPool(vanRates,price, 'VAN', POOL_TYPES.COLLATERAL);

  await assertPoolAddedCorrectly(vanPoolMan, lendingPoolPublicFacet);
});

/**
 * Checks the deposit functionality. Numbers used here are arbitrary. We only care about
 * whether the deposit operation is successful or not.
 *
 * Asserts the underlying liquidity, the protocol liquidity and the offer result.
 */
test('deposit', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    vanRates,
  } = t.context;

  const {
    assertions: { assertDepositedCorrectly },
    scenarioHelpers: { addPool, depositMoney }
  } = await setupServices(t);

  // Add the pool to deposit money
  const price = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const { poolManager: vanPoolMan } = await addPool(vanRates, price, 'VAN', POOL_TYPES.COLLATERAL);

  const [{ protocolBrand, protocolIssuer, exchangeRate }, { checkMarketStateInSync }] = await Promise.all([
    getPoolMetadata(vanPoolMan),
    makeMarketStateChecker(t, vanPoolMan),
  ])
  trace('Protocol Metadata', {
    protocolBrand,
    protocolIssuer
  });

  const { amount: protocolAmountReceived, offerResult: message } = await depositMoney(POOL_TYPES.COLLATERAL, 1n);
  const vanAmountIn = AmountMath.make(vanBrand, 10n ** 8n);
  const shouldReceiveProtocolAmount = floorDivideBy(vanAmountIn, exchangeRate);

  await Promise.all([
    assertDepositedCorrectly(vanPoolMan, shouldReceiveProtocolAmount, vanAmountIn, protocolAmountReceived, message),
    checkMarketStateInSync(),
  ]);
});

/**
 * Basically the same test as above. But this time we assert that the deposit
 * method throws an error if we use a wrong protocolAmountOut.
 */
test('deposit - false protocolAmountOut', async t => {
  /** @type TestContext */
  const {
    vanKit: { brand: vanBrand, mint: vanMint },
    compareCurrencyKit: { brand: usdBrand },
    vanRates,
    /** @type ZoeService */ zoe
  } = t.context;

  const { scenarioHelpers: { addPool } } = await setupServices(t);

  const price = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const { poolManager: vanPoolMan } = await addPool(vanRates, price, 'VAN', POOL_TYPES.COLLATERAL);
  const { protocolBrand, exchangeRate } = await getPoolMetadata(vanPoolMan);
  const underlyingAmountIn = AmountMath.make(vanBrand, 10n ** 8n);
  const exceedAmount = AmountMath.make(protocolBrand, 10n);
  const protocolAmountOut = AmountMath.add(floorDivideBy(underlyingAmountIn, exchangeRate), exceedAmount);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: vanMint.mintPayment(underlyingAmountIn),
  });

  /** @type UserSeat */
  const seat = E(zoe).offer(
    E(vanPoolMan).makeDepositInvitation(),
    proposal,
    paymentKeywordRecord,
  );

  await t.throwsAsync(E(seat).getOfferResult());
});

/**
 * This the base scenario for borrows. We create 2 separete pools, deposit money
 * in both of them. VAN pool is used to get the protocol tokens(AgVAN) to be used as
 * collateral to borrow some PAN from the PAN pool.
 *
 * Asserts
 * - Check if PAN pool has enough liquidity to lend money
 * - Check if the current debt on the loan is equal to the wanted debt
 */
test('borrow', async t => {
  // Destructure bootstraped data
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  // Set loan timing
  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 5n,
    priceCheckPeriod: secondsPerDay * 5n * 2n,
  };

  t.plan(27);

  // Start services
  const { lendingPool: { lendingPoolPublicFacet }, assertions, scenarioHelpers } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay * 5n),
  );

  const { assertEnoughLiquidityInPool, assertBorrowSuccessfulNoInterest } = assertions;
  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN',POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }, poolNotifier] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
    E(lendingPoolPublicFacet).getPoolNotifier(),
  ]);

  // Put money inside the pools
  await depositMoney(POOL_TYPES.COLLATERAL, 1n);
  await depositMoney(POOL_TYPES.DEBT, 10n);

  // Check market state after deposit
  const [{value: latestPoolState}] = await Promise.all([
    E(poolNotifier).getUpdateSince(),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  trace('POOLS', latestPoolState);

  // Check if the pool has enough liquidty
  const panPoolInitialliquidity = AmountMath.make(panBrand, 10n * 10n ** 8n);
  await assertEnoughLiquidityInPool(panPoolMan, panPoolInitialliquidity);

  const { loanKit: { loan } }  =
    await borrow(10n ** 8n, 4n * 10n ** 6n);

  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, loan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      underlyingBalanceBefore: panPoolInitialliquidity,
      borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
    }),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

});

/**
 * In this test we want to see that the borrowing rate fluctuates correctly
 * according to the changes in the borrow amount.
 */
test('borrow-rate-fluctuate', async t => {
  // Destructure bootstraped data
  /** @type {{
   * zoe: ZoeService
  }} TestContext */
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
    zoe,
  } = t.context;

  // Set loan timing
  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  // Setup services
  const {
    timer,
    assertions,
    scenarioHelpers,
  } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
  );

  const { assertEnoughLiquidityInPool, assertBorrowSuccessfulNoInterest, assertInterestCharged } = assertions;
  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 10n),
    depositMoney(POOL_TYPES.DEBT, 4n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 4n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: bobLoan }
  } = await borrow(10n ** 8n, 4n * 10n ** 6n);

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, bobLoan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 4n * 10n ** 8n),
      borrowingRate: makeRatio(270n, panBrand, BASIS_POINTS),
    }),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const { loanKit: { loan: aliceLoan } } = await borrow(10n ** 8n, 2n * 10n ** 6n);

  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 2n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 6n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 396000000n),
      borrowingRate: makeRatio(280n, panBrand, BASIS_POINTS),
    }),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
  // Accrue some interest
  await timer.tick();
  await waitForPromisesToSettle();

  const expectedValuesAfterInterest = {
    principalDebt: 6n * 10n ** 6n,
    accruedInterest: 3183n,
    exchangeRateNumerator: 2000016n,
    borrowingRate: 281n,
  };

  await Promise.all([
    assertInterestCharged(panPoolMan, expectedValuesAfterInterest),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * Here we first get a loan for Alice then update the loan by putting more
 * collateral and receiving more debt. No interest is accrued during this
 * process.
 */
test('adjust-balances-no-interest', async t => {
  // Destructure bootstraped data
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  // Set loan timing
  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  // Setup services
  const { assertions, scenarioHelpers } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
  );

  t.plan(40);

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertAdjustBalancesSuccessful,
  } = assertions;

  const { addPool, depositMoney, borrow, adjust } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan },
  } = await borrow(10n ** 8n, 4n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
  };

  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  /** @type AdjustConfig */
  const collateralConfig = {
    type: ADJUST_PROPOSAL_TYPE.GIVE,
    value: 3n * 10n ** 8n / 2n,
  };

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.WANT,
    value: 7n * 10n ** 8n / 100n,
  };

  // Send the offer to adjust the loan
  const aliceUpdatedLoanSeat = await adjust(aliceLoan, collateralConfig, debtConfig);

  const expectedValuesAfterAdjust = {
    collateralPayoutAmount: undefined,
    debtPayoutAmount: debtConfig.amount,
    totalCollateralUnderlyingAfterUpdate: AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n + 10n ** 8n),
    totalDebtAfterUpdate: AmountMath.make(panBrand, 7n * 10n ** 6n + 4n * 10n ** 6n)
  }

  await Promise.all([
    assertAdjustBalancesSuccessful(vanPoolMan, panPoolMan, aliceLoan, aliceUpdatedLoanSeat, expectedValuesAfterAdjust),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

test('adjust-balances-no-interest-pay-debt', async t => {
  // Destructure bootstraped data
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  // Set loan timing
  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  // Setup services
  const { assertions, scenarioHelpers }
    = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay * 7n));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertAdjustBalancesSuccessful,
  } = assertions;

  const { addPool, depositMoney, borrow, adjust } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan }
  } = await borrow(10n ** 8n, 4n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
  }

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.GIVE,
    value: 3n * 10n ** 8n / 100n
  }

  // Send the offer to adjust the loan
  const aliceUpdatedLoanSeat = await adjust(aliceLoan, undefined, debtConfig);

  const expectedValuesAfterAliceAdjust = {
    collateralPayoutAmount: undefined,
    debtPayoutAmount: undefined,
    totalCollateralUnderlyingAfterUpdate: AmountMath.make(vanBrand, 10n ** 8n),
    totalDebtAfterUpdate: AmountMath.make(panBrand, 10n ** 6n)
  }

  // Check market state after adjust
  await Promise.all([
    assertAdjustBalancesSuccessful(vanPoolMan, panPoolMan, aliceLoan, aliceUpdatedLoanSeat, expectedValuesAfterAliceAdjust),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * This test is similar to the 'adjust-balances-no-interest' test with a few differences.
 * The main difference is that we now let the interest accrue in the pool.
 * According to the accrued interest we check borrowing rate, totalDebt and the
 * current debt of the loan.
 */
test('adjust-balances-interest-accrued', async t => {
  // Destructure bootstraped data
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  // Set loan timing
  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  // Setup services
  const { timer, assertions, scenarioHelpers } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay),
  );

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertInterestCharged,
    assertAdjustBalancesSuccessful,
  } = assertions;

  const { addPool, depositMoney, borrow, adjust } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan }
  } = await borrow(10n ** 8n, 4n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
  };

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Accrue interst by one chargingPeriod
  await timer.tick();
  await waitForPromisesToSettle();

  const expectedValuesAfterInterestCharged = {
    principalDebt: 4n * 10n ** 6n,
    accruedInterest: 280n,
    borrowingRate: 259n,
    exchangeRateNumerator: 2000001n,
  };

  // Check market state after interest
  await Promise.all([
    assertInterestCharged(panPoolMan, expectedValuesAfterInterestCharged),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.WANT,
    value: 7n * 10n ** 8n / 100n,
  };

  // Send the offer to adjust the loan
  const aliceUpdatedLoanSeat = await adjust(aliceLoan, undefined, debtConfig);

  const expectedValuesAfterAliceAdjust = {
    collateralPayoutAmount: undefined,
    debtPayoutAmount: debtConfig.amount,
    totalCollateralUnderlyingAfterUpdate: AmountMath.make(vanBrand, 10n ** 8n),
    totalDebtAfterUpdate: AmountMath.make(panBrand, 4n * 10n ** 6n + 7n * 10n ** 6n + 280n)
  }

  // Check market state after adjust
  await Promise.all([
    assertAdjustBalancesSuccessful(vanPoolMan, panPoolMan, aliceLoan, aliceUpdatedLoanSeat, expectedValuesAfterAliceAdjust),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Accrue one more chargingPeriod of interest
  await timer.tick();
  await waitForPromisesToSettle();

  const expectedValuesAfterSecondInterestCharged = {
    principalDebt: 4n * 10n ** 6n + 7n * 10n ** 6n + 280n,
    accruedInterest: 812n,
    borrowingRate: 273n,
    exchangeRateNumerator: 2000003n,
  }

  // Check market state after interest
  await Promise.all([
    assertInterestCharged(panPoolMan, expectedValuesAfterSecondInterestCharged),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * In this test we pay some of our debt and receive some collateral accordingly.
 * We don't let any interest accrue. Since some debt is paid we expect the
 * borrowing rate to go down.
 */
test('adjust-balances-pay-debt-get-collateral', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const {
    assertions,
    scenarioHelpers,
  } = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertAdjustBalancesSuccessful,
  } = assertions;

  const { addPool, depositMoney, borrow, adjust } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL,);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan },
  } = await borrow(10n ** 8n, 35n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
  };

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  /** @type AdjustConfig */
  const collateralConfig = {
    type: ADJUST_PROPOSAL_TYPE.WANT,
    value: 2n * 10n ** 7n,
  };

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.GIVE,
    value: 7n * 10n ** 6n,
  };

  const aliceUpdatedLoanSeat = await adjust(aliceLoan, collateralConfig, debtConfig);

  const expectedValuesAfterAliceAdjust = {
    collateralPayoutAmount: collateralConfig.amount,
    debtPayoutAmount: undefined,
    totalCollateralUnderlyingAfterUpdate: AmountMath.make(vanBrand, 8n* 10n ** 7n),
    totalDebtAfterUpdate: AmountMath.make(panBrand, 28n * 10n ** 6n)
  };

  // Check market state after adjust
  await Promise.all([
    assertAdjustBalancesSuccessful(vanPoolMan, panPoolMan, aliceLoan, aliceUpdatedLoanSeat, expectedValuesAfterAliceAdjust),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
})

/**
 * Here we test the scenario that we pay all the debt at once and close the loan.
 * Setup process is the same as the other tests above.
 */
test('close-loan', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const { assertions, scenarioHelpers } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay),
  );

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLoanClosedCorrectly,
  } = assertions;

  const { addPool, depositMoney, borrow, closeLoan } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan }
  } = await borrow(10n ** 8n, 4n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
  }

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const debtConfig = {
    value: 4n * 10n ** 6n,
  };

  const aliceCloseSeat = await closeLoan(aliceLoan, debtConfig);

  const expectedValuesAfterClose = {
    collateralUnderlyingAmount: AmountMath.make(vanBrand, 10n ** 8n),
    newTotalDebt: AmountMath.makeEmpty(panBrand),
  };

  // Check market state after close
  await Promise.all([
    assertLoanClosedCorrectly(vanPoolMan, panPoolMan, aliceCloseSeat, aliceLoan, expectedValuesAfterClose),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * This is the scenario we test a user first deposits some PAN then after a while
 * decides to redeem their money. To check if the exchange rate going up makes the
 * liquidity providers money we let other people borrow money from PAN pool and
 * accrue interest for 7 charging period.
 */
test('redeem-underlying', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n, // This means that on every timer.tick(), interest will accrue 7 times in a compounded way
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const {
    timer,
    assertions,
    /** @type LendingPoolScenarioHelpers */ scenarioHelpers,
  } = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay * 7n));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertInterestCharged,
    assertRedeemSuccessful,
  } = assertions;

  const { addPool, depositMoney, borrow, redeem } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const { poolManager: vanPoolMan } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await depositMoney(POOL_TYPES.COLLATERAL, 5n);
  await depositMoney(POOL_TYPES.DEBT, 10n);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const { loanKit: { loan: aliceLoan } } = await borrow(10n ** 8n, 4n * 10n ** 6n);

  const aliceLoanExpectedValues = {
    requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
  }

  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, aliceLoanExpectedValues),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // interest time
  await timer.tick();
  await waitForPromisesToSettle();

  const expectedValuesAfterInterest = {
    principalDebt: 4n * 10n ** 6n,
    accruedInterest: 1960n,
    borrowingRate: 259n,
    exchangeRateNumerator: 2000004n,
  }

  await Promise.all([
    assertInterestCharged(panPoolMan, expectedValuesAfterInterest),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const redeemUserSeat = await redeem(POOL_TYPES.DEBT, 5000n);

  const expectedValuesAfterRedeem = {
    underlyingLiquidity: AmountMath.make(panBrand, 895999800n),
    redeemAmount: AmountMath.make(panBrand, 100000200n),
    borrowingRate: makeRatio(259n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000004n,
  };

  await Promise.all([
    assertRedeemSuccessful(panPoolMan, redeemUserSeat, expectedValuesAfterRedeem),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

test('amm-play-around', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
    installation
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const { zoe, ammFacets: { ammPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    10n * 10n ** 6n,
    10n * 10n ** 6n,
    10n * 110n * 10n ** 8n,
    10n * 200n * 10n ** 8n
  );

  const debt = AmountMath.make(panBrand, 4n * 10n ** 6n);

  const penaltyRate = makeRatio(10n, panBrand, 100n);
  // const penalty = floorMultiplyBy(debt, penaltyRate);
  // const debtWithPenalty = AmountMath.add(penalty, debt);
  // const poolFeeRatioAmountOut = makeRatio(24n, panBrand, BASIS_POINTS);
  // const poolFee = floorMultiplyBy(debtWithPenalty, poolFeeRatioAmountOut);
  // console.log("zaaaaPoolFee", poolFee);
  // console.log("debtWithPenalty", debtWithPenalty);
  // console.log("debtWithPenaltyMinusPoolFee", AmountMath.subtract(debtWithPenalty, poolFee));
  // const debtInputPan = await E(ammPublicFacet).getInputPrice(
  //   debtWithPenalty,
  //   AmountMath.makeEmpty(vanBrand));
  //
  // const panInputDebt = await E(ammPublicFacet).getInputPrice(
  //   debtInputPan.amountOut,
  //   AmountMath.makeEmpty(panBrand));
  //
  //
  // console.log("debtInputPan", debtInputPan);
  // console.log("panInputDebt", panInputDebt);

  const { creatorFacet: liquidator } = await E(zoe).startInstance(
    installation.liquidate,
    undefined,
    {amm: ammPublicFacet}
  );

  const liquidateMinimumProp = harden({
    give: { In: AmountMath.make(vanBrand, 10n ** 8n) },
    want: { Out: debt }
  });

  const liquidateMinimumPayment = {
    In: vanMint.mintPayment(AmountMath.make(vanBrand, 10n ** 8n)),
  };

  const testSeat = await E(zoe).offer(
    E(liquidator).makeLiquidateInvitation(),
    liquidateMinimumProp,
    liquidateMinimumPayment,
    { debt, penaltyRate }
  );

  const colPayout = await E(testSeat).getPayout("In");
  const debtPayout = await E(testSeat).getPayout("Out");
  console.log("colPayout", await E(vanIssuer).getAmountOf(colPayout));
  console.log("debtPayout", await E(panIssuer).getAmountOf(debtPayout));
  t.is("assert", "assert");
});

/**
 * Liquidation might happen after several occasions. One of them is
 * the scenario where the price of the collateral goes down but and price
 * of the debt stays the same. We test this scenario here.
 *
 * Setup is similar to other tests
 *
 * Alice gets a loan very close to the liquidation margin and after
 * the price of the collateral goes down a little bit her loan gets
 * liquidated.
 */
test('collateral-price-drop-liquidate', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay,
  };

  const {
    assertions,
    scenarioHelpers,
  } = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLiquidation,
  } = assertions;

  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const {
    poolManager: vanPoolMan,
    priceAuthority: vanUsdPriceAuthority,
  } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan, publicNotifiers: { loanNotifier: aliceLoanNotifier } },
  } = await borrow(10n ** 8n, 35n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
  }

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Collateral price goes down, new max amount of debt is 66 USD worth PAN
  // This means that we're now underwater, so liquidation should be triggerred
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  await waitForPromisesToSettle();

  const expectedValuesAfterLiquidation = {
    debtAmount: AmountMath.make(panBrand, 35n * 10n ** 6n + 3021n),
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  // Check market state after liquidation
  await Promise.all([
    assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

test('close-the-first-loan-liquidate-second', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 2n,
    recordingPeriod: secondsPerDay * 2n,
    priceCheckPeriod: secondsPerDay,
  };

  const { assertions,
    scenarioHelpers,
  } = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLiquidation,
    assertActiveLoan,
    assertLoanClosedCorrectly,
  } = assertions;

  const { addPool, depositMoney, borrow, closeLoan } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const {
    poolManager: vanPoolMan,
    priceAuthority: vanUsdPriceAuthority,
  } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const { poolManager: panPoolMan } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: aliceLoan },
  } = await borrow(10n ** 8n, 20n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 20n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 20n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(290n, panBrand, BASIS_POINTS),
  };

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const debtConfig = {
    value: 20n * 10n ** 8n / 100n,
  };

  const aliceCloseSeat = await closeLoan(aliceLoan, debtConfig);

  const expectedValuesAfterClose = {
    collateralUnderlyingAmount: AmountMath.make(vanBrand, 10n ** 8n),
    newTotalDebt: AmountMath.makeEmpty(panBrand),
  };

  await Promise.all([
    assertLoanClosedCorrectly(vanPoolMan, panPoolMan, aliceCloseSeat, aliceLoan, expectedValuesAfterClose),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: bobLoan },
  } = await borrow(10n ** 8n, 35n * 10n ** 6n);

  const expectedValuesAfterBobLoan = {
    requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
  };

  // Check market state after borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, bobLoan, expectedValuesAfterBobLoan),
    assertActiveLoan(bobLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Collateral price goes down, new max amount of debt is 66 USD worth PAN
  // This means that we're now underwater, so liquidation should be triggerred
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  await waitForPromisesToSettle();

  const expectedValuesAfterLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  await Promise.all([
    assertLiquidation(panPoolMan, bobLoan, expectedValuesAfterLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * This test is almost identical to the one above but here the price of debt
 * goes up instead of the price of collateral going down. Alice's loan still
 * gets liquidated.
 */
test('debt-price-up-liquidate', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 2n,
    recordingPeriod: secondsPerDay * 2n,
    priceCheckPeriod: secondsPerDay,
  };

  const {
    assertions, scenarioHelpers,
  } = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLiquidation,
    assertActiveLoan,
  } = assertions;

  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const {
    poolManager: vanPoolMan,
  } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const {
    poolManager: panPoolMan,
    priceAuthority: panUsdPriceAuthority,
  } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const { loanKit: { loan: aliceLoan } } = await borrow(10n ** 8n, 35n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
  };

  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Value of the debt is now 77 USD, so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(220n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  await waitForPromisesToSettle();

  const expectedValuesAfterLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  await Promise.all([
    assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * The prices of debt and collateral can fluctuate both at the same time.
 * This scenario is tested here.
 */
test('debt-price-up-col-price-down-liquidate', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 10n, // We don't want any interest accrual, yet
    recordingPeriod: secondsPerDay * 10n,
    priceCheckPeriod: secondsPerDay,
  };

  const { assertions, scenarioHelpers } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay),
    {
      compareVanInitialLiquidityValue: 100n * 10n ** 6n * 100n,
      comparePanInitialLiquidityValue: 193n * 10n ** 6n * 100n,
      vanInitialLiquidityValue: 10n ** 8n * 100n,
      panInitialLiquidityValue: 10n ** 8n * 100n,
    },
  );
  await waitForPromisesToSettle();

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLiquidation,
    assertActiveLoan,
  } = assertions;

  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const {
    poolManager: vanPoolMan,
    priceAuthority: vanUsdPriceAuthority,
  } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const {
    poolManager: panPoolMan,
    priceAuthority: panUsdPriceAuthority,
  } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  const { loanKit: { loan: aliceLoan } } = await borrow(10n ** 8n, 35n * 10n ** 6n);

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
  };

  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Max debt quote for the below prices is 67 USD so don't liquidate
  panUsdPriceAuthority.setPrice(makeRatio(190n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(102n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  // Check market state after price change
  await Promise.all([
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Now make the max debt quote 66 USD and the value of the debt is 67 USD, so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  const expectedValuesAfterLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  await Promise.all([
    assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * We assume we'll have multiple loans, so we need to keep in track which loan
 * is underwater and which is not. Here we create three loans, one for Alice, Bon and
 * Maggie each. After the price changes we expect Maggie's loan to be active
 * and the other two to be liquidated.
 */
test('prices-fluctuate-multiple-loans-liquidate', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 10n, // We don't want any interest accrual, yet
    recordingPeriod: secondsPerDay * 10n,
    priceCheckPeriod: secondsPerDay,
  };

  const { assertions, scenarioHelpers } = await setupServices(
    t,
    buildManualTimer(console.log, 0n, secondsPerDay),
  );

  await waitForPromisesToSettle();

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLiquidation,
    assertActiveLoan,
  } = assertions;

  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const {
    poolManager: vanPoolMan,
    priceAuthority: vanUsdPriceAuthority,
  } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const {
    poolManager: panPoolMan,
    priceAuthority: panUsdPriceAuthority,
  } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([,
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Get a loan for Alice
  const {
    loanKit: { loan: aliceLoan },
  } = await borrow( // borrow is a helper method to get loans
    10n ** 8n, // Max debt is 73 USD
    35n * 10n ** 6n); // Debt value is 63 USD

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
  };

  // Check market state after Alice borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Get a loan for Maggie
  const {
    loanKit: { loan: maggieLoan },
  } = await borrow(
    10n ** 8n, // Max debt is 73 USD
    4n * 10n ** 6n); // Debt value is 7 USD

  const expectedValuesAfterMaggieLoan = {
    requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n + 4n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n - 35n * 10n ** 6n),
    borrowingRate: makeRatio(328n, panBrand, BASIS_POINTS),
  };

  // Check market state after Maggie borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, maggieLoan, expectedValuesAfterMaggieLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Get a loan for Bob
  const {
    loanKit: { loan: bobLoan },
  } = await borrow(
    5n* 10n ** 7n, // Max debt is 36 USD
    18n * 10n ** 6n); // Debt value is 32 USD

  const expectedValuesAfterBobLoan = {
    requestedDebt: AmountMath.make(panBrand, 18n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n + 4n * 10n ** 6n + 18n * 10n ** 6n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n - 35n * 10n ** 6n - 4n * 10n ** 6n),
    borrowingRate: makeRatio(364n, panBrand, BASIS_POINTS),
  };

  // Check market state after Bob borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, bobLoan, expectedValuesAfterBobLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  await Promise.all([
    assertActiveLoan(aliceLoan),
    assertActiveLoan(maggieLoan),
    assertActiveLoan(bobLoan),
  ]);

  // Loans are effected as below
  // Bob max debt is 35 USD, debt value is 34 USD so don't liquidate
  // Maggie max debt is 70 USD, debt value is 7 USD so don't liquidate
  // Alice max debt is 70 USD, debt value is 66 USD so don't liquidate
  panUsdPriceAuthority.setPrice(makeRatio(190n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(106n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  await Promise.all([
    assertActiveLoan(aliceLoan),
    assertActiveLoan(maggieLoan),
    assertActiveLoan(bobLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Loans are effected as below
  // Bob max debt is 33 USD, debt value is 34 USD so liquidate
  // Maggie max debt is 66 USD, debt value is 7 USD so don't liquidate
  // Alice max debt is 66 USD, debt value is 67 USD so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  const expectedValuesAfterAliceLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n - 35n * 10n ** 6n - 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    borrowRate: makeRatio(258n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  const expectedValuesAfterBobLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n - 35n * 10n ** 6n - 4n * 10n ** 6n),
    totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
    borrowRate: makeRatio(258n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  // Check market state after price change
  await Promise.all([
    assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterAliceLiquidation),
    assertActiveLoan(maggieLoan),
    assertLiquidation(panPoolMan, bobLoan, expectedValuesAfterBobLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});

/**
 * One other scenario for liquidation is that the prices hold still
 * but the loan reaches the liquidation margin by the accrual of interest
 *
 */
test('prices-hold-still-liquidates-with-interest-accrual', async t => {
  const {
    vanKit: { brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay, // We don't want any interest accrual, yet
    recordingPeriod: secondsPerDay * 10n,
    priceCheckPeriod: secondsPerDay * 10n,
  };

  const {
    timer, assertions,
    scenarioHelpers,
  } = await setupServices(t, buildManualTimer(console.log, 0n, secondsPerDay * 10n));

  const {
    assertEnoughLiquidityInPool,
    assertBorrowSuccessfulNoInterest,
    assertLiquidation,
    assertActiveLoan,
    assertInterestCharged,
  } = assertions;

  const { addPool, depositMoney, borrow } = scenarioHelpers;

  // Make prices
  const vanUsdPrice = makeRatio(108n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);
  const panUsdPrice = makeRatio(179n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand);

  // Add the pools
  const {
    poolManager: vanPoolMan,
    priceAuthority: vanUsdPriceAuthority,
  } = await addPool(vanRates, vanUsdPrice, 'VAN', POOL_TYPES.COLLATERAL);
  const {
    poolManager: panPoolMan,
  } = await addPool(panRates, panUsdPrice, 'PAN', POOL_TYPES.DEBT);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  await Promise.all([
    depositMoney(POOL_TYPES.COLLATERAL, 6n),
    depositMoney(POOL_TYPES.DEBT, 10n),
  ]);

  // Check market state after deposit
  await Promise.all([
    assertEnoughLiquidityInPool(panPoolMan, AmountMath.make(panBrand, 10n * 10n ** 8n)),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Get a loan for Alice
  const {
    loanKit: { loan: aliceLoan },
  } = await borrow(
    10n ** 8n, // Max debt is 72 USD worth of PAN
    4019n * 10n ** 4n); // Debt value is 71 USD

  const expectedValuesAfterAliceLoan = {
    requestedDebt: AmountMath.make(panBrand, 4019n * 10n ** 4n),
    totalDebt: AmountMath.make(panBrand, 4019n * 10n ** 4n),
    underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
    borrowingRate: makeRatio(331n, panBrand, BASIS_POINTS),
  };

  // Check market state after Alice borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // On one tick 10 periods of interest will accrue in a compounded manner
  await timer.tick()
  await waitForPromisesToSettle();

  const expectedValuesAfterInterest = {
    principalDebt: 4019n * 10n ** 4n,
    accruedInterest: 35877n,
    exchangeRateNumerator: 2000489n,
    borrowingRate: 331n,
  }

  // Check market state after interest charged
  await Promise.all([
    assertInterestCharged(panPoolMan, expectedValuesAfterInterest),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // A price update is necessary to initiate liquidation
  vanUsdPriceAuthority.setPrice(makeRatio(108n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  await waitForPromisesToSettle();

  const expectedValuesAfterLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000489n,
  };

  // Check market state after liquidation
  await Promise.all([
    assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});




