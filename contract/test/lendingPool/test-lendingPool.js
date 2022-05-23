// @ts-check
import { makeTracer } from '../../src/makeTracer.js';
const trace = makeTracer('TestST');

import { test as unknownTest } from '@agoric/zoe/tools/prepare-test-env-ava.js'; // swingset-vat to zoe
import '@agoric/zoe/exported.js';
import { deeplyFulfilled } from '@endo/marshal';

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
  getAmountOut
} from '@agoric/zoe/src/contractSupport/index.js';
import { makePromiseKit } from '@endo/promise-kit';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';
import { makePriceManager } from '../../src/lendingPool/priceManager.js';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/safeMath.js';
import { Nat } from '@agoric/nat';
import { makeInnerVault } from '../../src/lendingPool/vault.js';
import { depositMoney, addPool, makeRates, setupAssets, makeBundle } from './helpers.js';

import {
  setUpZoeForTest,
  getPath,
  startLendingPool,
  setupAmmAndElectorate
} from './setup.js';
import { SECONDS_PER_YEAR } from '../../src/interest.js';
import '../../src/lendingPool/types.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import { unsafeMakeBundleCache } from '@agoric/run-protocol/test/bundleTool.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';

const test = unknownTest;

const contractRoots = {
  faucet: './faucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  amm: '@agoric/run-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js',
};

/** @typedef {import('../../src/vaultFactory/vaultFactory.js').VaultFactoryPublicFacet} VaultFactoryPublicFacet */

const BASIS_POINTS = 10000n;
const secondsPerDay = SECONDS_PER_YEAR / 365n;

// Define locally to test that vaultFactory uses these values
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
    exchangeRate
  )
}

function calculateUnderlyingFromProtocol(protocolAmount, exchangeRate) {
  return floorMultiplyBy(
    protocolAmount,
    exchangeRate
  )
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
  compareInitialLiquidity,
) {
  const {
    zoe,
    compareCurrencyKit: { issuer: compCurrencyIssuer, brand: compCurrencyBrand, mint: compCurrencyMint },
    vanKit: { brand: vanBrand, issuer: vanIssuer, mint: vanMint },
    loanTiming,
    minInitialDebt,
    rates,
    vanInitialLiquidity,
  } = t.context;
  t.context.timer = timer;

  const comparePayment =  compCurrencyMint.mintPayment(AmountMath.make(compCurrencyBrand, compareInitialLiquidity));

  const compLiquidity = {
    proposal: harden(AmountMath.make(compCurrencyBrand, compareInitialLiquidity)),
    payment: comparePayment,
  };

  const vanLiquidity = {
    proposal: vanInitialLiquidity,
    payment: vanMint.mintPayment(vanInitialLiquidity),
  };
  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    t,
    vanLiquidity,
    compLiquidity,
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
  console.log("daaa")
  await startLendingPool(space, { loanParams: loanTiming } );

  const governorCreatorFacet = consume.lendingPoolGovernorCreator;
  /** @type {Promise<VaultFactory & LimitedCreatorFacet<any>>} */
  const lendingPoolCreatorFacetP = /** @type { any } */ (
    E(governorCreatorFacet).getCreatorFacet()
  );

  /** @type {[any, VaultFactory, VFC['publicFacet'], VaultManager, PriceAuthority]} */
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
    timer
  };
}

test('dummy', t => {
  t.is('dummy', 'dummy');
})

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

  const { vanKit, usdKit, panKit, } = setupAssets();

  const contextPs = {
    zoe,
    bundles,
    installation,
    electorateTerms: undefined,
    vanKit,
    compareCurrencyKit: usdKit,
    panKit,
    loanTiming: {
      chargingPeriod: 2n,
      recordingPeriod: 6n,
      priceCheckPeriod: 6n ,
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
    vanKit: {brand: vanBrand}
  } = t.context;

  const services = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
  );
  console.log("services", services);
  t.is("is", "is");
});

test('add-pool', async t => {
  const {
    vanKit: {brand: vanBrand, issuer: vanIssuer},
    compareCurrencyKit: {brand: usdBrand, issuer: usdIssuer},
    vanRates
  } = t.context;

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
  });

  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, "VAN", vanUsdPriceAuthority);

  t.is(await E(lendingPoolPublicFacet).hasPool(vanBrand), true);
  t.deepEqual(await E(lendingPoolPublicFacet).getPool(vanBrand), vanPoolMan);
});

test('deposit', async t => {
  const {
    vanKit: {brand: vanBrand, issuer: vanIssuer, mint: vanMint},
    compareCurrencyKit: {brand: usdBrand, issuer: usdIssuer},
    vanRates
  } = t.context;

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
  });

  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, "VAN", vanUsdPriceAuthority);
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
    paymentKeywordRecord
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
  t.is(await E(vanPoolMan).getUnderlyingLiquidity(), 111111111n);
  t.is(message, "Finished");
});

test('deposit - false protocolAmountOut', async t => {
  const {
    vanKit: {brand: vanBrand, issuer: vanIssuer, mint: vanMint},
    compareCurrencyKit: {brand: usdBrand, issuer: usdIssuer},
    vanRates
  } = t.context;

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    undefined,
    undefined,
    500n,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
  });

  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, "VAN", vanUsdPriceAuthority);
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
    paymentKeywordRecord
  );

  await t.throwsAsync( E(seat).getOfferResult()
  , {message: 'The amounts should be equal'});
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
    priceCheckPeriod: secondsPerDay * 5n * 2n
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 5n),
    secondsPerDay * 5n,
    500n,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 103n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 5n
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
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, "VAN", vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, "PAN", panUsdPriceAuthority);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 1n);
  await depositMoney(zoe, panPoolMan, panMint, 10n);

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 10n * 10n ** 8n + 1n)));

  const debtProposal = {
    give: { Collateral: vanPoolDepositedMoney.amount},
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) }
  };

  const debtPaymentKeywordRecord = {
    Collateral: vanPoolDepositedMoney.payment
  };

  const borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  const borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const vaultKit = await E(borrowerUserSeat).getOfferResult();
  const vault = vaultKit.vault;

  let vaultCurrentDebt = await E(vault).getCurrentDebt();

  t.deepEqual(vaultCurrentDebt, debtProposal.want.Debt);

  // accrue interest
  await timer.tick();
  await timer.tick();
  vaultCurrentDebt = await E(vault).getCurrentDebt();
  t.notDeepEqual(vaultCurrentDebt, debtProposal.want.Debt);
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
    priceCheckPeriod: secondsPerDay * 7n * 2n
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    500n,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 103n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
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
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, "VAN", vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, "PAN", panUsdPriceAuthority);

  // Put money inside the pools
  let vanPoolDepositedMoney = await depositMoney(zoe, vanPoolMan, vanMint, 1n);
  await depositMoney(zoe, panPoolMan, panMint, 4n);

  await t.notThrowsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 4n * 10n ** 8n - 1n)));
  await t.throwsAsync(E(panPoolMan).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 4n * 10n ** 8n + 1n)));

  let debtProposal = {
    give: { Collateral: vanPoolDepositedMoney.amount },
    want: { Debt: AmountMath.make(panBrand, 4n * 10n ** 6n) }
  };

  let debtPaymentKeywordRecord = {
    Collateral: vanPoolDepositedMoney.payment
  };

  let borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  let borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const vaultKit4B = await E(borrowerUserSeat).getOfferResult();
  const vault4B = vaultKit4B.vault;

  const vaultCurrentDebt4B = await E(vault4B).getCurrentDebt();

  t.deepEqual(vaultCurrentDebt4B, AmountMath.make(panBrand, 4n * 10n ** 6n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(270n, panBrand, BASIS_POINTS));

  const collateral = await depositMoney(zoe, vanPoolMan, vanMint,4n);

  debtProposal = {
    give: { Collateral: collateral.amount },
    want: { Debt: AmountMath.make(panBrand, 2000000n) }
  };

  debtPaymentKeywordRecord = {
    Collateral: collateral.payment
  };

  borrowInvitation = await E(lendingPoolPublicFacet).makeBorrowInvitation();

  borrowerUserSeat = await E(zoe).offer(
    borrowInvitation,
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const vaultKit1B = await E(borrowerUserSeat).getOfferResult();
  const vault1B = vaultKit1B.vault;

  const vaultCurrentDebt1B = await E(vault1B).getCurrentDebt();

  t.deepEqual(vaultCurrentDebt1B, AmountMath.make(panBrand, 2000000n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(280n, panBrand, BASIS_POINTS));

  await timer.tick();
  await waitForPromisesToSettle();
  t.deepEqual(await E(panPoolMan).getTotalDebt(), AmountMath.make(panBrand, 6000000n + 3183n))
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(280n, panBrand, BASIS_POINTS)); // adopt banker's rounding
  t.deepEqual((await E(panPoolMan).getExchangeRate()).numerator, AmountMath.make(panBrand, 200n)); // adopt banker's rounding
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
    priceCheckPeriod: secondsPerDay * 7n * 2n
  };

  const { zoe, lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet }, timer } = await setupServices(
    t,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
    secondsPerDay * 7n,
    500n,
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n, 110n, 101n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
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
  const vanPoolMan = await addPool(zoe, vanRates, lendingPoolCreatorFacet, vanIssuer, "VAN", vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panRates, lendingPoolCreatorFacet, panIssuer, "PAN", panUsdPriceAuthority);

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
    want: { Debt: AmountMath.make(panBrand, 4000000n) }
  };

  const aliceDebtPaymentKeywordRecord = {
    Collateral: aliceCollateralPayment
  };

  // Get a loan for Alice
  const aliceSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    aliceDebtProposal,
    aliceDebtPaymentKeywordRecord,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceVaultKit = await E(aliceSeat).getOfferResult();
  const aliceVault = aliceVaultKit.vault;

  const aliceVaultCurrentDebt = await E(aliceVault).getCurrentDebt();

  t.deepEqual(aliceVaultCurrentDebt, AmountMath.make(panBrand, 4n * 10n ** 8n / 100n));
  t.deepEqual(await E(panPoolMan).getCurrentBorrowingRate(), makeRatio(258n, panBrand, BASIS_POINTS));

  const [aliceCollateralUpdatePayment, vanDepositedMoneyMinusAliceLoanUpdate] =
    await E(agVanIssuer).split(vanPoolDepositedMoney,
      calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n), await E(vanPoolMan).getExchangeRate())); // put 1,5 unit more VAN as collateral
  vanPoolDepositedMoney = vanDepositedMoneyMinusAliceLoanUpdate;

  const aliceAdjustBalanceProposal = harden({
    give: { Collateral: await E(agVanIssuer).getAmountOf(aliceCollateralUpdatePayment) },
    want: { Debt: AmountMath.make(panBrand, 7n * 10n ** 8n / 100n) } // we want to borrow 0,07 PAN more
   });

  const aliceAdjustBalancePayment = harden(
    {
      Collateral: aliceCollateralUpdatePayment
    }
  );

  const aliceUpdatedLoanSeat = await E(zoe).offer(
    E(aliceVault).makeAdjustBalancesInvitation(),
    aliceAdjustBalanceProposal,
    aliceAdjustBalancePayment,
    { collateralUnderlyingBrand: vanBrand },
  );

  const aliceDebtReceivedPayment = await E(aliceUpdatedLoanSeat).getPayouts();
  const aliceVaultCurrentDebtAfterUpdate = await E(aliceVault).getCurrentDebt();
  const aliceVaultCollateralAfterUpdate = await E(aliceVault).getCollateralAmount();

  t.deepEqual(await E(panIssuer).getAmountOf(aliceDebtReceivedPayment.Debt), AmountMath.make(panBrand, 7n * 10n ** 8n / 100n) );
  t.deepEqual(aliceVaultCurrentDebtAfterUpdate, AmountMath.make(panBrand, (7n * 10n ** 8n / 100n) + (4n * 10n ** 8n / 100n)) );
  t.deepEqual(aliceVaultCollateralAfterUpdate,
    calculateProtocolFromUnderlying(AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n + 1n * 10n ** 8n), await E(vanPoolMan).getExchangeRate()));
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
    priceCheckPeriod: 50n
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
    usdBrand
  );

  const vanUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [105n, 15n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(vanBrand, 1n),
    quoteInterval: 10n
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

  const mockVaultInput = {
    zcf: {
      makeEmptySeatKit: () => {
        return { zcfSeat: undefined };
      },
    },
    /** @type InnerVault */
    manager: {
      getCollateralBrand: () => vanBrand,
      getLiquidationMargin: () => makeRatio(150n, usdBrand),
      getThirdCurrencyBrand: () => usdBrand,
      getCompoundedInterest: () => makeRatio(100n, panBrand)
    },
    mint: {
      getIssuerRecord: () => {
        return { brand: vanBrand };
      }
    }
  }

  const vault = makeInnerVault(
    mockVaultInput.zcf,
    mockVaultInput.manager,
    {},
    {},
    panBrand,
    priceManager);

  const underlyingAmount = AmountMath.make(vanBrand, 111111111n);
  const protocolMintAmount = ceilDivideBy(underlyingAmount, exchangeRate);
  const proposedDebtAmount = AmountMath.make(panBrand, 15555554n);

  t.deepEqual(protocolMintAmount, AmountMath.make(agVanBrand, 5555555550n));

  t.is((await vault.testMethods.maxDebtFor(protocolMintAmount, exchangeRate)).value, 7777777770n);
  await t.notThrowsAsync(vault.testMethods.assertSufficientCollateral(
    protocolMintAmount,
      proposedDebtAmount,
      exchangeRate));
  await t.notThrowsAsync(vault.testMethods.assertSufficientCollateral(
      protocolMintAmount,
      AmountMath.make(panBrand, proposedDebtAmount.value + 1n),
      exchangeRate));
  await t.throwsAsync(vault.testMethods.assertSufficientCollateral(
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
    quoteInterval:1n
  });

 const quote105 = await vanUsdPriceAuthority.quoteGiven(
   AmountMath.make(vanBrand, 4n * 10n ** 8n),
   usdBrand
 );

 t.deepEqual(getAmountOut(quote105), AmountMath.make(usdBrand, 420n));
 await timer.tick();
 await waitForPromisesToSettle();

  const quote103 = await vanUsdPriceAuthority.quoteGiven(
    AmountMath.make(vanBrand, 4n * 10n ** 8n),
    usdBrand
  );
 t.deepEqual(getAmountOut(quote103), AmountMath.make(usdBrand, 412n));

  await timer.tick();
  await waitForPromisesToSettle();

  const quote101 = await vanUsdPriceAuthority.quoteGiven(
    AmountMath.make(vanBrand, 4n * 10n ** 8n),
    usdBrand
  );
  t.deepEqual(getAmountOut(quote101), AmountMath.make(usdBrand, 404n));
})




