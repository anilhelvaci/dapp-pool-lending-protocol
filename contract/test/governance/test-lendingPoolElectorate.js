import '@agoric/zoe/tools/prepare-test-env.js';
import test from 'ava';
import { setUpZoeForTest } from '@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { objectMap } from '@agoric/internal';
import { E, Far } from '@endo/far';
import { makeRates, setupAssets } from '../lendingPool/helpers.js';
import { deeplyFulfilled } from '@endo/marshal';
import { getPath } from '../lendingPool/setup.js';
import { AmountMath, makeIssuerKit, AssetKind } from '@agoric/ertp';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import { setupApiGovernance } from '@agoric/governance/src/contractGovernance/governApi.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';

// Paths are given according to ../lendingPool/setup.js
const CONTRACT_ROOTS = {
  lendingPoolElectorate: '../../src/governance/lendingPoolElectorate.js',
  dummyElectionManager: '../governance/dummyElectionManager.js',
  counter: '@agoric/governance/src/binaryVoteCounter.js',
};

const setupServices = async (t) => {
  const {
    farZoeKit: { /** @type ZoeService */ zoe },
    installations
  } = t.context;

  const {
    brand: govBrand,
    issuer: govIssuer
  } = makeIssuerKit('GOV', AssetKind.NAT);

  const installs = await Collect.allValues({
    lendingPoolElectorate: installations.lendingPoolElectorate,
    counter: installations.counter,
  });

  const {
    creatorFacet: electorateCreatorFacet,
    publicFacet: electoratePublicFacet,
  } = await E(zoe).startInstance(installs.lendingPoolElectorate, {}, {});

  return harden({
    zoe,
    electorateCreatorFacet,
    electoratePublicFacet,
    govBrand,
    govIssuer,
    timer: buildManualTimer(t.log),
    counterInstallation: installs.counter,
  });

};

test.before(async t => {
  const farZoeKit = setUpZoeForTest();

  const bundleCache = await unsafeMakeBundleCache('./bundles/'); // package-relative

  const paths = await Promise.all([
    getPath(CONTRACT_ROOTS.lendingPoolElectorate),
    getPath(CONTRACT_ROOTS.dummyElectionManager),
    getPath(CONTRACT_ROOTS.counter),
  ])
  // note that the liquidation might be a different bundle name
  const bundles = await Collect.allValues({
    lendingPoolElectorate: bundleCache.load(paths[0], 'lendingPoolElectorate'),
    dummyElectionManager: bundleCache.load(paths[1], 'dummyElectionManager'),
    counter: bundleCache.load(paths[2], 'binaryVoteCounter'),
  });
  const installations = objectMap(bundles, bundle => E(farZoeKit.zoe).install(bundle));

  const contextPs = {
    farZoeKit,
    bundles,
    installations,
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = {
    ...frozenCtx,
    bundleCache,
  };
  // trace(t, 'CONTEXT');
});

test('governedContext-immutable', async t => {
  const { electorateCreatorFacet, electoratePublicFacet } = await setupServices(t);

  const { brand: moolaBrand, issuer: moolaIssuer } = makeIssuerKit('Moola', AssetKind.NAT);
  const { brand: simoleansBrand, issuer: simoleansIssuer } = makeIssuerKit('Simoleans', AssetKind.NAT);

  await t.notThrowsAsync(() =>
    E(electorateCreatorFacet).initGovernedContext('Moola', moolaBrand,
      moolaIssuer, AmountMath.makeEmpty(moolaBrand))
  );

  await t.throwsAsync(
    () => E(electorateCreatorFacet).initGovernedContext('Simoleans', simoleansBrand,
      simoleansIssuer, AmountMath.makeEmpty(simoleansBrand))
  );

  const governedBrand = await E(electoratePublicFacet).getGovernedBrand();
  t.deepEqual(governedBrand, moolaBrand);
});

test('addQuestion-successful', async t => {
  const {
    zoe,
    electorateCreatorFacet,
    electoratePublicFacet,
    govBrand,
    govIssuer,
    timer,
    counterInstallation
  } = await setupServices(t);

  const treshold = AmountMath.make(govBrand, 25000n);
  await E(electorateCreatorFacet).initGovernedContext('GOV', govBrand, govIssuer, treshold);

  const { voteOnApiInvocation } = await setupApiGovernance(
    zoe,
    undefined,
    { 'hello': word => console.log(word) },
    ['hello'],
    timer,
    () => electorateCreatorFacet,
  );

  const {
    outcomeOfUpdate,
    details,
  } = await voteOnApiInvocation('hello', ['Hello World!'], counterInstallation, 10n);

  t.log('Details', details);
  t.log('Outcome', outcomeOfUpdate);

  t.is('is', 'is');
});