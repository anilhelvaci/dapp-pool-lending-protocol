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
import { depositMoney, addPool, makeRates, setupAssets, borrow, makeMarketStateChecker } from './helpers.js';

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
 * Calculates the amount of protocol tokens corresponding to the given underlyingAmount
 *
 * @param {Amount<'nat'>} underlyingAmount
 * @param {Ratio} exchangeRate
 * @returns {Amount<'nat'>}
 */
function calculateProtocolFromUnderlying(underlyingAmount, exchangeRate) {
  return floorDivideBy(
    underlyingAmount,
    exchangeRate,
  );
}

/**
 * Calculates the amount of underlying asset corresponding to the given protocolAmount
 *
 * @param {Amount<'nat'>} protocolAmount
 * @param {Ratio} exchangeRate
 * @return {Amount<'nat'>}
 */
function calculateUnderlyingFromProtocol(protocolAmount, exchangeRate) {
  return floorMultiplyBy(
    protocolAmount,
    exchangeRate,
  );
}

/**
 * This function installs and instantiates lendingPool and amm contracts alongside
 * with all the necessary variables.
 *
 * For the tests here, we've determined 3 types of tokens to run our tests. Those
 * tokens; VAN, PAN and USD. Here we use all those digital assets to set our
 * environment up.
 */
async function setupServices(
  t,
  priceOrList,
  unitAmountIn,
  timer = buildManualTimer(t.log),
  quoteInterval,
  compareVanInitialLiquidityValue,
  comparePanInitialLiquidityValue,
  vanInitialLiquidityValue,
  panInitialLiquidityValue,
) {
  const {
    zoe,
    compareCurrencyKit: { issuer: compCurrencyIssuer, brand: compCurrencyBrand, mint: compCurrencyMint },
    vanKit: { brand: vanBrand, issuer: vanIssuer, mint: vanMint },
    panKit: { brand: panBrand, issuer: panIssuer, mint: panMint },
    loanTiming,
  } = t.context;
  t.context.timer = timer;

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

  const quoteMint = makeIssuerKit('quote', AssetKind.SET).mint;
  // Cheesy hack for easy use of manual price authority
  const pa = Array.isArray(priceOrList)
    ? makeScriptedPriceAuthority({
      actualBrandIn: vanBrand,
      actualBrandOut: compCurrencyBrand,
      priceList: priceOrList,
      timer,
      quoteMint,
      unitAmountIn,
      quoteInterval,
    })
    : makeManualPriceAuthority({
      actualBrandIn: vanBrand,
      actualBrandOut: compCurrencyBrand,
      initialPrice: priceOrList,
      timer,
      quoteMint,
    });
  produce.priceAuthority.resolve(pa);

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

  return {
    zoe,
    governor: g,
    lendingPool: l,
    ammFacets,
    timer,
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
  const {
    vanKit: { brand: vanBrand },
  } = t.context;

  const services = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
    2222n,
    22222n,
    2122n
  );
  console.log('services', services);
  t.is('is', 'is');
});

/**
 * Adds a new pool to the protocol. Asserts that the pool has the underlyingBrand
 * and PoolManager received is the object that we received from the 'addPool' method.
 */
test('add-pool', async t => {
  const {
    vanKit: { brand: vanBrand, issuer: vanIssuer },
    compareCurrencyKit: { brand: usdBrand, issuer: usdIssuer },
    vanRates,
  } = t.context;

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
    2222n,
    22222n,
    2122n
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);

  t.is(await E(lendingPoolPublicFacet).hasPool(vanBrand), true);
  t.deepEqual(await E(lendingPoolPublicFacet).getPool(vanBrand), vanPoolMan);
});

/**
 * Checks the deposit functionality. Numbers used here are arbitrary. We only care about
 * whether the deposit operation is successful or not.
 *
 * Asserts the underlying liquidity, the protocol liquidity and the offer result.
 */
test('deposit', async t => {
  const {
    vanKit: { brand: vanBrand, issuer: vanIssuer, mint: vanMint },
    compareCurrencyKit: { brand: usdBrand, issuer: usdIssuer },
    vanRates,
  } = t.context;

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
    2222n,
    22222n,
    2122n
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  // It's possible to get the brand from the issuer object we let the user
  // get the brand directly becasue it means one less await.
  const [protocolBrand, protocolIssuer, underlyingIssuer, { checkMarketStateInSync }] = await Promise.all([
    E(vanPoolMan).getProtocolBrand(),
    E(vanPoolMan).getProtocolIssuer(),
    E(vanPoolMan).getUnderlyingIssuer(),
    await makeMarketStateChecker(t, vanPoolMan),
  ])
  trace('Protocol Metadata', {
    protocolBrand,
    protocolIssuer
  });

  const underlyingAmountIn = AmountMath.make(vanBrand, 111111111n);
  // We used 'getProtocolAmountOut' here for offer safety but a slippage function
  // will be implemented on the client side so we might need to remove this method.
  const protocolAmountOut = await E(vanPoolMan).getProtocolAmountOut(underlyingAmountIn);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: vanMint.mintPayment(underlyingAmountIn),
  });

  const invitation = E(lendingPoolPublicFacet).makeDepositInvitation(vanBrand);
  const seat = await E(zoe).offer(
    invitation,
    proposal,
    paymentKeywordRecord,
  );

  const message = await E(seat).getOfferResult();

  const protocolTokenReceived = await E(seat).getPayouts();
  const protocolReceived = protocolTokenReceived.Protocol;
  t.truthy(
    AmountMath.isEqual(
      await E(protocolIssuer).getAmountOf(protocolReceived),
      AmountMath.make(protocolBrand, 5555555550n),
    ),
  );

  t.deepEqual(await E(vanPoolMan).getProtocolLiquidity(), AmountMath.make(protocolBrand, 5555555550n)); // We know that initial exchange rate is 0,02
  t.deepEqual(await E(vanPoolMan).getUnderlyingLiquidity(), AmountMath.make(vanBrand, 111111111n));
  t.deepEqual(vanIssuer, underlyingIssuer);
  t.is(message, 'Finished');
  await checkMarketStateInSync();
});
/**
 * Basically the same test as above. But this time we assert that the deposit
 * method throws an error if we use a wrong protocolAmountOut.
 */
test('deposit - false protocolAmountOut', async t => {
  const {
    vanKit: { brand: vanBrand, issuer: vanIssuer, mint: vanMint },
    compareCurrencyKit: { brand: usdBrand, issuer: usdIssuer },
    vanRates,
  } = t.context;

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
    2222n,
    22222n,
    2122n
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const [protocolBrand, protocolIssuer] = await Promise.all([
    E(vanPoolMan).getProtocolBrand(),
    E(vanPoolMan).getProtocolIssuer()
  ])
  trace('Protocol Metadata', {
    protocolBrand,
    protocolIssuer
  });
  const underlyingAmountIn = AmountMath.make(vanBrand, 111111111n);
  const protocolAmountOut = AmountMath.make(protocolBrand, 1111111111111111111111111111111n);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: vanMint.mintPayment(underlyingAmountIn),
  });

  const invitation = await E(vanPoolMan).makeDepositInvitation();
  const seat = E(zoe).offer(
    invitation,
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
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  // Set loan timing
  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 5n,
    priceCheckPeriod: secondsPerDay * 5n * 2n,
  };

  // Start services
  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 5n),
    secondsPerDay * 5n,
    500n,
    2222n,
    22222n,
    2122n
  );

  // We need price authorities to create a new pool
  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 103n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 5n,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [500n, 490n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 5n,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }, poolNotifier] = await Promise.all([
    makeMarketStateChecker(t, vanPoolMan),
    makeMarketStateChecker(t, panPoolMan),
    E(lendingPoolPublicFacet).getPoolNotifier(),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 1n);
  await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  const [{value: latestPoolState}] = await Promise.all([
    E(poolNotifier).getUpdateSince(),
    checkVanPoolStateInSync(),
    checkPanPoolStateInSync(),
  ]);

  trace('POOLS', latestPoolState);

  // Check if the pool has enough liquidty
  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Build offer
  const debtProposal = {
    give: { Collateral: vanPoolDepositedMoney.amount },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) },
  };

  const debtPaymentKeywordRecord = {
    Collateral: vanPoolDepositedMoney.payment,
  };

  const borrowInvitation = E(lendingPoolPublicFacet).makeBorrowInvitation();

  // Send offer
  const borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  // Get offer result
  const loanKit = await E(borrowerUserSeat).getOfferResult();
  const loan = loanKit.loan;

  let loanCurrentDebt = await E(loan).getCurrentDebt();
  trace('loanKit', loanKit);
  // Assert if the actual is debt is equal to the wanted debt or not
  t.deepEqual(loanCurrentDebt, debtProposal.want.Debt);
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

});

/**
 * In this test we want to see that the borrowing rate fluctuates correctly
 * according to the changes in the borrow amount.
 */
test('borrow-rate-fluctuate', async t => {
  // Destructure bootstraped data
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
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
  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    500n,
    2222n,
    22222n,
    2122n
  );

  // Create price authorities to add pools
  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 103n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [500n, 490n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 1n);
  await depositMoney(zoe, panPoolMan, panMint, 4n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Assert if there is enough liquidity or not
  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 4n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 4n * 10n ** 8n + 1n)));

  // Build first offer
  let debtProposal = {
    give: { Collateral: vanPoolDepositedMoney.amount },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) }, // Borrow 0,04 PAN
  };

  let debtPaymentKeywordRecord = {
    Collateral: vanPoolDepositedMoney.payment,
  };

  let borrowInvitation = E(lendingPoolPublicFacet).makeBorrowInvitation();

  // Send the first offer
  let borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  // Get result of the first offer
  const loanKit4B = await E(borrowerUserSeat).getOfferResult();
  const loan4B = loanKit4B.loan;

  const loanCurrentDebt4B = await E(loan4B).getCurrentDebt();

  // Check if the debt amount is correct
  t.deepEqual(loanCurrentDebt4B, AmountMath.make(panBrand, 4n * 10n ** 6n));
  // Check if the borrowing rate is correct. It should be 270 basis points
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(270n, panBrand, BASIS_POINTS));

  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Put some more money to use the received protocol tokens as collateral
  const collateral = await depositMoney(zoe, vanPoolMan, vanMint, 4n);

  // Check market state after second deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Build second offer
  debtProposal = {
    give: { Collateral: collateral.amount },
    want: { Debt: AmountMath.make(panBrand, 2n * 10n ** 6n) }, // Request 0,02 more PAN
  };

  debtPaymentKeywordRecord = {
    Collateral: collateral.payment,
  };

  borrowInvitation = E(lendingPoolPublicFacet).makeBorrowInvitation();

  // Send the second offer
  borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  // Get offer result
  const loanKit1B = await E(borrowerUserSeat).getOfferResult();
  const loan1B = loanKit1B.loan;

  const loanCurrentDebt1B = await E(loan1B).getCurrentDebt();

  // Check if the new loan's debt amount is correct or not
  t.deepEqual(loanCurrentDebt1B, AmountMath.make(panBrand, 2n * 10n ** 6n));
  // Borrow rate now should be 280 basis points as the total amount of borrows in the PAN pool increased
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(280n, panBrand, BASIS_POINTS));
  // Check market state after second borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
  // Accrue some interest
  await timer.tick();
  await waitForPromisesToSettle();

  const [panPoolTotalDebt, panPoolCurrentBorrowingRate, panPoolExchangeRate] = await Promise.all([
      E(panPoolMan).getTotalDebt(),
      E(panPoolMan).getCurrentBorrowingRate(),
      E(panPoolMan).getExchangeRate(),
    ],
  );

  // Total amount of interest should be 3183, so we check the total debt against principal borrow + interest accrued
  t.deepEqual(panPoolTotalDebt , AmountMath.make(panBrand, 6000000n + 3183n));
  // Since the amount of totalDebt is increased, our new borrowing rate should be 281 basis points
  t.deepEqual(panPoolCurrentBorrowingRate , makeRatio(281n, panBrand, BASIS_POINTS));
  // Since some interest accrued the exchange rate should increase as well
  t.deepEqual(panPoolExchangeRate.numerator, AmountMath.make(panBrand, 2000016n));
  // Check market state after interest
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
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
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
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
  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    500n,
    2222n,
    22222n,
    2122n
  );

  // Create priceAuthorities
  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n, 200n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
    E(vanPoolMan).getProtocolIssuer(),
    E(vanPoolMan).getProtocolBrand(),
    E(panPoolMan).getProtocolIssuer(),
    E(panPoolMan).getProtocolBrand()
  ])

  // Check the amount of protocol tokens received. We know that initial exchange rate is 0,02
  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  // Check enough liquidity exists
  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the AgVAN protocol token received to be used as collateral
  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 4000000n) },
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;

  const aliceLoanCurrentDebt = await E(aliceLoan).getCurrentDebt();

  // Check if the amount borrowed is correct
  t.deepEqual(aliceLoanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  // Check if the borrowing rate is correct
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Slice the received protocol tokens a litle bit more to put some more collateral and borrow some more money
  const [aliceCollateralUpdatePayment, vanDepositedMoneyMinusAliceLoanUpdate] =
    await E(agVanIssuer).split(vanPoolDepositedMoney,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n), await E(vanPoolMan).getExchangeRate())); // put 1,5 unit more VAN as collateral
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoanUpdate;

  // Build the proposal to adjust the loan by adding some more collateral and borrowing some more money
  const aliceAdjustBalanceProposal = harden({
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralUpdatePayment) },
    want: { Debt: AmountMath.make(panBrand, 7n * 10n ** 8n / 100n) }, // we want to borrow 0,07 PAN more
  });

  const aliceAdjustBalancePayment = harden(
    {
      Collateral: aliceCollateralUpdatePayment,
    },
  );

  // Send the offer to adjust the loan
  const aliceUpdatedLoanSeat = await E(zoe).offer(
    E(aliceLoan).makeAdjustBalancesInvitation(),
    aliceAdjustBalanceProposal,
    aliceAdjustBalancePayment,
    { collateralUnderlyingBrand: vanBrand },
  );
  await waitForPromisesToSettle(); // We need to wait for all promises to settle
  const [
    aliceDebtReceivedPayment,
    aliceAdjustOfferResult,
    aliceLoanCurrentDebtAfterUpdate,
    aliceLoanCollateralAfterUpdate] = await Promise.all([
    E(aliceUpdatedLoanSeat).getPayouts(),
    E(aliceUpdatedLoanSeat).getOfferResult(),
    E(aliceLoan).getCurrentDebt(),
    E(aliceLoan).getCollateralAmount(),
  ]);

  // Check offer result
  t.deepEqual(aliceAdjustOfferResult, 'We have adjusted your balances, thank you for your business');
  // Check if we got the expected amount after the adjust offer
  t.deepEqual(await E(panIssuer).getAmountOf(aliceDebtReceivedPayment.Debt), AmountMath.make(panBrand, 7n * 10n ** 8n / 100n));
  // Check if the total debt of Alice is the sum of both borrow and adjust offers
  t.deepEqual(aliceLoanCurrentDebtAfterUpdate, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n)));
  // Check if the amount of collateral is as expected
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n + 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  // Check market state after adjust
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
});

test('adjust-balances-no-interest-pay-debt', async t => {
  // Destructure bootstraped data
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
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
  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    500n,
    2222n,
    22222n,
    2122n
  );

  // Create priceAuthorities
  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n, 200n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
    E(vanPoolMan).getProtocolIssuer(),
    E(vanPoolMan).getProtocolBrand(),
    E(panPoolMan).getProtocolIssuer(),
    E(panPoolMan).getProtocolBrand()
  ])

  // Check the amount of protocol tokens received. We know that initial exchange rate is 0,02
  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  // Check enough liquidity exists
  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the AgVAN protocol token received to be used as collateral
  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 4000000n) },
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;

  const aliceLoanCurrentDebt = await E(aliceLoan).getCurrentDebt();

  // Check if the amount borrowed is correct
  t.deepEqual(aliceLoanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  // Check if the borrowing rate is correct
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Slice the received protocol tokens a litle bit more to put some more collateral and borrow some more money
  const [aliceCollateralUpdatePayment, vanDepositedMoneyMinusAliceLoanUpdate] =
    await E(agVanIssuer).split(vanPoolDepositedMoney,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n), await E(vanPoolMan).getExchangeRate())); // put 1,5 unit more VAN as collateral
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoanUpdate;

  // Build the proposal to adjust the loan by adding some more collateral and borrowing some more money
  const aliceAdjustBalanceProposal = harden({
    give: { Debt: AmountMath.make(panBrand, 3n * 10n ** 8n / 100n) },
  });

  const aliceAdjustBalancePayment = harden(
    {
      Debt: panMint.mintPayment(AmountMath.make(panBrand, 3n * 10n ** 8n / 100n)),
    },
  );

  // Send the offer to adjust the loan
  const aliceUpdatedLoanSeat = await E(zoe).offer(
    E(aliceLoan).makeAdjustBalancesInvitation(),
    aliceAdjustBalanceProposal,
    aliceAdjustBalancePayment,
    { collateralUnderlyingBrand: vanBrand },
  );
  await waitForPromisesToSettle(); // We need to wait for all promises to settle
  const [
    aliceAdjustOfferResult,
    aliceLoanCurrentDebtAfterUpdate,
    aliceLoanCollateralAfterUpdate] = await Promise.all([
    E(aliceUpdatedLoanSeat).getOfferResult(),
    E(aliceLoan).getCurrentDebt(),
    E(aliceLoan).getCollateralAmount(),
  ]);

  // Check offer result
  t.deepEqual(aliceAdjustOfferResult, 'We have adjusted your balances, thank you for your business');
  // Check if the total debt of Alice is the decreased by 0,3 PAN
  t.deepEqual(aliceLoanCurrentDebtAfterUpdate, AmountMath.make(panBrand,  10n ** 8n / 100n));
  // Check if the amount of collateral is the same as beafore
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand,  1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  // Check market state after adjust
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
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
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
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
  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    500n,
    2222n,
    22222n,
    2122n
  );

  // Create price authorities
  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n, 200n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanBrand] = await Promise.all([
    E(vanPoolMan).getProtocolIssuer(),
    E(vanPoolMan).getProtocolBrand(),
    E(panPoolMan).getProtocolBrand()
  ])

  // Check the amount of protocol tokens received. We know that initial exchange rate is 0,02
  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the total received protocol token by 1 VAN worth AgVAN and 4 VAN worth AgVAN,
  // then use 1 VAN worth AgVAN as collateral
  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 4000000n) }, // Borrow 0,04 PAN initially
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;

  const aliceLoanCurrentDebt = await E(aliceLoan).getCurrentDebt();

  t.deepEqual(aliceLoanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Accrue interst by one chargingPeriod
  await timer.tick();
  await waitForPromisesToSettle();
  // The accrued interest should be 280 / 10 ** 8n PAN
  t.deepEqual(await E(aliceLoan).getCurrentDebt(), AmountMath.make(panBrand, 4000000n + 280n));
  // Check market state after interest
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // This time we slice the remaining protocol tokens in way that we receive an empty
  // payment object as collateral. Because we created our initial loan with debt/collateral
  // that is way higher than the liquidation margin we don't need to add more collateral
  // to borrow 0,07 more PAN
  const [aliceCollateralUpdatePayment, vanDepositedMoneyMinusAliceLoanUpdate] =
    await E(agVanIssuer).split(vanPoolDepositedMoney,
      calculateProtocolFromUnderlying(AmountMath.makeEmpty(vanBrand), await E(vanPoolMan).getExchangeRate())); // put 1,5 unit more VAN as collateral
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoanUpdate;

  const aliceAdjustBalanceProposal = harden({
    give: { Collateral: AmountMath.makeEmpty(agVanBrand) },
    want: { Debt: AmountMath.make(panBrand, 7n * 10n ** 8n / 100n) }, // we want to borrow 0,07 PAN more
  });

  const aliceAdjustBalancePayment = harden(
    {
      Collateral: aliceCollateralUpdatePayment,
    },
  );

  const aliceUpdatedLoanSeat = await E(zoe).offer(
    E(aliceLoan).makeAdjustBalancesInvitation(),
    aliceAdjustBalanceProposal,
    aliceAdjustBalancePayment,
    { collateralUnderlyingBrand: vanBrand },
  );

  await waitForPromisesToSettle();

  const [
    aliceUpdateOfferResult,
    aliceDebtReceivedPayment,
    aliceLoanCurrentDebtAfterUpdate,
    aliceLoanCollateralAfterUpdate] = await Promise.all([
    E(aliceUpdatedLoanSeat).getOfferResult(),
    E(aliceUpdatedLoanSeat).getPayouts(),
    E(aliceLoan).getCurrentDebt(),
    E(aliceLoan).getCollateralAmount(),
  ]);

  // Check if the offer result is successful
  t.is(aliceUpdateOfferResult, 'We have adjusted your balances, thank you for your business');
  t.deepEqual(await E(panIssuer).getAmountOf(aliceDebtReceivedPayment.Debt), AmountMath.make(panBrand, 7n * 10n ** 8n / 100n));
  // New debt of the Alice's loan should be initial borrow amount + adjusted borrow amount + accrued interest
  t.deepEqual(aliceLoanCurrentDebtAfterUpdate, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n) + 280n));
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  // Check market state after adjust
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
  // Accrue one more chargingPeriod of interest
  await timer.tick();
  await waitForPromisesToSettle();

  const aliceLoanCurrentDebtAfterSecondInterestAccrual = await E(aliceLoan).getCurrentDebt();
  // Borrowing rate should increase due to the increased amount of debt and accrued interest
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(273n, panBrand, BASIS_POINTS));
  // Interest accrued after the second chargingPeriod should be 812 / 10 ** 8 PAN
  t.deepEqual(aliceLoanCurrentDebtAfterSecondInterestAccrual, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n) + 280n + 812n));
  // Check market state after interest
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
});

/**
 * In this test we pay some of our debt and receive some collateral accordingly.
 * We don't let any interest accrue. Since some debt is paid we expect the
 * borrowing rate to go down.
 */
test("adjust-balances-pay-debt-get-collateral", async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    500n,
    2222n,
    22222n,
    2122n
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n, 200n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(agVanIssuer).getBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(agPanIssuer).getBrand();

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 35n * 10n ** 6n) },
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;

  const aliceLoanCurrentDebt = await E(aliceLoan).getCurrentDebt();

  t.deepEqual(aliceLoanCurrentDebt, aliceDebtProposal.want.Debt);
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(320n, panBrand, BASIS_POINTS));
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const amountToPay = AmountMath.make(panBrand, 7n * 10n ** 6n);

  const aliceAdjustBalanceProposal = harden({
    give: { Debt: amountToPay },
    // we want 0,2 VAN worth AgVAN
    want: { Collateral: AmountMath.make(agVanBrand, 2n * 10n ** 7n * 50n) },
  });

  const aliceAdjustBalancePayment = harden(
    {
      Debt: panMint.mintPayment(amountToPay), // Mint amount to be paid
    },
  );

  const aliceUpdatedLoanSeat = await E(zoe).offer(
    E(aliceLoan).makeAdjustBalancesInvitation(),
    aliceAdjustBalanceProposal,
    aliceAdjustBalancePayment,
    { collateralUnderlyingBrand: vanBrand },
  );

  await waitForPromisesToSettle();

  const [
    aliceUpdateOfferResult,
    aliceDebtReceivedPayment,
    aliceLoanCurrentDebtAfterUpdate,
    aliceLoanCollateralAfterUpdate] = await Promise.all([
    E(aliceUpdatedLoanSeat).getOfferResult(),
    E(aliceUpdatedLoanSeat).getPayout('Collateral'),
    E(aliceLoan).getCurrentDebt(),
    E(aliceLoan).getCollateralAmount(),
  ]);

  t.is(aliceUpdateOfferResult, 'We have adjusted your balances, thank you for your business');
  t.deepEqual(await E(agVanIssuer).getAmountOf(aliceDebtReceivedPayment), aliceAdjustBalanceProposal.want.Collateral);
  t.deepEqual(aliceLoanCurrentDebtAfterUpdate, AmountMath.make(panBrand, 28n * 10n ** 8n / 100n));
  // After we receive 0,2 VAN worth AgVAN there should be 0,8 VAN worth AgVAN left in the loan as collateral
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 8n * 10n ** 8n / 10n), await E(vanPoolMan).getExchangeRate()));
  // Borrowing should go down. In this scenario it's 306 basis points
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(306n, panBrand, BASIS_POINTS));
  // Check market state after adjust
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
})

/**
 * Here we test the scenario that we pay all the debt at once and close the loan.
 * Setup process is the same as the other tests above.
 */
test('close-loan', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    500n,
    2222n,
    22222n,
    2122n
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n, 200n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(agVanIssuer).getBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(agPanIssuer).getBrand();

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) }, // Borrow 0,04 PAN
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;

  const aliceLoanCurrentDebt = await E(aliceLoan).getCurrentDebt();

  t.deepEqual(aliceLoanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const aliceCloseProposal = {
    give: { Debt: AmountMath.make(panBrand, 4n * 10n ** 8n / 100n) }, // Pay the whole debt
    want: { Collateral: AmountMath.makeEmpty(agVanBrand) },
  };

  const aliceClosePayment = {
    // Mint the payment
    Debt: panMint.mintPayment(AmountMath.make(panBrand, 4n * 10n ** 8n / 100n)),
  };

  const aliceCloseSeat = await E(zoe).offer(
    E(aliceLoan).makeCloseInvitation(),
    aliceCloseProposal,
    aliceClosePayment,
  );

  await waitForPromisesToSettle();

  const [
    aliceCloseOfferResult,
    aliceClosePayout,
    state,
    poolTotalDebt,
  ] = await Promise.all([
    E(aliceCloseSeat).getOfferResult(),
    E(aliceCloseSeat).getPayout('Collateral'),
    E(E(aliceLoan).getNotifier()).getUpdateSince(),
    E(panPoolMan).getTotalDebt()
  ]);

  t.is(aliceCloseOfferResult, 'your loan is closed, thank you for your business');
  t.is(state.value.loanState, LoanPhase.CLOSED);
  t.deepEqual(aliceClosePayout, aliceCollateralPayment);
  t.deepEqual(poolTotalDebt, AmountMath.makeEmpty(panBrand));
  // Check market state after close
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
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
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n, // This means that on every timer.tick(), interest will accrue 7 times in a compounded way
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    500n,
    2222n,
    22222n,
    2122n
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 103n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [500n, 490n, 470n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 5n);
  let panPoolDepositMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check liquidity
  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the reveived protocol tokens to get 1 VAN worth AgVAN to use as collateral
  const [collateralPayment, vanDepositedMoneyMinusLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusLoan;

  // Prepare proposal to borrow 0,04 PAN
  let debtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(collateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) },
  };

  let debtPaymentKeywordRecord = {
    Collateral: collateralPayment,
  };

  let borrowInvitation = E(lendingPoolPublicFacet).makeBorrowInvitation();

  let borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const loanKit = await E(borrowerUserSeat).getOfferResult();
  const loan = loanKit.loan;

  const [loanCurrentDebt, borrowingRateBeforeInterest, initialExchangeRate] = await Promise.all([
    E(loan).getCurrentDebt(),
    E(panPoolMan).getCurrentBorrowingRate(),
    E(panPoolMan).getExchangeRate()
  ])

  t.deepEqual(loanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 6n));
  // Borrowing rate should be 258 basis points
  t.deepEqual(borrowingRateBeforeInterest, makeRatio(258n, panBrand, BASIS_POINTS));
  t.deepEqual(initialExchangeRate.numerator, AmountMath.make(panBrand, 2000000n));
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // interest time
  await timer.tick();
  await waitForPromisesToSettle();

  const [debtAfterInterest, currentBorrowingRate, currentExchangeRate] = await Promise.all([
    E(loan).getCurrentDebt(),
    E(panPoolMan).getCurrentBorrowingRate(),
    E(panPoolMan).getExchangeRate()
  ])

  t.deepEqual(debtAfterInterest, AmountMath.make(panBrand, 4n * 10n ** 6n + 1960n));
  t.deepEqual(currentBorrowingRate , makeRatio(259n, panBrand, BASIS_POINTS));
  t.deepEqual(currentExchangeRate.numerator, AmountMath.make(panBrand, 2000004n));
  // Check market state after interest
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const askedUnderlyingAmount = AmountMath.make(panBrand, 10n ** 8n); // We want to redeem 1 unit of PAN
  const correspondingProtocolAmount = floorDivideBy(askedUnderlyingAmount, initialExchangeRate);
  const slippageRatio = makeRatio(2n, panBrand);
  const underlyingMinusSlippage = floorMultiplyBy(askedUnderlyingAmount, oneMinus(slippageRatio));

  // Slice the protocol tokens received after supplying liquidity to PAN pool
  const [redeemPayment, panDepositedMoneyMinusRedeem] =
    await E(agPanIssuer).split(panPoolDepositMoney.payment,
      correspondingProtocolAmount);

  const redeemPaymentAmount = await E(agPanIssuer).getAmountOf(redeemPayment);

  const redeemProposal = {
    give: { Protocol: redeemPaymentAmount},
    want: { Underlying: underlyingMinusSlippage }
  };
  trace('redeemProposal', redeemProposal);
  trace('redeemPayment', redeemPaymentAmount);
  const redeemPaymentRecord = {
    Protocol: redeemPayment
  };

  const redeemUserSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeRedeemInvitation(panBrand),
    redeemProposal,
    redeemPaymentRecord
  );

  await waitForPromisesToSettle();

  const [
    redeemPayout,
    protocolPayout,
    redeemOfferResult,
    redeemCurrentAllocation,
  ] = await Promise.all([
    E(redeemUserSeat).getPayout("Underlying"),
    E(redeemUserSeat).getPayout("Protocol"),
    E(redeemUserSeat).getOfferResult(),
    E(redeemUserSeat).getCurrentAllocation(),
  ])

  trace('redeemData', {
    redeemOfferResult,
    redeemCurrentAllocation
  });

  const [
    redeemAmount,
    protocolAmount,
    borrowingRate,
    exchangeRate
  ] = await Promise.all([
    E(panIssuer).getAmountOf(redeemPayout),
    E(agPanIssuer).getAmountOf(protocolPayout),
    E(panPoolMan).getCurrentBorrowingRate(),
    E(panPoolMan).getExchangeRate()
  ]);

  t.deepEqual(redeemAmount , AmountMath.make(panBrand, 100000200n));
  t.deepEqual(borrowingRate , makeRatio(259n, panBrand, BASIS_POINTS));
  t.deepEqual(exchangeRate.numerator, AmountMath.make(panBrand, 2000004n));
  t.deepEqual(protocolAmount, AmountMath.makeEmpty(agPanBrand));
  // Check market state after redeem
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
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
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 2n,
    recordingPeriod: secondsPerDay * 2n,
    priceCheckPeriod: secondsPerDay,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    1n * 100n * 10n ** 6n ,
    1n * 100n * 10n ** 6n,
    90n * 10n ** 8n * 100n,
    100n * 10n ** 8n * 100n
  );

  const vanUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand),
    timer
  });

  const panUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand),
    timer,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the initially received protocol tokens in a way that we use 1 VAN worth AgVAN
  // as collateral. Max amount of debt can be borrowed is 73 USD with 150% liquidation margin
  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 35n * 10n ** 6n) }, // Borrow 0,35 PAN,
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Send the offer to borrow 70 USD worth PAN
  // With current prices max amount of debt can be borrowed is 73 USD worth PAN,
  // so we're good for now.
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.publicNotifiers.loanNotifier;

  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // panUsdPriceAuthority.setPrice(makeRatio(200n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // Collateral price goes down, new max amount of debt is 66 USD worth PAN
  // This means that we're now underwater, so liquidation should be triggerred
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  // await timer.tick();
  await waitForPromisesToSettle();

  // Get the latest state
  const notification = await E(aliceLoanNotifier).getUpdateSince();
  // Check if the loan is liquidated
  t.is(notification.value.loanState, LoanPhase.LIQUIDATED);

  const debtWithPenalty = floorMultiplyBy(aliceDebtProposal.want.Debt, panRates.penaltyRate);
  const panPoolInitialLiquidity = AmountMath.make(panBrand, 10n * 10n ** 8n);
  const panPoolCurrentLiquidity = await E(panPoolMan).getUnderlyingLiquidity();
  // PAN Pool underyling liquidity should be greater than the initail liquidity
  // because we've sold the collateral + penalty rate in the AMM.
  // We've went for an assertion like this because it's hard for us to know the
  // exact price we'll receive form the AMM but we know that current liquidty of
  // the PAN Pool should be greater than the one before liquidation and smaller
  // than than exact debtWithPenalty + panPoolInitialLiquidity
  t.truthy(AmountMath.isGTE(panPoolCurrentLiquidity, panPoolInitialLiquidity)
    && AmountMath.isGTE(
      AmountMath.add(debtWithPenalty, panPoolInitialLiquidity),
      panPoolCurrentLiquidity));
  // Check market state after liquidation
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
});

test('close-the-first-loan-liquidate-second', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;
  console.log('panRates', panRates)

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 2n,
    recordingPeriod: secondsPerDay * 2n,
    priceCheckPeriod: secondsPerDay,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    1n * 100n * 10n ** 6n ,
    1n * 100n * 10n ** 6n,
    90n * 10n ** 8n * 100n,
    100n * 10n ** 8n * 100n
  );

  const vanUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand),
    timer
  });

  const panUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand),
    timer,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  const {
    loanKit: { loan: aliceLoan, publicNotifiers: { loanNotifier: aliceLoanNotifier } },
    moneyLeftInPool: vanPoolMoneyLeftAfterAliceLoan,
  } = await borrow(zoe, lendingPoolPublicFacet, vanPoolDepositedMoney.payment, vanPoolMan, 10n ** 8n, panBrand, 35n * 10n ** 6n);
  console.log('vanPoolMoneyLeftAfterAliceLoan', vanPoolMoneyLeftAfterAliceLoan)
  const { value: aliceLoanNotificationAfterBorrow } = await E(aliceLoanNotifier).getUpdateSince();
  t.deepEqual(aliceLoanNotificationAfterBorrow.loanState, LoanPhase.ACTIVE);

  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Close the loan
  const aliceCloseProposal = {
    give: { Debt: AmountMath.make(panBrand, 35n * 10n ** 8n / 100n) }, // Pay the whole debt
    want: { Collateral: AmountMath.makeEmpty(agVanBrand) },
  };

  const aliceClosePayment = {
    // Mint the payment
    Debt: panMint.mintPayment(AmountMath.make(panBrand, 35n * 10n ** 8n / 100n)),
  };

  const aliceCloseSeat = await E(zoe).offer(
    E(aliceLoan).makeCloseInvitation(),
    aliceCloseProposal,
    aliceClosePayment,
  );

  await waitForPromisesToSettle();

  const [
    aliceCloseOfferResult,
    aliceClosePayout,
    { value: { loanState } },
    poolTotalDebt,
  ] = await Promise.all([
    E(aliceCloseSeat).getOfferResult(),
    E(aliceCloseSeat).getPayout('Collateral'),
    E(aliceLoanNotifier).getUpdateSince(),
    E(panPoolMan).getTotalDebt()
  ]);

  t.is(aliceCloseOfferResult, 'your loan is closed, thank you for your business');
  t.is(loanState, LoanPhase.CLOSED);
  t.deepEqual(poolTotalDebt, AmountMath.makeEmpty(panBrand));
  // Check market state after close
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const {
    loanKit: { loan: bobLoan, publicNotifiers: { loanNotifier: bobLoanNotifier } },
    moneyLeftInPool: vanPoolMoneyLeftAfterBobLoan,
  } = await borrow(zoe, lendingPoolPublicFacet, vanPoolMoneyLeftAfterAliceLoan, vanPoolMan, 10n ** 8n, panBrand, 36n * 10n ** 6n);

  const { value: bobLoanNotificationAfterBorrow } = await E(bobLoanNotifier).getUpdateSince();
  t.deepEqual(bobLoanNotificationAfterBorrow.loanState, LoanPhase.ACTIVE);

  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // // panUsdPriceAuthority.setPrice(makeRatio(200n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  // Collateral price goes down, new max amount of debt is 66 USD worth PAN
  // This means that we're now underwater, so liquidation should be triggerred
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  // Get the latest state
  const notification = await E(bobLoanNotifier).getUpdateSince();
  // Check if the loan is liquidated
  t.is(notification.value.loanState, LoanPhase.LIQUIDATED);

  const debtWithPenalty = floorMultiplyBy(AmountMath.make(panBrand, 35n * 10n ** 6n), panRates.penaltyRate);
  const panPoolInitialLiquidity = AmountMath.make(panBrand, 10n * 10n ** 8n);
  const panPoolCurrentLiquidity = await E(panPoolMan).getUnderlyingLiquidity();
  // PAN Pool underyling liquidity should be greater than the initail liquidity
  // because we've sold the collateral + penalty rate in the AMM.
  // We've went for an assertion like this because it's hard for us to know the
  // exact price we'll receive form the AMM but we know that current liquidty of
  // the PAN Pool should be greater than the one before liquidation and smaller
  // than than exact debtWithPenalty + panPoolInitialLiquidity
  t.truthy(AmountMath.isGTE(panPoolCurrentLiquidity, panPoolInitialLiquidity)
    && AmountMath.isGTE(
      AmountMath.add(debtWithPenalty, panPoolInitialLiquidity),
      panPoolCurrentLiquidity));
  // Check market state after liquidation
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
});

/**
 * This test is almost identical to the one above but here the price of debt
 * goes up instead of the price of collateral going down. Alice's loan still
 * gets liquidated.
 */
test('debt-price-up-liquidate', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 2n,
    recordingPeriod: secondsPerDay * 2n,
    priceCheckPeriod: secondsPerDay,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    1n * 100n * 10n ** 6n ,
    1n * 100n * 10n ** 6n,
    90n * 10n ** 8n * 100n,
    100n * 10n ** 8n * 100n
  );

  // We use manualPriceAuthority to manipulate the prices in a more controlled way
  const vanUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand),
    timer
  });

  const panUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand),
    timer,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the initially received protocol tokens in a way that we use 1 VAN worth AgVAN
  // as collateral. Max amount of debt can be borrowed is 73 USD with 150% liquidation margin
  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 35n * 10n ** 6n) },
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.publicNotifiers.loanNotifier;

  const notificationBefore = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationBefore.value.loanState, LoanPhase.ACTIVE);
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Value of the debt is now 77 USD, so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(220n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));

  // await timer.tick();
  await waitForPromisesToSettle();

  const notificationAfter = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationAfter.value.loanState, LoanPhase.LIQUIDATED);

  const debtWithPenalty = floorMultiplyBy(aliceDebtProposal.want.Debt, panRates.penaltyRate);
  const panPoolInitialLiquidity = AmountMath.make(panBrand, 10n * 10n ** 8n);
  const panPoolCurrentLiquidity = await E(panPoolMan).getUnderlyingLiquidity();
  const currentLoanDebt = await E(aliceLoan).getCurrentDebt();
  t.truthy(AmountMath.isGTE(panPoolCurrentLiquidity, panPoolInitialLiquidity)
    && AmountMath.isGTE(
      AmountMath.add(debtWithPenalty, panPoolInitialLiquidity),
      panPoolCurrentLiquidity));
  t.deepEqual(currentLoanDebt, AmountMath.makeEmpty(panBrand));
  // Check market state after liquidation
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);
});

/**
 * The prices of debt and collateral can fluctuate both at the same time.
 * This scenario is tested here.
 */
test('debt-price-up-col-price-down-liquidate', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 10n, // We don't want any interest accrual, yet
    recordingPeriod: secondsPerDay * 10n,
    priceCheckPeriod: secondsPerDay,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    100n * 10n ** 6n * 100n,
    193n * 10n ** 6n * 100n,
     10n ** 8n * 100n,
    10n ** 8n * 100n
  );

  await waitForPromisesToSettle();

  // We use manualPriceAuthority to manipulate the prices in a more controlled way
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

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Slice the initially received protocol tokens in a way that we use 1 VAN worth AgVAN
  // as collateral. Max amount of debt can be borrowed is 73 USD with 150% liquidation margin
  const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;

  // build the proppsal
  const aliceDebtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 35n * 10n ** 6n) }, // Debt value 63 USD
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment,
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceLoanKit = await E(aliceSeat).getOfferResult();
  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.publicNotifiers.loanNotifier;

  const notificationBefore = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationBefore.value.loanState, LoanPhase.ACTIVE);
  // Check market state after borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Max debt quote for the below prices is 67 USD so don't liquidate
  panUsdPriceAuthority.setPrice(makeRatio(190n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(102n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  const notificationAfterFirstPriceChange = await E(aliceLoanNotifier).getUpdateSince();

  // Check if the loan is still active
  t.is(notificationAfterFirstPriceChange.value.loanState, LoanPhase.ACTIVE);

  // Check market state after price change
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Now make the max debt quote 66 USD and the value of the debt is 67 USD, so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  // Check market state after price change
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const notificationAfter = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationAfter.value.loanState, LoanPhase.LIQUIDATED);
  // Check market state after liquidation
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const debtWithPenalty = floorMultiplyBy(aliceDebtProposal.want.Debt, panRates.penaltyRate);
  const panPoolInitialLiquidity = AmountMath.make(panBrand, 10n * 10n ** 8n);
  const panPoolCurrentLiquidity = await E(panPoolMan).getUnderlyingLiquidity();
  const currentLoanDebt = await E(aliceLoan).getCurrentDebt();
  t.truthy(AmountMath.isGTE(panPoolCurrentLiquidity, panPoolInitialLiquidity)
    && AmountMath.isGTE(
      AmountMath.add(debtWithPenalty, panPoolInitialLiquidity),
      panPoolCurrentLiquidity));
  t.deepEqual(currentLoanDebt, AmountMath.makeEmpty(panBrand));
});

/**
 * We assume we'll have multiple loans, so we need to keep in track which loan
 * is underwater and which is not. Here we create three loans, one for Alice, Bon and
 * Maggie each. After the price changes we expect Maggie's loan to be active
 * and the other two to be liquidated.
 */
test('prices-fluctuate-multiple-loans-liquidate', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay * 10n, // We don't want any interest accrual, yet
    recordingPeriod: secondsPerDay * 10n,
    priceCheckPeriod: secondsPerDay,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
    1n * 100n * 10n ** 6n ,
    1n * 100n * 10n ** 6n,
    90n * 10n ** 8n * 100n,
    100n * 10n ** 8n * 100n
  );

  await waitForPromisesToSettle();

  // We use manualPriceAuthority to manipulate the prices in a more controlled way
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

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Get a loan for Alice
  const {
    loanKit: aliceLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterAliceLoan,
  } = await borrow( // borrow is a helper method to get loans
    zoe,
    lendingPoolPublicFacet,
    vanPoolDepositedMoney.payment,
    vanPoolMan,
    10n ** 8n, // Max debt is 73 USD
    panBrand,
    35n * 10n ** 6n); // Debt value is 63 USD

  // Check market state after Alice borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.publicNotifiers.loanNotifier;

  // Get a loan for Maggie
  const {
    loanKit: maggieLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterMaggieLoan,
  } = await borrow(
    zoe,
    lendingPoolPublicFacet,
    vanPoolMoneyLeftAfterAliceLoan,
    vanPoolMan,
    10n ** 8n, // Max debt is 73 USD
    panBrand,
    4n * 10n ** 6n); // Debt value is 7 USD

  // Check market state after Maggie borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const maggieLoan = maggieLoanKit.loan;
  const maggieLoanNotifier = maggieLoanKit.publicNotifiers.loanNotifier;

  // Get a loan for Bob
  const {
    loanKit: bobLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterBobLoan,
  } = await borrow(
    zoe,
    lendingPoolPublicFacet,
    vanPoolMoneyLeftAfterMaggieLoan,
    vanPoolMan,
    5n* 10n ** 7n, // Max debt is 36 USD
    panBrand,
    18n * 10n ** 6n); // Debt value is 32 USD

  // Check market state after Bob borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const bobLoan = bobLoanKit.loan;
  const bobLoanNotifier = bobLoanKit.publicNotifiers.loanNotifier;

  const [aliceNotificationBefore, maggieNotificationBefore, bobNotificationBefore] = await Promise.all([
    E(aliceLoanNotifier).getUpdateSince(),
    E(maggieLoanNotifier).getUpdateSince(),
    E(bobLoanNotifier).getUpdateSince()
  ]);

  // All loand should be active
  t.is(aliceNotificationBefore.value.loanState, LoanPhase.ACTIVE);
  t.is(maggieNotificationBefore.value.loanState, LoanPhase.ACTIVE);
  t.is(bobNotificationBefore.value.loanState, LoanPhase.ACTIVE);

  // Loans are effected as below
  // Bob max debt is 35 USD, debt value is 34 USD so don't liquidate
  // Maggie max debt is 70 USD, debt value is 7 USD so don't liquidate
  // Alice max debt is 70 USD, debt value is 66 USD so don't liquidate
  panUsdPriceAuthority.setPrice(makeRatio(190n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(106n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  const [aliceNotificationAfterFirstPriceChange, maggieNotificationAfterFirstPriceChange, bobNotificationAfterFirstPriceChange] = await Promise.all([
    E(aliceLoanNotifier).getUpdateSince(),
    E(maggieLoanNotifier).getUpdateSince(),
    E(bobLoanNotifier).getUpdateSince(),
  ]);

  t.is(aliceNotificationAfterFirstPriceChange.value.loanState, LoanPhase.ACTIVE);
  t.is(maggieNotificationAfterFirstPriceChange.value.loanState, LoanPhase.ACTIVE);
  t.is(bobNotificationAfterFirstPriceChange.value.loanState, LoanPhase.ACTIVE);

  // Check market state after price change
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Loans are effected as below
  // Bob max debt is 33 USD, debt value is 34 USD so liquidate
  // Maggie max debt is 66 USD, debt value is 7 USD so don't liquidate
  // Alice max debt is 66 USD, debt value is 67 USD so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  const [aliceNotificationAfterSecondPriceChange, maggieNotificationAfterSecondPriceChange, bobNotificationAfterSecondPriceChange] = await Promise.all([
    E(aliceLoanNotifier).getUpdateSince(),
    E(maggieLoanNotifier).getUpdateSince(),
    E(bobLoanNotifier).getUpdateSince(),
  ]);

  t.is(aliceNotificationAfterSecondPriceChange.value.loanState, LoanPhase.LIQUIDATED);
  t.is(maggieNotificationAfterSecondPriceChange.value.loanState, LoanPhase.ACTIVE);
  t.is(bobNotificationAfterSecondPriceChange.value.loanState, LoanPhase.LIQUIDATED);

  // Check market state after price change
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  const [aliceCurrentLoanDebt, maggieCurrentLoanDebt, bobCurrentLoanDebt] = await Promise.all([
    E(aliceLoan).getCurrentDebt(),
    E(maggieLoan).getCurrentDebt(),
    E(bobLoan).getCurrentDebt(),
  ]);

  t.deepEqual(aliceCurrentLoanDebt, AmountMath.makeEmpty(panBrand));
  t.deepEqual(maggieCurrentLoanDebt, AmountMath.make(panBrand, 4n * 10n ** 6n));
  t.deepEqual(bobCurrentLoanDebt, AmountMath.makeEmpty(panBrand));
});

/**
 * One other scenario for liquidation is that the prices hold still
 * but the loan reaches the liquidation margin by the accrual of interest
 *
 */
test('prices-hold-still-liquidates-with-interest-accrual', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay, // We don't want any interest accrual, yet
    recordingPeriod: secondsPerDay * 10n,
    priceCheckPeriod: secondsPerDay * 10n,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 10n),
    secondsPerDay * 10n,
    1n * 100n * 10n ** 6n ,
    1n * 100n * 10n ** 6n,
    90n * 10n ** 8n * 100n,
    100n * 10n ** 8n * 100n
  );

  // We use manualPriceAuthority to manipulate the prices in a more controlled way
  const vanUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(108n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand),
    timer
  });

  const panUsdPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    initialPrice: makeRatio(179n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand),
    timer,
  });

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Get market state checkers
  const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
    await makeMarketStateChecker(t, vanPoolMan),
    await makeMarketStateChecker(t, panPoolMan),
  ]);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check the protocol tokens received
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
      E(vanPoolMan).getProtocolIssuer(),
      E(vanPoolMan).getProtocolBrand(),
      E(panPoolMan).getProtocolIssuer(),
      E(panPoolMan).getProtocolBrand(),
    ],
  );

  // Check market state after deposit
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Get a loan for Alice
  const {
    loanKit: aliceLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterAliceLoan,
  } = await borrow(
    zoe,
    lendingPoolPublicFacet,
    vanPoolDepositedMoney.payment,
    vanPoolMan,
    10n ** 8n, // Max debt is 72 USD worth of PAN
    panBrand,
    4019n * 10n ** 4n); // Debt value is 71 USD

  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.publicNotifiers.loanNotifier;

  const aliceNotificationBefore = await E(aliceLoanNotifier).getUpdateSince();
  t.is(aliceNotificationBefore.value.loanState, LoanPhase.ACTIVE);

  // Check market state after Alice borrow
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // On one tick 10 periods of interest will accrue in a compounded manner
  await timer.tick()
  await waitForPromisesToSettle();

  // We expect the borrowing rate to be 331 basis points after the borrow
  t.deepEqual(makeRatio(331n, panBrand, BASIS_POINTS), await E(panPoolMan).getCurrentBorrowingRate());

  // Check market state after interest charged
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // A price update is necessary to initiate liquidation
  vanUsdPriceAuthority.setPrice(makeRatio(108n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  await waitForPromisesToSettle();

  const aliceNotificationAfter = await E(aliceLoanNotifier).getUpdateSince();
  t.is(aliceNotificationAfter.value.loanState, LoanPhase.LIQUIDATED);

  // Check market state after liquidation
  await Promise.all([
    await checkVanPoolStateInSync(),
    await checkPanPoolStateInSync(),
  ]);

  // Borrowing rate should be 250 basis points after the liquidation, since
  // the liquidity in the pool is increased and total debt is decereased
  t.deepEqual(makeRatio(250n, panBrand, BASIS_POINTS), await E(panPoolMan).getCurrentBorrowingRate());

  const aliceCurrentLoanDebt = await E(aliceLoan).getCurrentDebt();
  t.deepEqual(aliceCurrentLoanDebt, AmountMath.makeEmpty(panBrand));
});




