// @ts-check
import { makeTracer } from '../../src/makeTracer.js';
const trace = makeTracer('TestST');

import { test } from '@agoric/swingset-vat/tools/prepare-test-env-ava.js';
import '@agoric/zoe/exported.js';

import { resolve as importMetaResolve } from 'import-meta-resolve';

import { E } from '@agoric/eventual-send';
import bundleSource from '@endo/bundle-source';
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
import { observeNotifier } from '@agoric/notifier';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';
import { makeGovernedTerms } from '../../src/lendingPool/params.js';
import { assertAmountsEqual } from '@agoric/zoe/test/zoeTestHelpers.js';
import { makeParamManagerBuilder } from '@agoric/governance';
import { makePriceManager } from '../../src/lendingPool/priceManager.js';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/safeMath.js';
import { Nat } from '@agoric/nat';
import { makeInnerVault } from '../../src/lendingPool/vault.js';
import { depositMoney, addPool, makeRates, setupAssets, makeBundle } from './helpers.js';

import {
  setUpZoeForTest,
  setupAmmServices,
} from './setup.js';


import { SECONDS_PER_YEAR } from '../../src/interest.js';
import {
  CHARGING_PERIOD_KEY,
  RECORDING_PERIOD_KEY,
} from '../../src/lendingPool/params.js';
import '../../src/lendingPool/types.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import { calculateCurrentDebt } from '../../src/interest-math.js';
// import { har } from '../../../.yarn/releases/yarn-1.22.4';

// #region Support

const contractRoots = {
  faucet: './faucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
};

/** @typedef {import('../../src/vaultFactory/vaultFactory.js').VaultFactoryPublicFacet} VaultFactoryPublicFacet */

// const trace = makeTracer('TestST');

const BASIS_POINTS = 10000n;

// Define locally to test that vaultFactory uses these values
export const Phase = /** @type {const} */ ({
  ACTIVE: 'active',
  LIQUIDATING: 'liquidating',
  CLOSED: 'closed',
  LIQUIDATED: 'liquidated',
  TRANSFER: 'transfer',
});

// makeBundle is a slow step, so we do it once for all the tests.
const bundlePs = {
  faucet: makeBundle(bundleSource, contractRoots.faucet),
  liquidate: makeBundle(bundleSource, contractRoots.liquidate),
  LendingPool: makeBundle(bundleSource, contractRoots.LendingPool),
};

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

async function setupAmmAndElectorate(
  timer,
  zoe,
  aethLiquidity,
  runLiquidity,
  runIssuer,
  aethIssuer,
  electorateTerms,
) {
  const runBrand = await E(runIssuer).getBrand();
  const centralR = { issuer: runIssuer, brand: runBrand };

  const {
    amm,
    committeeCreator,
    governor,
    invitationAmount,
    electorateInstance,
    space,
  } = await setupAmmServices(electorateTerms, centralR, timer, zoe);

  const liquidityIssuer = E(amm.ammPublicFacet).addPool(aethIssuer, 'Aeth');
  const liquidityBrand = await E(liquidityIssuer).getBrand();

  const liqProposal = harden({
    give: {
      Secondary: aethLiquidity.proposal,
      Central: runLiquidity.proposal,
    },
    want: { Liquidity: AmountMath.makeEmpty(liquidityBrand) },
  });
  const liqInvitation = await E(
    amm.ammPublicFacet,
  ).makeAddLiquidityInvitation();

  const ammLiquiditySeat = await E(zoe).offer(
    liqInvitation,
    liqProposal,
    harden({
      Secondary: aethLiquidity.payment,
      Central: runLiquidity.payment,
    }),
  );

  const newAmm = {
    ammCreatorFacet: amm.ammCreatorFacet,
    ammPublicFacet: amm.ammPublicFacet,
    instance: amm.governedInstance,
    ammLiquidity: E(ammLiquiditySeat).getPayout('Liquidity'),
  };

  return {
    governor,
    amm: newAmm,
    committeeCreator,
    electorateInstance,
    invitationAmount,
    space,
  };
}

/**
 * @param { EconomyBootstrapPowers } powers
 * @param { Object } config
 * @param { LoanTiming } config.loanParams
 */
export const startLendingPool = async (
  {
    consume: {
      vaultBundles,
      chainTimerService,
      priceManager,
      zoe,
      feeMintAccess: feeMintAccessP, // ISSUE: why doeszn't Zoe await this?
      economicCommitteeCreatorFacet: electorateCreatorFacet,
      bootstrappedAssets,
      compareCurrencyBrand
    },
    produce, // {  vaultFactoryCreator }
    brand: {
      consume: { RUN: centralBrandP },
    },
    instance,
    installation,
  },
  { loanParams } = {
    loanParams: {
      chargingPeriod: SECONDS_PER_HOUR,
      recordingPeriod: SECONDS_PER_DAY,
    },
  },
) => {
  const bundles = await vaultBundles;
  const installations = await Collect.allValues({
    LendingPool: E(zoe).install(bundles.LendingPool),
    liquidate: E(zoe).install(bundles.liquidate),
  });

  const poserInvitationP = E(electorateCreatorFacet).getPoserInvitation();
  const [initialPoserInvitation, invitationAmount] = await Promise.all([
    poserInvitationP,
    E(E(zoe).getInvitationIssuer()).getAmountOf(poserInvitationP),
  ]);

  const centralBrand = await centralBrandP;

  // declare governed params for the vaultFactory; addVaultType() sets actual rates
  const rates = {
    liquidationMargin: makeRatio(105n, centralBrand),
    interestRate: makeRatio(250n, centralBrand, BASIS_POINTS),
    loanFee: makeRatio(200n, centralBrand, BASIS_POINTS),
  };

  const [ammInstance, electorateInstance, contractGovernorInstall] =
    await Promise.all([
      instance.consume.amm,
      instance.consume.economicCommittee,
      installation.consume.contractGovernor,
    ]);
  const ammPublicFacet = await E(zoe).getPublicFacet(ammInstance);

  const lendingPoolTerms = makeGovernedTerms(
    await priceManager,
    loanParams,
    installations.liquidate,
    chainTimerService,
    invitationAmount,
    rates,
    ammPublicFacet,
    await bootstrappedAssets,
    undefined,
    await compareCurrencyBrand
  );
  // const governorTerms = harden({
  //   timer: chainTimerService,
  //   electorateInstance,
  //   governedContractInstallation: installations.VaultFactory,
  //   governed: {
  //     terms: vaultFactoryTerms,
  //     issuerKeywordRecord: {},
  //     privateArgs: harden({ feeMintAccess, initialPoserInvitation }),
  //   },
  // });

  const {
    creatorFacet: lendingPoolCreatorFacet,
    publicFacet: lendingPoolPublicFacet,
    instance: lendingPoolInstance,
  } = await E(zoe).startInstance(
    installations.LendingPool,
    undefined,
    lendingPoolTerms,
    harden({ initialPoserInvitation }),
  );

  // const [vaultFactoryInstance, vaultFactoryCreator] = await Promise.all([
  //   E(governorCreatorFacet).getInstance(),
  //   E(governorCreatorFacet).getCreatorFacet(),
  // ]);
  // const voteCreator = Far('vaultFactory vote creator', {
  //   voteOnParamChange: E(governorCreatorFacet).voteOnParamChange,
  // });
  // produce.vaultFactoryCreator.resolve(vaultFactoryCreator);
  // produce.vaultFactoryGovernorCreator.resolve(governorCreatorFacet);
  // produce.vaultFactoryVoteCreator.resolve(voteCreator);
  // // Advertise the installations, instances in agoricNames.
  // instance.produce.VaultFactory.resolve(vaultFactoryInstance);
  // instance.produce.Treasury.resolve(vaultFactoryInstance);
  // instance.produce.VaultFactoryGovernor.resolve(governorInstance);
  // entries(installations).forEach(([name, install]) =>
  //   installation.produce[name].resolve(install),
  // );
  console.log('PUBLIC_FACET', lendingPoolPublicFacet);
  return harden({
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    lendingPoolInstance
  })

};

/**
 * @param {ERef<ZoeService>} zoe
 * @param {ERef<FeeMintAccess>} feeMintAccess
 * @param {Brand} runBrand
 * @param {bigint} runInitialLiquidity
 */
async function getRunFromFaucet(
  zoe,
  feeMintAccess,
  runBrand,
  runInitialLiquidity,
) {
  const bundle = await bundlePs.faucet;
  // On-chain, there will be pre-existing RUN. The faucet replicates that
  const { creatorFacet: faucetCreator } = await E(zoe).startInstance(
    E(zoe).install(bundle),
    {},
    {},
    harden({ feeMintAccess }),
  );
  const faucetSeat = E(zoe).offer(
    await E(faucetCreator).makeFaucetInvitation(),
    harden({
      give: {},
      want: { RUN: AmountMath.make(runBrand, runInitialLiquidity) },
    }),
    harden({}),
    { feeMintAccess },
  );

  const runPayment = await E(faucetSeat).getPayout('RUN');
  return runPayment;
}

/**
 * NOTE: called separately by each test so AMM/zoe/priceAuthority don't interfere
 *
 * @param {LoanTiming} loanTiming
 * @param {unknown} priceList
 * @param {Amount} unitAmountIn
 * @param {Brand} aethBrand
 * @param {unknown} electorateTerms
 * @param {TimerService} timer
 * @param {unknown} quoteInterval
 * @param {unknown} aethLiquidity
 * @param {bigint} runInitialLiquidity
 * @param {Issuer} aethIssuer
 * @param {[]} bootstrappedAssets
 * @param {Brand} compareCurrencyBrand
 */
async function setupServices(
  loanTiming,
  priceList,
  unitAmountIn,
  aethBrand,
  electorateTerms,
  timer = buildManualTimer(console.log),
  quoteInterval,
  aethLiquidity,
  runInitialLiquidity,
  aethIssuer,
  bootstrappedAssets,
  compareCurrencyBrand
) {
  const { zoe, feeMintAccess } = await setUpZoeForTest();
  const runIssuer = await E(zoe).getFeeIssuer();
  const runBrand = await E(runIssuer).getBrand();
  const runPayment = await getRunFromFaucet(
    zoe,
    feeMintAccess,
    runBrand,
    runInitialLiquidity,
  );

  const runLiquidity = {
    proposal: harden(AmountMath.make(runBrand, runInitialLiquidity)),
    payment: runPayment,
  };

  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    timer,
    zoe,
    aethLiquidity,
    runLiquidity,
    runIssuer,
    aethIssuer,
    electorateTerms,
  );
  const { consume, produce } = space;

  const quoteMint = makeIssuerKit('quote', AssetKind.SET).mint;
  // const priceAuthority = makeScriptedPriceAuthority({
  //   actualBrandIn: aethBrand,
  //   actualBrandOut: runBrand,
  //   priceList,
  //   timer,
  //   quoteMint,
  //   unitAmountIn,
  //   quoteInterval,
  // });
  // produce.priceAuthority.resolve(priceAuthority);
  const priceManager = makePriceManager({});
  produce.priceManager.resolve(priceManager);
  // produce.feeMintAccess.resolve(feeMintAccess);
  const vaultBundles = await Collect.allValues({
    LendingPool: bundlePs.LendingPool,
    liquidate: bundlePs.liquidate,
  });
  produce.vaultBundles.resolve(vaultBundles);
  produce.bootstrappedAssets.resolve({});
  produce.compareCurrencyBrand.resolve(compareCurrencyBrand);
  const {
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    lendingPoolInstance,
  } = await startLendingPool(space, { loanParams: loanTiming });
  // const agoricNames = consume.agoricNames;
  // const installs = await Collect.allValues({
  //   vaultFactory: E(agoricNames).lookup('installation', 'VaultFactory'),
  //   liquidate: E(agoricNames).lookup('installation', 'liquidate'),
  // });
  //
  // const governorCreatorFacet = consume.vaultFactoryGovernorCreator;
  // /** @type {Promise<VaultFactory & LimitedCreatorFacet>} */
  // const vaultFactoryCreatorFacet = /** @type { any } */ (
  //   E(governorCreatorFacet).getCreatorFacet()
  // );
  // /** @type {[any, VaultFactory, VaultFactoryPublicFacet]} */
  // const [governorInstance, vaultFactory, lender] = await Promise.all([
  //   E(agoricNames).lookup('instance', 'VaultFactoryGovernor'),
  //   vaultFactoryCreatorFacet,
  //   E(governorCreatorFacet).getPublicFacet(),
  // ]);
  //
  // const { g, v } = {
  //   g: {
  //     governorInstance,
  //     governorPublicFacet: E(zoe).getPublicFacet(governorInstance),
  //     governorCreatorFacet,
  //   },
  //   v: {
  //     vaultFactory,
  //     lender,
  //   },
  // };

  return {
    zoe,
    // installs,
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    lendingPoolInstance,
    ammFacets,
    runKit: { issuer: runIssuer, brand: runBrand },
    quoteMint,
    timer,
    priceManager
  };
}
// #endregion

test('dummy', t => {
  t.is('dummy', 'dummy');
})


test('initial', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    panKit: {mint: panMint, issuer: panIssuer, brand: panBrand},
    sowKit: {mint: sowMint, issuer: sowIssuer, brand: sowBrand},
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

  const bootstrappedAssets = [vanBrand, panBrand, sowBrand];

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet } = await setupServices(
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
    bootstrappedAssets
  );

  t.is(await  E(await E(lendingPoolCreatorFacet).getLimitedCreatorFacet()).helloFromCreator(), 'Hello From the creator');
  t.is(await E(lendingPoolPublicFacet).helloWorld(), 'Hello World');
});

test('add-pool', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
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

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet } = await setupServices(
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
    bootstrappedAssets
  );

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  const rates = makeRates(vanBrand, usdBrand);
  const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates, undefined);

  t.is(await E(lendingPoolPublicFacet).hasPool(vanBrand), true);
  await t.throwsAsync(E(lendingPoolPublicFacet).hasKeyword('AgVAN'));
  t.deepEqual(await E(lendingPoolPublicFacet).getPool(vanBrand), pm);
});

test('deposit', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
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

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet, zoe, quoteMint, timer } = await setupServices(
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
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: 10n
  });

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  const rates = makeRates(vanBrand, usdBrand);
  const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates, vanUsdPriceAuthority);
  const protocolBrand = await E(pm).getProtocolBrand();
  const protocolIssuer = await E(pm).getProtocolIssuer();
  console.log('[BRAND]:', protocolBrand);
  console.log('[ISSUER]:', protocolIssuer);
  const underlyingAmountIn = AmountMath.make(vanBrand, 111111111n);
  const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: vanMint.mintPayment(underlyingAmountIn),
  });

  const invitation = await E(pm).makeDepositInvitation();
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


  t.is(await E(pm).getProtocolLiquidity(), 5555555550n);
  t.is(await E(pm).getUnderlyingLiquidity(), 111111111n);
  t.is(message, "Finished");
});

test('deposit - false protocolAmountOut', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
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

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet, zoe } = await setupServices(
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
    bootstrappedAssets
  );

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  const rates = makeRates(vanBrand, usdBrand);
  const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates);
  const protocolBrand = await E(pm).getProtocolBrand();
  const protocolIssuer = await E(pm).getProtocolIssuer();
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

  const invitation = await E(pm).makeDepositInvitation();
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
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();
  const secondsPerDay = SECONDS_PER_YEAR / 365n;
  const loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 5n,
    priceCheckPeriod: secondsPerDay * 5n * 2n
  };
  // charge interest on every tick
  // const manualTimer = buildManualTimer(console.log, 0n, secondsPerDay * 7n);

  const vanInitialLiquidity = AmountMath.make(vanBrand, 300n);
  const vanLiquidity = {
    proposal: vanInitialLiquidity,
    payment: vanMint.mintPayment(vanInitialLiquidity),
  };

  const bootstrappedAssets = [vanBrand];

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet, zoe, timer, quoteMint } = await setupServices(
    loanTiming,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    vanBrand,
    { committeeName: 'TheCabal', committeeSize: 5 },
    buildManualTimer(console.log, 0n, secondsPerDay * 5n),
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
    priceList: [105n, 103n, 101n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 5n
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [500n, 490n, 470n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 5n,
  });

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  const addVanPool = async () => {
    const rates = makeRates(vanBrand, usdBrand);
    const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates, vanUsdPriceAuthority);
    const protocolBrand = await E(pm).getProtocolBrand();
    const protocolIssuer = await E(pm).getProtocolIssuer();
    console.log('[BRAND]:', protocolBrand);
    console.log('[ISSUER]:', protocolIssuer);
    const underlyingAmountIn = AmountMath.make(vanBrand, 111111111n);
    const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
    const proposal = harden({
      give: { Underlying: underlyingAmountIn },
      want: { Protocol: protocolAmountOut },
    });

    const paymentKeywordRecord = harden({
      Underlying: vanMint.mintPayment(underlyingAmountIn),
    });

    const invitation = await E(pm).makeDepositInvitation();
    const seat = await E(zoe).offer(
      invitation,
      proposal,
      paymentKeywordRecord
    );

    const {
      Protocol: protocolReceived
    } = await E(seat).getPayouts();
    const protocolReceivedAmount = await E(protocolIssuer).getAmountOf(protocolReceived);
    t.truthy(
      AmountMath.isEqual(
        protocolReceivedAmount,
        AmountMath.make(protocolBrand, 5555555550n),
      ),
    );


    t.is(await E(pm).getProtocolLiquidity(), 5555555550n);
    t.is(await E(pm).getUnderlyingLiquidity(), 111111111n);
    // t.deepEqual(await E(pm).getPriceAuthorityForBrand(vanBrand), vanUsdPriceAuthority);

    return { pm, protocolReceived };
  }

  const addPanPool = async () => {
    const rates = makeRates(panBrand, usdBrand);
    const pm = await E(lendingPool).addPoolType(panIssuer, 'PAN', rates, panUsdPriceAuthority);
    const protocolBrand = await E(pm).getProtocolBrand();
    const protocolIssuer = await E(pm).getProtocolIssuer();
    console.log('[BRAND]:', protocolBrand);
    console.log('[ISSUER]:', protocolIssuer);
    const underlyingAmountIn = AmountMath.make(panBrand, 211111111n);
    const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
    const proposal = harden({
      give: { Underlying: underlyingAmountIn },
      want: { Protocol: protocolAmountOut },
    });

    const paymentKeywordRecord = harden({
      Underlying: panMint.mintPayment(underlyingAmountIn),
    });

    const invitation = await E(pm).makeDepositInvitation();
    const seat = await E(zoe).offer(
      invitation,
      proposal,
      paymentKeywordRecord
    );

    const {
      Protocol: protocolReceived
    } = await E(seat).getPayouts();
    t.truthy(
      AmountMath.isEqual(
        await E(protocolIssuer).getAmountOf(protocolReceived),
        AmountMath.make(protocolBrand, 10555555550n),
      ),
    );


    t.is(await E(pm).getProtocolLiquidity(), 10555555550n);
    t.is(await E(pm).getUnderlyingLiquidity(), 211111111n);
    t.deepEqual((await E(pm).getPriceAuthorityForBrand(panBrand)).priceAuthority, panUsdPriceAuthority);
    t.deepEqual((await E(pm).getPriceAuthorityForBrand(vanBrand)).priceAuthority, vanUsdPriceAuthority);

    return { pm, protocolReceived };
  };

  const vanPoolMan = await addVanPool();
  const panPoolMan = await addPanPool();

  await t.notThrowsAsync(E(panPoolMan.pm).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 15555555n)));
  await t.throwsAsync(E(panPoolMan.pm).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 211111112n)));

  // build the proppsal
  const vanPoolProtocolIssuer = await E(vanPoolMan.pm).getProtocolIssuer();

  const debtProposal = {
    give: { Collateral: await E(vanPoolProtocolIssuer).getAmountOf(vanPoolMan.protocolReceived) },
    want: { Debt: AmountMath.make(panBrand, 15555554n) }
  };

  const debtPaymentKeywordRecord = {
    Collateral: await vanPoolMan.protocolReceived
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

  await timer.tick();
  await timer.tick();
  const vaultCurrentDebt = await E(vault).getCurrentDebt();

  t.notDeepEqual(vaultCurrentDebt, AmountMath.make(panBrand, 15555554n));
});

test('borrow-rate-fluctuate', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();
  const secondsPerDay = SECONDS_PER_YEAR / 365n;
  const loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n
  };
  // charge interest on every tick
  // const manualTimer = buildManualTimer(console.log, 0n, secondsPerDay * 7n);

  const vanInitialLiquidity = AmountMath.make(vanBrand, 300n);
  const vanLiquidity = {
    proposal: vanInitialLiquidity,
    payment: vanMint.mintPayment(vanInitialLiquidity),
  };

  const bootstrappedAssets = [vanBrand];

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet, zoe, timer, quoteMint } = await setupServices(
    loanTiming,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    vanBrand,
    { committeeName: 'TheCabal', committeeSize: 5 },
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
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
    priceList: [105n, 103n, 101n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [500n, 490n, 470n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  const addVanPool = async () => {
    const rates = makeRates(vanBrand, usdBrand);
    const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates, vanUsdPriceAuthority);
    const protocolBrand = await E(pm).getProtocolBrand();
    const protocolIssuer = await E(pm).getProtocolIssuer();
    console.log('[BRAND]:', protocolBrand);
    console.log('[ISSUER]:', protocolIssuer);
    const displayInfo = vanBrand.getDisplayInfo();
    const decimalPlaces = displayInfo?.decimalPlaces || 0n;
    const underlyingAmountIn = AmountMath.make(vanBrand, 4n * 10n ** Nat(decimalPlaces));
    const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
    const proposal = harden({
      give: { Underlying: underlyingAmountIn },
      want: { Protocol: protocolAmountOut },
    });

    const paymentKeywordRecord = harden({
      Underlying: vanMint.mintPayment(underlyingAmountIn),
    });

    const invitation = await E(pm).makeDepositInvitation();
    const seat = await E(zoe).offer(
      invitation,
      proposal,
      paymentKeywordRecord
    );

    const {
      Protocol: protocolReceived
    } = await E(seat).getPayouts();
    const protocolReceivedAmount = await E(protocolIssuer).getAmountOf(protocolReceived);
    t.truthy(
      AmountMath.isEqual(
        protocolReceivedAmount,
        AmountMath.make(protocolBrand, 20000000000n),
      ),
    );


    t.is(await E(pm).getProtocolLiquidity(), 20000000000n);
    t.is(await E(pm).getUnderlyingLiquidity(), 4n * 10n ** Nat(decimalPlaces));
    // t.deepEqual(await E(pm).getPriceAuthorityForBrand(vanBrand), vanUsdPriceAuthority);

    return { pm, protocolReceived };
  }

  const addPanPool = async () => {
    const rates = makeRates(panBrand, usdBrand);
    const pm = await E(lendingPool).addPoolType(panIssuer, 'PAN', rates, panUsdPriceAuthority);
    const protocolBrand = await E(pm).getProtocolBrand();
    const protocolIssuer = await E(pm).getProtocolIssuer();
    console.log('[BRAND]:', protocolBrand);
    console.log('[ISSUER]:', protocolIssuer);
    const displayInfo = vanBrand.getDisplayInfo();
    const decimalPlaces = displayInfo?.decimalPlaces || 0n;
    const underlyingAmountIn = AmountMath.make(panBrand, 4n * 10n ** Nat(decimalPlaces));
    const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
    const proposal = harden({
      give: { Underlying: underlyingAmountIn },
      want: { Protocol: protocolAmountOut },
    });

    const paymentKeywordRecord = harden({
      Underlying: panMint.mintPayment(underlyingAmountIn),
    });

    const invitation = await E(pm).makeDepositInvitation();
    const seat = await E(zoe).offer(
      invitation,
      proposal,
      paymentKeywordRecord
    );

    const {
      Protocol: protocolReceived
    } = await E(seat).getPayouts();
    t.truthy(
      AmountMath.isEqual(
        await E(protocolIssuer).getAmountOf(protocolReceived),
        AmountMath.make(protocolBrand, 20000000000n),
      ),
    );


    t.is(await E(pm).getProtocolLiquidity(), 20000000000n);
    t.is(await E(pm).getUnderlyingLiquidity(), 4n * 10n ** Nat(decimalPlaces));
    t.deepEqual((await E(pm).getPriceAuthorityForBrand(panBrand)).priceAuthority, panUsdPriceAuthority);
    t.deepEqual((await E(pm).getPriceAuthorityForBrand(vanBrand)).priceAuthority, vanUsdPriceAuthority);

    return { pm, protocolReceived };
  };

  const vanPoolMan = await addVanPool();
  const panPoolMan = await addPanPool();

  await t.notThrowsAsync(E(panPoolMan.pm).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 399999999n)));
  await t.throwsAsync(E(panPoolMan.pm).enoughLiquidityForProposedDebt(AmountMath.make(panBrand, 400000001n)));

  // build the proppsal
  const vanPoolProtocolIssuer = await E(vanPoolMan.pm).getProtocolIssuer();

  let debtProposal = {
    give: { Collateral: await E(vanPoolProtocolIssuer).getAmountOf(vanPoolMan.protocolReceived) },
    want: { Debt: AmountMath.make(panBrand, 4000000n) }
  };

  let debtPaymentKeywordRecord = {
    Collateral: await vanPoolMan.protocolReceived
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

  t.deepEqual(vaultCurrentDebt4B, AmountMath.make(panBrand, 4000000n));
  t.deepEqual(await E(panPoolMan.pm).getCurrentBorrowingRate(), makeRatio(270n, panBrand, BASIS_POINTS));

  const collateral = await depositMoney(zoe, vanPoolMan.pm, vanMint,4n);

  debtProposal = {
    give: { Collateral: collateral.amount },
    want: { Debt: AmountMath.make(panBrand, 1000000n) }
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

  t.deepEqual(vaultCurrentDebt1B, AmountMath.make(panBrand, 1000000n));
  t.deepEqual(await E(panPoolMan.pm).getCurrentBorrowingRate(), makeRatio(275n, panBrand, BASIS_POINTS));

  await timer.tick();
  await waitForPromisesToSettle();
  t.deepEqual(await E(panPoolMan.pm).getTotalDebt(), AmountMath.make(panBrand, 5000000n + 372n * 7n))
  t.deepEqual(await E(panPoolMan.pm).getCurrentBorrowingRate(), makeRatio(276n, panBrand, BASIS_POINTS));
  t.deepEqual((await E(panPoolMan.pm).getExchangeRate()).numerator, AmountMath.make(panBrand, 201n));
});

/**
 * Here we first get a loan for Alice then update the loan by putting more
 * collateral and receiving more debt. No interest is accrued during this
 * process.
 */
test('adjust-balances-no-interest', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();
  const secondsPerDay = SECONDS_PER_YEAR / 365n;
  const loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n
  };

  const vanInitialLiquidity = AmountMath.make(vanBrand, 300n);
  const vanLiquidity = {
    proposal: vanInitialLiquidity,
    payment: vanMint.mintPayment(vanInitialLiquidity),
  };

  const bootstrappedAssets = [vanBrand];

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet, zoe, timer, quoteMint } = await setupServices(
    loanTiming,
    [500n, 15n],
    AmountMath.make(vanBrand, 900n),
    vanBrand,
    { committeeName: 'TheCabal', committeeSize: 5 },
    buildManualTimer(console.log, 0n, secondsPerDay * 7n),
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
    priceList: [110n, 110n, 101n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: secondsPerDay * 7n
  });

  const panUsdPriceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n, 200n, 470n],
    timer,
    quoteMint,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  // Make the rates for the pools
  const vanPoolRates = makeRates(vanBrand, usdBrand);
  const panPoolRates = makeRates(panBrand, usdBrand);

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanPoolRates, lendingPool, vanMint, "VAN", vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panPoolRates, lendingPool, panMint, "PAN", panUsdPriceAuthority);

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




