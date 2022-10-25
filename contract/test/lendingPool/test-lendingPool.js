// @ts-check
import { makeTracer } from '@agoric/inter-protocol/src/makeTracer.js';
import '@agoric/zoe/exported.js';
import '@agoric/zoe/tools/prepare-test-env.js';
import test from 'ava';
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
  makeRates,
  setupAssets,
  makeMarketStateChecker,
  getPoolMetadata,
  calculateUnderlyingFromProtocol,
  calculateProtocolFromUnderlying,
  splitCollateral,
} from './helpers.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import {
  setupServices,
  CONTRACT_ROOTS,
  getPath,
  startLendingPool,
  setupAmmAndElectorate,
} from './setup.js';
import { setUpZoeForTest } from '@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup.js';
import { objectMap } from '@agoric/internal';
import { SECONDS_PER_YEAR } from '../../src/interest.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { LoanPhase } from '../../src/lendingPool/loan.js';
import { oneMinus } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeLendingPoolAssertions } from './lendingPoolAssertions.js';
import { ADJUST_PROPOSAL_TYPE, makeLendingPoolScenarioHelpers, POOL_TYPES } from './lendingPoolScenrioHelpers.js';

const trace = makeTracer('TestST');

const BASIS_POINTS = 10000n;
const secondsPerDay = SECONDS_PER_YEAR / 365n;

/**
 * Runs before every test separetly and injects necessary data to its `context`
 * property.
 */
test.before(async t => {
  const farZoeKit = setUpZoeForTest();

  const bundleCache = await unsafeMakeBundleCache('./bundles/'); // package-relative
  // note that the liquidation might be a different bundle name
  const bundles = await Collect.allValues({
    faucet: bundleCache.load(await getPath(CONTRACT_ROOTS.faucet), 'faucet'),
    liquidate: bundleCache.load(await getPath(CONTRACT_ROOTS.liquidate), 'liquidateMinimum'),
    LendingPool: bundleCache.load(await getPath(CONTRACT_ROOTS.LendingPool), 'lendingPool'),
    amm: bundleCache.load(await getPath(CONTRACT_ROOTS.amm), 'amm'),
    reserve: bundleCache.load(await getPath(CONTRACT_ROOTS.reserve), 'reserve'),
  });
  const installations = objectMap(bundles, bundle => E(farZoeKit.zoe).install(bundle));

  const { vanKit, usdKit, panKit, agVanKit } = setupAssets();

  const contextPs = {
    farZoeKit,
    bundles,
    installations,
    electorateTerms: undefined,
    loanTiming: {
      chargingPeriod: 2n,
      recordingPeriod: 6n,
      priceCheckPeriod: 6n,
    },
    minInitialDebt: 50n,
    // All values are in units
    ammPoolsConfig: {
      compareVanInitialLiquidityValue: 100n,
      comparePanInitialLiquidityValue: 100n,
      vanInitialLiquidityValue: 90n * 100n,
      panInitialLiquidityValue: 100n * 100n,
    },
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = {
    ...frozenCtx,
    bundleCache,
    vanKit,
    compareCurrencyKit: usdKit,
    panKit,
    agVanKit,
    vanRates: makeRates(vanKit.brand, usdKit.brand),
    panRates: makeRates(panKit.brand, usdKit.brand),
  };
  // trace(t, 'CONTEXT');
});

/**
 * Here we basically test the setupServices method. This test does not have
 * any importance when it comes to work logic.
 */
test('initial', async t => {
  const services = await setupServices(t);
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

  t.plan(29);

  // Start services
  const { lendingPool: { lendingPoolPublicFacet }, assertions, scenarioHelpers } = await setupServices(t);

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
  const {
    timer,
    assertions,
    scenarioHelpers,
  } = await setupServices(t);

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
  await timer.advanceTo(secondsPerDay * 7n);
  await eventLoopIteration();

  const expectedValuesAfterInterest = {
    principalDebt: 6n * 10n ** 6n,
    accruedInterest: 3183n,
    exchangeRateNumerator: 2000016n,
    borrowingRate: 280n,
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
  const { assertions, scenarioHelpers } = await setupServices(t);

  t.plan(42);

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
  const { assertions, scenarioHelpers } = await setupServices(t);

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
  const { timer, assertions, scenarioHelpers } = await setupServices(t);

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
  await timer.advanceTo(secondsPerDay);
  await eventLoopIteration();

  const expectedValuesAfterInterestCharged = {
    principalDebt: 4n * 10n ** 6n,
    accruedInterest: 280n,
    borrowingRate: 258n,
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
  await timer.advanceTo(secondsPerDay * 2n);
  await eventLoopIteration();

  const expectedValuesAfterSecondInterestCharged = {
    principalDebt: 4n * 10n ** 6n + 7n * 10n ** 6n + 280n,
    accruedInterest: 809n,
    borrowingRate: 272n,
    exchangeRateNumerator: 2000002n,
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
  } = await setupServices(t);

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

  const { assertions, scenarioHelpers } = await setupServices(t);

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
    panKit: { brand: panBrand },
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
  } = await setupServices(t);

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
  await timer.advanceTo(t.context.loanTiming.recordingPeriod);
  await eventLoopIteration();

  const expectedValuesAfterInterest = {
    principalDebt: 4n * 10n ** 6n,
    accruedInterest: 1960n,
    borrowingRate: 258n,
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
  } = await setupServices(t);

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
    loanKit: { loan: aliceLoan },
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
  await eventLoopIteration();

  const expectedValuesAfterLiquidation = {
    debtAmount: AmountMath.make(panBrand, 35n * 10n ** 6n),
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

  const {
    assertions,
    scenarioHelpers,
  } = await setupServices(t);

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
  await eventLoopIteration();

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
  } = await setupServices(t);

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
  await eventLoopIteration();

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
    undefined,
    {
      compareVanInitialLiquidityValue: 100n * 10n ** 6n * 100n,
      comparePanInitialLiquidityValue: 193n * 10n ** 6n * 100n,
      vanInitialLiquidityValue: 10n ** 8n * 100n,
      panInitialLiquidityValue: 10n ** 8n * 100n,
    },
  );
  await eventLoopIteration();

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

  await eventLoopIteration();

  // Check market state after price change
  await Promise.all([
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // Now make the max debt quote 66 USD and the value of the debt is 67 USD, so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await eventLoopIteration();

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

  const { assertions, scenarioHelpers } = await setupServices(t);

  await eventLoopIteration();

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

  await eventLoopIteration();

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

  await eventLoopIteration();

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
  } = await setupServices(t);

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
    borrowingRate: makeRatio(330n, panBrand, BASIS_POINTS),
  };

  // Check market state after Alice borrow
  await Promise.all([
    assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, expectedValuesAfterAliceLoan),
    assertActiveLoan(aliceLoan),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // On one tick 10 periods of interest will accrue in a compounded manner
  await timer.advanceTo(t.context.loanTiming.recordingPeriod);
  await eventLoopIteration();

  const expectedValuesAfterInterest = {
    principalDebt: 4019n * 10n ** 4n,
    accruedInterest: 35768n,
    exchangeRateNumerator: 2000072n,
    borrowingRate: 330n,
  }

  // Check market state after interest charged
  await Promise.all([
    assertInterestCharged(panPoolMan, expectedValuesAfterInterest),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  // A price update is necessary to initiate liquidation
  vanUsdPriceAuthority.setPrice(makeRatio(108n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  await eventLoopIteration();

  const expectedValuesAfterLiquidation = {
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000072n,
  };

  // Check market state after liquidation
  await Promise.all([
    assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterLiquidation),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);
});
