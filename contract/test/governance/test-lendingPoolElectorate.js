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
import { makeApiInvocationPositions, setupApiGovernance } from '@agoric/governance/src/contractGovernance/governApi.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { ChoiceMethod, coerceQuestionSpec, ElectionType, QuorumRule } from '@agoric/governance';
import { TimeMath } from '@agoric/swingset-vat/src/vats/timer/timeMath.js';

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
    issuer: govIssuer,
    mint: govMint,
  } = makeIssuerKit('GOV', AssetKind.NAT);

  const installs = await Collect.allValues({
    lendingPoolElectorate: installations.lendingPoolElectorate,
    dummyElectionManager: installations.dummyElectionManager,
    counter: installations.counter,
  });

  const {
    creatorFacet: electorateCreatorFacet,
    publicFacet: electoratePublicFacet,
  } = await E(zoe).startInstance(installs.lendingPoolElectorate, {}, {});

  const { creatorFacet: electionManagerCreatorFacet, } = await E(zoe).startInstance(
    installs.dummyElectionManager,
    { GOV: govIssuer },
    {},
    { electorateFacetInvitation: E(electorateCreatorFacet).getElectorateFacetInvitation() });

  return harden({
    zoe,
    electorateCreatorFacet,
    electoratePublicFacet,
    electionManagerCreatorFacet,
    govKit: {
      govBrand,
      govIssuer,
      govMint,
    },
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

test('addQuestion-successful', async t => {
  const {
    zoe,
    electorateCreatorFacet,
    electoratePublicFacet,
    timer,
    counterInstallation,
  } = await setupServices(t);

  const electorateFacet = Far('ElectorateFacet - Test', {
    addQuestion: E(electorateCreatorFacet).addQuestion,
    voteOnQuestion: E(electorateCreatorFacet).voteOnQuestion,
    updateTotalSupply: E(electorateCreatorFacet).updateTotalSupply,
  });

  await E(electorateCreatorFacet).updateTotalSupply(1000n);

  const {
    voteOnApiInvocation,
  } = await setupApiGovernance(zoe, undefined,
    { hello: (name) => console.log(`Hello ${name}!`) },
    ['hello'], timer, () => electorateFacet);

  const deadline = TimeMath.addAbsRel(timer.getCurrentTimestamp(), 10n);

  const {
    outcomeOfUpdate,
    instance,
    details
  } = await voteOnApiInvocation('hello', ['Anil'], counterInstallation, deadline);

  const { questionHandle } = await details;
  const openQuestions = await E(electoratePublicFacet).getOpenQuestions();

  t.deepEqual(openQuestions[0], questionHandle);
  t.deepEqual(await E(E(electoratePublicFacet).getQuestion(questionHandle)).getVoteCounter(), instance)

  outcomeOfUpdate.then(result => console.log('[OUTCOME_OF_UPDATE]', result))
    .catch(error => console.log('[OUTCOME_OF_UPDATE]', error));

  const positive = harden({ apiMethodName: 'hello', methodArgs: ['Anil'] });
  const negative = harden({ dontInvoke: 'hello' });
  await E(electorateCreatorFacet).voteOnQuestion(questionHandle, [positive], 501n);

  await timer.tickN(10n);
  await eventLoopIteration();

});