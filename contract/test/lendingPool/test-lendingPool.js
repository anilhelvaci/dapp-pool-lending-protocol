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
  ceilMultiplyBy,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makePromiseKit } from '@endo/promise-kit';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';
import { makeGovernedTerms } from '../../src/lendingPool/params.js';
import { assertAmountsEqual } from '@agoric/zoe/test/zoeTestHelpers.js';
import { makeParamManagerBuilder } from '@agoric/governance';

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

async function makeBundle(sourceRoot) {
  const url = await importMetaResolve(sourceRoot, import.meta.url);
  const path = new URL(url).pathname;
  const contractBundle = await bundleSource(path);
  trace('makeBundle', sourceRoot);
  return contractBundle;
}

// makeBundle is a slow step, so we do it once for all the tests.
const bundlePs = {
  faucet: makeBundle(contractRoots.faucet),
  liquidate: makeBundle(contractRoots.liquidate),
  LendingPool: makeBundle(contractRoots.LendingPool),
};

function setupAssets() {
  // setup collateral assets
  const vanKit = makeIssuerKit('VAN');
  const sowKit = makeIssuerKit('SOW');
  const panKit = makeIssuerKit('PAN');

  return harden({
    vanKit,
    sowKit,
    panKit
  });
}

// Some notifier updates aren't propagating sufficiently quickly for the tests.
// This invocation (thanks to Warner) waits for all promises that can fire to
// have all their callbacks run
async function waitForPromisesToSettle() {
  const pk = makePromiseKit();
  setImmediate(pk.resolve);
  return pk.promise;
}

function makeRates(runBrand) {
  return harden({
    // margin required to maintain a loan
    liquidationMargin: makeRatio(105n, runBrand),
    // periodic interest rate (per charging period)
    interestRate: makeRatio(100n, runBrand, BASIS_POINTS),
    // charge to create or increase loan balance
    loanFee: makeRatio(500n, runBrand, BASIS_POINTS),
  });
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
      priceAuthority,
      zoe,
      feeMintAccess: feeMintAccessP, // ISSUE: why doeszn't Zoe await this?
      economicCommitteeCreatorFacet: electorateCreatorFacet,
      bootstrappedAssets
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
  const feeMintAccess = await feeMintAccessP;

  const lendingPoolTerms = makeGovernedTerms(
    priceAuthority,
    loanParams,
    installations.liquidate,
    chainTimerService,
    invitationAmount,
    rates,
    ammPublicFacet,
    await bootstrappedAssets
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
    harden({ feeMintAccess, initialPoserInvitation }),
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
  bootstrappedAssets
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
  const priceAuthority = makeScriptedPriceAuthority({
    actualBrandIn: aethBrand,
    actualBrandOut: runBrand,
    priceList,
    timer,
    quoteMint,
    unitAmountIn,
    quoteInterval,
  });
  produce.priceAuthority.resolve(priceAuthority);

  produce.feeMintAccess.resolve(feeMintAccess);
  const vaultBundles = await Collect.allValues({
    LendingPool: bundlePs.LendingPool,
    liquidate: bundlePs.liquidate,
  });
  produce.vaultBundles.resolve(vaultBundles);
  produce.bootstrappedAssets.resolve(bootstrappedAssets);
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
    priceAuthority,
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
  t.deepEqual(await E(lendingPoolPublicFacet).getProtocolTokenList(), ['AgVAN', 'AgPAN', 'AgSOW']);
});

test('add-pool', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
  } = setupAssets();
  const loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
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

  const rates = makeRates(vanBrand);
  const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates);

  t.is(await E(lendingPoolPublicFacet).hasPool(vanBrand), true);
  await t.throwsAsync(E(lendingPoolPublicFacet).hasKeyword('AgVAN'));
  t.deepEqual(await E(lendingPoolPublicFacet).getPool(vanBrand), pm);
});

test('deposit', async t => {
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
  } = setupAssets();
  const loanTiming = {
    chargingPeriod: 2n,
    recordingPeriod: 10n,
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

  const rates = makeRates(vanBrand);
  const pm = await E(lendingPool).addPoolType(vanIssuer, 'VAN', rates);
  const protocolBrand = await E(pm).getProtocolBrand();
  const protocolIssuer = await E(pm).getProtocolIssuer();
  console.log('[BRAND]:', protocolBrand);
  console.log('[ISSUER]:', protocolIssuer);
  const proposal = harden({
    give: { Underlying: AmountMath.make(vanBrand, 50n) },
    want: { Protocol: AmountMath.make(protocolBrand, 50n) },
  });

  const paymentKeywordRecord = harden({
    Underlying: vanMint.mintPayment(AmountMath.make(vanBrand, 50n)),
  });

  const invitation = await E(pm).makeDepositInvitation();
  const seat = await E(zoe).offer(
    invitation,
    proposal,
    paymentKeywordRecord
  );

  const protocolTokenReceived = await E(seat).getPayouts();
  const protocolReceived = protocolTokenReceived.Protocol;
  t.truthy(
    AmountMath.isEqual(
      await E(protocolIssuer).getAmountOf(protocolReceived),
      AmountMath.make(protocolBrand, 50n),
    ),
  );


  t.is(await E(pm).getProtocolLiquidity(), 50n);
  t.is(await E(pm).getUnderlyingLiquidity(), 50n);
});