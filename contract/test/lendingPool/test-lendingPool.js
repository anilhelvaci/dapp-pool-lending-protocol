// @ts-check
import { makeTracer } from '../../src/makeTracer.js';

const trace = makeTracer('TestST');

import { test as unknownTest } from '@agoric/zoe/tools/prepare-test-env-ava.js'; // swingset-vat to zoe
import '@agoric/zoe/exported.js';
import { deeplyFulfilled, Far } from '@endo/marshal';

import { E } from '@agoric/eventual-send';
import { makeIssuerKit, AssetKind, AmountMath } from '@agoric/ertp';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import {
  makeRatio,
  makeRatioFromAmounts,
  ceilMultiplyBy,
  ceilDivideBy,
  floorDivideBy,
  floorMultiplyBy,
  getAmountOut,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makePromiseKit } from '@endo/promise-kit';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';
import { makePriceManager } from '../../src/lendingPool/priceManager.js';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/safeMath.js';
import { Nat } from '@agoric/nat';
import { makeInnerLoan } from '../../src/lendingPool/loan.js';
import { depositMoney, addPool, makeRates, setupAssets, makeBundle, borrow } from './helpers.js';

import {
  setUpZoeForTest,
  getPath,
  startLendingPool,
  setupAmmAndElectorate,
} from './setup.js';
import { LARGE_DENOMINATOR, SECONDS_PER_YEAR } from '../../src/interest.js';
import '../../src/lendingPool/types.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import { unsafeMakeBundleCache } from '@agoric/run-protocol/test/bundleTool.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { LoanPhase } from '../../src/lendingPool/loan.js';
import { makeLiquidationObserver } from '../../src/lendingPool/liquidationObserver.js';
import { makeScalarMap } from '@agoric/store';

const test = unknownTest;

const contractRoots = {
  faucet: './faucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  amm: '@agoric/run-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js',
};

/** @typedef {import('../../src/loanFactory/loanFactory.js').LoanFactoryPublicFacet} LoanFactoryPublicFacet */

const BASIS_POINTS = 10000n;
const secondsPerDay = SECONDS_PER_YEAR / 365n;

// Define locally to test that loanFactory uses these values
export const Phase = /** @type {const} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
  TRANSFER: 'transfer',
});

// Some notifier updates aren't propagating sufficiently quickly for the tests.
// This invocation (thanks to Warner) waits for all promises that can fire to
// have all their callbacks run
async function waitForPromisesToSettle() {
  const pk = makePromiseKit();
  setImmediate(pk.resolve);
  return pk.promise;
}

function calculateProtocolFromUnderlying(underlyingAmount, exchangeRate) {
  return floorDivideBy(
    underlyingAmount,
    exchangeRate,
  );
}

function calculateUnderlyingFromProtocol(protocolAmount, exchangeRate) {
  return floorMultiplyBy(
    protocolAmount,
    exchangeRate,
  );
}

/**
 * NOTE: called separately by each test so AMM/zoe/priceAuthority don't interfere
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
  const priceManager = makePriceManager({});
  produce.priceManager.resolve(priceManager);

  await startLendingPool(space, { loanParams: loanTiming });

  const governorCreatorFacet = consume.lendingPoolGovernorCreator;
  /** @type {Promise<LoanFactory & LimitedCreatorFacet<any>>} */
  const lendingPoolCreatorFacetP = /** @type { any } */ (
    E(governorCreatorFacet).getCreatorFacet()
  );

  /** @type {[any, LoanFactory, VFC['publicFacet'], LoanManager, PriceAuthority]} */
    // @ts-expect-error cast
  const [
      governorInstance,
      lendingPoolCreatorFacet,
      lendingPoolPublicFacet,
    ] = await Promise.all([
      instance.consume.lendingPoolGovernor,
      lendingPoolCreatorFacetP,
      E(governorCreatorFacet).getPublicFacet(),
    ]);
  // trace(t, { governorInstance, lendingPoolCreatorFacet, lendingPoolPublicFacet });

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

test('dummy', t => {
  t.is('dummy', 'dummy');
});

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
  const protocolBrand = await E(vanPoolMan).getProtocolBrand();
  const protocolIssuer = await E(vanPoolMan).getProtocolIssuer();
  console.log('[BRAND]:', protocolBrand);
  console.log('[ISSUER]:', protocolIssuer);
  const underlyingAmountIn = AmountMath.make(vanBrand, 111111111n);
  const protocolAmountOut = await E(vanPoolMan).getProtocolAmountOut(underlyingAmountIn);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: vanMint.mintPayment(underlyingAmountIn),
  });

  const invitation = await E(vanPoolMan).makeDepositInvitation();
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

  t.is(await E(vanPoolMan).getProtocolLiquidity(), 5555555550n);
  t.deepEqual(await E(vanPoolMan).getUnderlyingLiquidity(), AmountMath.make(vanBrand, 111111111n));
  t.is(message, 'Finished');
});

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
  const protocolBrand = await E(vanPoolMan).getProtocolBrand();
  const protocolIssuer = await E(vanPoolMan).getProtocolIssuer();
  console.log('[BRAND]:', protocolBrand);
  console.log('[ISSUER]:', protocolIssuer);
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

  await t.throwsAsync(E(seat).getOfferResult()
    , { message: 'The amounts should be equal' });
});

test('borrow', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 5n,
    priceCheckPeriod: secondsPerDay * 5n * 2n,
  };

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 1n);
  await depositMoney(zoe, panPoolMan, panMint, 10n);

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  const debtProposal = {
    give: { Collateral: vanPoolDepositedMoney.amount },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) },
  };

  const debtPaymentKeywordRecord = {
    Collateral: vanPoolDepositedMoney.payment,
  };

  const borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  const borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const loanKit = await E(borrowerUserSeat).getOfferResult();
  const loan = loanKit.loan;

  let loanCurrentDebt = await E(loan).getCurrentDebt();

  t.deepEqual(loanCurrentDebt, debtProposal.want.Debt);

  // accrue interest
  await timer.tick();
  await timer.tick();
  loanCurrentDebt = await E(loan).getCurrentDebt();
  t.notDeepEqual(loanCurrentDebt, debtProposal.want.Debt);
});

test('borrow-rate-fluctuate', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 1n);
  await depositMoney(zoe, panPoolMan, panMint, 4n);

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 4n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 4n * 10n ** 8n + 1n)));

  let debtProposal = {
    give: { Collateral: vanPoolDepositedMoney.amount },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) },
  };

  let debtPaymentKeywordRecord = {
    Collateral: vanPoolDepositedMoney.payment,
  };

  let borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  let borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const loanKit4B = await E(borrowerUserSeat).getOfferResult();
  const loan4B = loanKit4B.loan;

  const loanCurrentDebt4B = await E(loan4B).getCurrentDebt();

  t.deepEqual(loanCurrentDebt4B, AmountMath.make(panBrand, 4n * 10n ** 6n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(270n, panBrand, BASIS_POINTS));

  const collateral = await depositMoney(zoe, vanPoolMan, vanMint, 4n);

  debtProposal = {
    give: { Collateral: collateral.amount },
    want: { Debt: AmountMath.make(panBrand, 2000000n) },
  };

  debtPaymentKeywordRecord = {
    Collateral: collateral.payment,
  };

  borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const loanKit1B = await E(borrowerUserSeat).getOfferResult();
  const loan1B = loanKit1B.loan;

  const loanCurrentDebt1B = await E(loan1B).getCurrentDebt();

  t.deepEqual(loanCurrentDebt1B, AmountMath.make(panBrand, 2000000n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(280n, panBrand, BASIS_POINTS));

  await timer.tick();
  await waitForPromisesToSettle();
  t.deepEqual(await E(panPoolMan).getTotalDebt(), AmountMath.make(panBrand, 6000000n + 3183n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(280n, panBrand, BASIS_POINTS)); // adopt banker's rounding
  t.deepEqual((await E(panPoolMan).getExchangeRate()).numerator, AmountMath.make(panBrand, 2000016n)); // adopt banker's rounding
});

/**
 * Here we first get a loan for Alice then update the loan by putting more
 * collateral and receiving more debt. No interest is accrued during this
 * process.
 */
test('adjust-balances-no-interest', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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

  t.deepEqual(aliceLoanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));

  const [aliceCollateralUpdatePayment, vanDepositedMoneyMinusAliceLoanUpdate] =
    await E(agVanIssuer).split(vanPoolDepositedMoney,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n), await E(vanPoolMan).getExchangeRate())); // put 1,5 unit more VAN as collateral
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoanUpdate;

  const aliceAdjustBalanceProposal = harden({
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralUpdatePayment) },
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

  const aliceDebtReceivedPayment = await E(aliceUpdatedLoanSeat).getPayouts();
  const aliceLoanCurrentDebtAfterUpdate = await E(aliceLoan).getCurrentDebt();
  const aliceLoanCollateralAfterUpdate = await E(aliceLoan).getCollateralAmount();

  t.deepEqual(await E(panIssuer).getAmountOf(aliceDebtReceivedPayment.Debt), AmountMath.make(panBrand, 7n * 10n ** 8n / 100n));
  t.deepEqual(aliceLoanCurrentDebtAfterUpdate, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n)));
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n + 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
});

test('adjust-balances-interest-accrued', async t => {
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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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

  t.deepEqual(aliceLoanCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));

  await timer.tick();
  await waitForPromisesToSettle();
  t.deepEqual(await E(aliceLoan).getCurrentDebt(), AmountMath.make(panBrand, 4000000n + 280n));

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


  t.is(aliceUpdateOfferResult, 'We have adjusted your balances, thank you for your business');
  t.deepEqual(await E(panIssuer).getAmountOf(aliceDebtReceivedPayment.Debt), AmountMath.make(panBrand, 7n * 10n ** 8n / 100n));
  t.deepEqual(aliceLoanCurrentDebtAfterUpdate, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n) + 280n));
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));

  await timer.tick();
  await waitForPromisesToSettle();

  const aliceLoanCurrentDebtAfterSecondInterestAccrual = await E(aliceLoan).getCurrentDebt();
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(272n, panBrand, BASIS_POINTS));
  t.deepEqual(aliceLoanCurrentDebtAfterSecondInterestAccrual, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n) + 280n + 809n));
  await waitForPromisesToSettle();
});

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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

  const amountToPay = AmountMath.make(panBrand, 7n * 10n ** 6n);

  const aliceAdjustBalanceProposal = harden({
    give: { Debt: amountToPay },
    // we want 0,02 VAN worth AgVAN
    want: { Collateral: AmountMath.make(agVanBrand, 2n * 10n ** 7n * 50n) },
  });

  const aliceAdjustBalancePayment = harden(
    {
      Debt: panMint.mintPayment(amountToPay),
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
  t.deepEqual(aliceLoanCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 8n * 10n ** 8n / 10n), await E(vanPoolMan).getExchangeRate()));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(306n, panBrand, BASIS_POINTS));
})

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) }, // 0,04 PAN
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

  const aliceCloseProposal = {
    give: { Debt: AmountMath.make(panBrand, 4n * 10n ** 8n / 100n) },
    want: { Collateral: AmountMath.makeEmpty(agVanBrand) },
  };

  const aliceClosePayment = {
    Debt: panMint.mintPayment(AmountMath.make(panBrand, 4n * 10n ** 8n / 100n)),
  };

  const aliceCloseSeat = await E(zoe).offer(
    E(aliceLoan).makeCloseInvitation(),
    aliceCloseProposal,
    aliceClosePayment,
  );

  const aliceCloseOfferResult = await E(aliceCloseSeat).getOfferResult();
  const aliceClosePayout = await E(aliceCloseSeat).getPayout('Collateral');
  const aliceLoanNotifier = await E(aliceLoan).getNotifier();
  const state = await E(aliceLoanNotifier).getUpdateSince();

  t.is(aliceCloseOfferResult, 'your loan is closed, thank you for your business');
  t.is(state.value.loanState, LoanPhase.CLOSED);
  t.deepEqual(aliceClosePayout, aliceCollateralPayment);
});

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
    recordingPeriod: secondsPerDay * 7n,
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

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(agVanIssuer).getBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(agPanIssuer).getBrand();

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 5n);
  let panPoolDepositMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  const [collateralPayment, vanDepositedMoneyMinusLoan] =
    await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  vanPoolDepositedMoney = vanDepositedMoneyMinusLoan;

  let debtProposal = {
    give: { Collateral: await E(agVanIssuer).getAmountOf(collateralPayment) },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) },
  };

  let debtPaymentKeywordRecord = {
    Collateral: collateralPayment,
  };

  let borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  let borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const loanKit4B = await E(borrowerUserSeat).getOfferResult();
  const loan4B = loanKit4B.loan;

  const loanCurrentDebt4B = await E(loan4B).getCurrentDebt();

  t.deepEqual(loanCurrentDebt4B, AmountMath.make(panBrand, 4n * 10n ** 6n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));

  // interest time
  await timer.tick();
  await waitForPromisesToSettle();

  const loan4BDebtAfterInterest = await E(loan4B).getCurrentDebt();

  t.deepEqual(loan4BDebtAfterInterest, AmountMath.make(panBrand, 4n * 10n ** 6n + 1960n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));
  t.deepEqual((await E(panPoolMan).getExchangeRate()).numerator, AmountMath.make(panBrand, 2000004n));

  const [redeemPayment, panDepositedMoneyMinusRedeem] =
    await E(agPanIssuer).split(panPoolDepositMoney.payment,
      AmountMath.make(agPanBrand, 1n * 10n ** 8n * 50n));

  const redeemProposal = {
    give: { Protocol: await E(agPanIssuer).getAmountOf(redeemPayment) },
    want: { Underlying: AmountMath.makeEmpty(panBrand) }
  };

console.log("redeemPayment", await E(agPanIssuer).getAmountOf(redeemPayment))
  const redeemPaymentRecord = {
    Protocol: redeemPayment
  };

  const redeemUserSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeRedeemInvitation(panBrand),
    redeemProposal,
    redeemPaymentRecord
  );

  const redeemPayout = await E(redeemUserSeat).getPayout("Underlying");
  const protocolPayout = await E(redeemUserSeat).getPayout("Protocol");
  const redeemOfferResult = await E(redeemUserSeat).getOfferResult();
  console.log("redeemOfferResult", redeemOfferResult)
  console.log("redeemCurrentAllocation", await E(redeemUserSeat).getCurrentAllocation());
  console.log("protocolPayout", await E(agPanIssuer).getAmountOf(protocolPayout));
  t.deepEqual(await E(panIssuer).getAmountOf(redeemPayout), AmountMath.make(panBrand, 100000200n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(259n, panBrand, BASIS_POINTS));
  t.deepEqual((await E(panPoolMan).getExchangeRate()).numerator, AmountMath.make(panBrand, 2000004n));
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

test('liquidate', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    vanRates,
    panRates,
  } = t.context;

  t.context.loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer, ammFacets } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay),
    secondsPerDay,
      100n * 100n * 10n ** 6n,
      100n * 100n * 10n ** 6n,
     100n * 10n ** 8n,
    100n * 10n ** 8n
  );

  const [vanUsdPool, panUsdPool] = await Promise.all([
    E(ammFacets.ammPublicFacet).getPoolAllocation(vanBrand),
    E(ammFacets.ammPublicFacet).getPoolAllocation(panBrand),
  ]);

  console.log("vanPoolLiquidity", vanUsdPool)
  console.log("panPoolLiquidity", panUsdPool)

  t.is("is", "is");

  // Bob looks up the value of 4000 simoleans in moola
  const inputPrice = await E(ammFacets.ammPublicFacet).getInputPrice(
    AmountMath.make(panBrand, 35n * 10n ** 6n ),
    AmountMath.makeEmpty(vanBrand),
  );

  console.log("inputPrice", inputPrice);

  // const vanUsdPriceAuthority = makeManualPriceAuthority({
  //   actualBrandIn: vanBrand,
  //   actualBrandOut: usdBrand,
  //   initialPrice: makeRatio(110n, usdBrand, 1n, vanBrand),
  //   timer
  // });
  //
  // const panUsdPriceAuthority = makeManualPriceAuthority({
  //   actualBrandIn: panBrand,
  //   actualBrandOut: usdBrand,
  //   initialPrice: makeRatio(200n, usdBrand, 1n, panBrand),
  //   timer,
  // });
  //
  // // Add the pools
  // const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  // const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);
  //
  // // Put money inside the pools
  // let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  // let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);
  //
  // // Check the protocol tokens received
  // const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  // const agVanBrand = await E(agVanIssuer).getBrand();
  // const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  // const agPanBrand = await E(agPanIssuer).getBrand();
  //
  // t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  // t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));
  //
  // await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  // await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));
  //
  // const [aliceCollateralPayment, vanDepositedMoneyMinusAliceLoan] =
  //   await E(agVanIssuer).split(vanPoolDepositedMoney.payment,
  //     calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
  // vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoan;
  //
  // // build the proppsal
  // const aliceDebtProposal = {
  //   give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralPayment) },
  //   want: { Debt: AmountMath.make(panBrand, 35n * 10n ** 6n) },
  // };
  //
  // const aliceDebtPaymentKeywordRecord = {
  //   Collateral: aliceCollateralPayment,
  // };
  //
  // // Get a loan for Alice
  // const aliceSeat = await E(zoe).offer(
  //   E(lendingPoolPublicFacet).makeBorrowInvitation(),
  //   aliceDebtProposal,
  //   aliceDebtPaymentKeywordRecord,
  //   { collateralUnderlyingBrand: vanBrand },
  // );
  //
  // const aliceLoanKit = await E(aliceSeat).getOfferResult();
  // const aliceLoan = aliceLoanKit.loan;
  // const aliceLoanNotifier = aliceLoanKit.loanNotifier;
  //
  // await E(panPoolMan).liquidateLoan(vanBrand);
  //
  // const state = await E(aliceLoanNotifier).getUpdateSince();
  // t.is(state.value.loanState, LoanPhase.LIQUIDATED);
});

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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
  const aliceLoanNotifier = aliceLoanKit.loanNotifier;

  panUsdPriceAuthority.setPrice(makeRatio(200n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  // await timer.tick();
  await waitForPromisesToSettle();

  const notification = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notification.value.loanState, LoanPhase.LIQUIDATED);

  const debtWithPenalty = floorMultiplyBy(aliceDebtProposal.want.Debt, panRates.penaltyRate);
  const panPoolInitialLiquidity = AmountMath.make(panBrand, 10n * 10n ** 8n);
  const panPoolCurrentLiquidity = await E(panPoolMan).getUnderlyingLiquidity();
  t.truthy(AmountMath.isGTE(panPoolCurrentLiquidity, panPoolInitialLiquidity)
    && AmountMath.isGTE(
      AmountMath.add(debtWithPenalty, panPoolInitialLiquidity),
      panPoolCurrentLiquidity));
});

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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
  const aliceLoanNotifier = aliceLoanKit.loanNotifier;

  const notificationBefore = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationBefore.value.loanState, LoanPhase.ACTIVE);

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
});

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

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
  const aliceLoanNotifier = aliceLoanKit.loanNotifier;

  const notificationBefore = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationBefore.value.loanState, LoanPhase.ACTIVE);

  // Max quote for the below prices is 67 USD so don't liquidate
  panUsdPriceAuthority.setPrice(makeRatio(190n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(102n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

  await waitForPromisesToSettle();

  const notificationAfterFirstPriceChange = await E(aliceLoanNotifier).getUpdateSince();
  t.is(notificationAfterFirstPriceChange.value.loanState, LoanPhase.ACTIVE);

  // Now make the max quote 66 USD and the value of the debt is 67 USD, so liquidate
  panUsdPriceAuthority.setPrice(makeRatio(193n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, panBrand));
  vanUsdPriceAuthority.setPrice(makeRatio(100n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));

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
});

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(agVanIssuer).getBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(agPanIssuer).getBrand();

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Get a loan for Alice
  const {
    loanKit: aliceLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterAliceLoan,
  } = await borrow(zoe, lendingPoolPublicFacet, vanPoolDepositedMoney.payment, vanPoolMan, 10n ** 8n, panBrand, 35n * 10n ** 6n);

  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.loanNotifier;

  // Get a loan for Maggie
  const {
    loanKit: maggieLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterMaggieLoan,
  } = await borrow(zoe, lendingPoolPublicFacet, vanPoolMoneyLeftAfterAliceLoan, vanPoolMan, 10n ** 8n, panBrand, 4n * 10n ** 6n);

  const maggieLoan = maggieLoanKit.loan;
  const maggieLoanNotifier = maggieLoanKit.loanNotifier;

  // Get a loan for Bob
  const {
    loanKit: bobLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterBobLoan,
  } = await borrow(zoe, lendingPoolPublicFacet, vanPoolMoneyLeftAfterMaggieLoan, vanPoolMan, 5n* 10n ** 7n, panBrand, 18n * 10n ** 6n);

  const bobLoan = bobLoanKit.loan;
  const bobLoanNotifier = bobLoanKit.loanNotifier;

  const [aliceNotificationBefore, maggieNotificationBefore, bobNotificationBefore] = await Promise.all([
    E(aliceLoanNotifier).getUpdateSince(),
    E(maggieLoanNotifier).getUpdateSince(),
    E(bobLoanNotifier).getUpdateSince()
  ]);

  t.is(aliceNotificationBefore.value.loanState, LoanPhase.ACTIVE);
  t.is(maggieNotificationBefore.value.loanState, LoanPhase.ACTIVE);
  t.is(bobNotificationBefore.value.loanState, LoanPhase.ACTIVE);

  // Max quote for the below prices is 67 USD so don't liquidate
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

  // Now make the max quote 66 USD and the value of the debt is 67 USD, so liquidate
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

  const [aliceCurrentLoanDebt, maggieCurrentLoanDebt, bobCurrentLoanDebt] = await Promise.all([
    E(aliceLoan).getCurrentDebt(),
    E(maggieLoan).getCurrentDebt(),
    E(bobLoan).getCurrentDebt(),
  ]);

  t.deepEqual(aliceCurrentLoanDebt, AmountMath.makeEmpty(panBrand));
  t.deepEqual(maggieCurrentLoanDebt, AmountMath.make(panBrand, 4n * 10n ** 6n));
  t.deepEqual(bobCurrentLoanDebt, AmountMath.makeEmpty(panBrand));
});

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

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 6n);
  let panPoolDepositedMoney = await depositMoney(zoe, panPoolMan, panMint, 10n);

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(agVanIssuer).getBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(agPanIssuer).getBrand();

  t.deepEqual(vanPoolDepositedMoney.amount, AmountMath.make(agVanBrand, 3n * 10n ** 10n));
  t.deepEqual(panPoolDepositedMoney.amount, AmountMath.make(agPanBrand, 5n * 10n ** 10n));

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  // Get a loan for Alice
  const {
    loanKit: aliceLoanKit,
    moneyLeftInPool: vanPoolMoneyLeftAfterAliceLoan,
  } = await borrow(zoe, lendingPoolPublicFacet, vanPoolDepositedMoney.payment, vanPoolMan, 10n ** 8n, panBrand, 4019n * 10n ** 4n);

  const aliceLoan = aliceLoanKit.loan;
  const aliceLoanNotifier = aliceLoanKit.loanNotifier;

  const aliceNotificationBefore = await E(aliceLoanNotifier).getUpdateSince();
  t.is(aliceNotificationBefore.value.loanState, LoanPhase.ACTIVE);

  await timer.tick()
  await waitForPromisesToSettle();

  t.deepEqual(makeRatio(330n, panBrand, BASIS_POINTS), await E(panPoolMan).getCurrentBorrowingRate());

  vanUsdPriceAuthority.setPrice(makeRatio(108n * 10n ** 6n, usdBrand, 1n * 10n ** 8n, vanBrand));
  await waitForPromisesToSettle();

  const aliceNotificationAfter = await E(aliceLoanNotifier).getUpdateSince();
  t.is(aliceNotificationAfter.value.loanState, LoanPhase.LIQUIDATED);

  t.deepEqual(makeRatio(250n, panBrand, BASIS_POINTS), await E(panPoolMan).getCurrentBorrowingRate());

  const aliceCurrentLoanDebt = await E(aliceLoan).getCurrentDebt();
  t.deepEqual(aliceCurrentLoanDebt, AmountMath.makeEmpty(panBrand));
});

test("price-observer-test", async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    compareCurrencyKit: { brand: usdBrand, mint: usdMint },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    agVanKit: { brand: agVanBrand },
    vanRates,
    panRates,
  } = t.context;

  const timer = buildManualTimer(console.log, 0n, secondsPerDay);

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

  const wrappedVanUsdPriceAuth = await E(priceManager).getPriceAuthority(vanBrand);
  const wrappedPanUsdPriceAuth = await E(priceManager).getPriceAuthority(panBrand);

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

test('assertCollateralSufficient', async t => {
  /**
   * We expect collateralAmount to be in the protocolToken brand, so we first need to calculate
   * how much underlying token this protocolToken correspons to. We compare the value of both collateral and debt
   * against another currency. Therefore, we need to know the underlying token's value in terms of the third currency.
   * To do that we request a quote from the priceAuthority(UnderlyingToken vs ThirdCurreny). Then we divide it by the
   * liquidationMargin in order to know the max amount of debt for this given collateral. Once we know the value of max debt
   * amount in terms of thirdCurrency we can compare it to the requested debt amount and if the requested debt amount
   * does not exceed the max debt amount we lend the underlyingToken.
   * */

  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
    agVanKit: { mint: agVanMint, issuer: agVanIssuer, brand: agVanBrand },
  } = setupAssets();

  const loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
    priceCheckPeriod: 50n,
  };

  const vanInitialLiquidity = AmountMath.make(vanBrand, 300n);
  const vanLiquidity = {
    proposal: vanInitialLiquidity,
    payment: vanMint.mintPayment(vanInitialLiquidity),
  };

  const bootstrappedAssets = [vanBrand];

  const { priceManager, timer, quoteMint } = await setupServices(
    loanTiming,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    vanBrand,
    { committeeName: 'TheCabal', committeeSize: 5 },
    buildManualTimer(console.log),
    undefined,
    vanLiquidity,
    500n,
    vanIssuer,
    bootstrappedAssets,
    usdBrand,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 15n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(vanBrand, 1n),
    quoteInterval: 10n,
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [500n, 300n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(panBrand, 1n),
    quoteInterval: 10n,
  });

  priceManager.addNewPriceAuthority(vanBrand, vanUsdPriceAuthority);
  priceManager.addNewPriceAuthority(panBrand, panUsdPriceAuthority);

  const exchangeRate = makeRatioFromAmounts(AmountMath.make(vanBrand, 200n),
    AmountMath.make(agVanBrand, BASIS_POINTS));

  const mockLoanInput = {
    zcf: {
      makeEmptySeatKit: () => {
        return { zcfSeat: undefined };
      },
    },
    /** @type InnerLoan */
    manager: {
      getCollateralBrand: () => vanBrand,
      getLiquidationMargin: () => makeRatio(150n, usdBrand),
      getThirdCurrencyBrand: () => usdBrand,
      getCompoundedInterest: () => makeRatio(100n, panBrand),
    },
    mint: {
      getIssuerRecord: () => {
        return { brand: vanBrand };
      },
    },
  };

  const loan = makeInnerLoan(
    mockLoanInput.zcf,
    mockLoanInput.manager,
    {},
    {},
    panBrand,
    priceManager);

  const underlyingAmount = AmountMath.make(vanBrand, 111111111n);
  const protocolMintAmount = ceilDivideBy(underlyingAmount, exchangeRate);
  const proposedDebtAmount = AmountMath.make(panBrand, 15555554n);

  t.deepEqual(protocolMintAmount, AmountMath.make(agVanBrand, 5555555550n));

  t.is((await loan.testMethods.maxDebtFor(protocolMintAmount, exchangeRate)).value, 7777777770n);
  await t.notThrowsAsync(loan.testMethods.assertSufficientCollateral(
    protocolMintAmount,
    proposedDebtAmount,
    exchangeRate));
  await t.notThrowsAsync(loan.testMethods.assertSufficientCollateral(
    protocolMintAmount,
    AmountMath.make(panBrand, proposedDebtAmount.value + 1n),
    exchangeRate));
  await t.throwsAsync(loan.testMethods.assertSufficientCollateral(
    protocolMintAmount,
    AmountMath.make(panBrand, proposedDebtAmount.value + 2n),
    exchangeRate));
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




