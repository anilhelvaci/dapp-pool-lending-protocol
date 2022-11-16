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
    govKit: { govBrand, govIssuer, govMint },
    timer,
    counterInstallation,
  } = await setupServices(t);

  const treshold = AmountMath.make(govBrand, 25000n);
  await E(electorateCreatorFacet).initGovernedContext('GOV', govBrand, govIssuer, treshold);

  const apiMethodName = 'hello';
  const methodArgs = ['Hello World!'];
  const deadline = TimeMath.addAbsRel(timer.getCurrentTimestamp(), 10n)

  const { positive, negative } = makeApiInvocationPositions(
    apiMethodName,
    methodArgs,
  );

  /** @type {ApiInvocationIssue} */
  const issue = harden({ apiMethodName, methodArgs });
  /** @type QuestionSpec */
  const questionSpec = coerceQuestionSpec({
    method: ChoiceMethod.UNRANKED,
    issue,
    positions: [positive, negative],
    electionType: ElectionType.API_INVOCATION,
    maxChoices: 1,
    closingRule: { timer, deadline },
    quorumRule: QuorumRule.MAJORITY,
    tieOutcome: negative,
  });

  // More than the treshold
  const poserGovAmount = AmountMath.make(govBrand, 25100n);

  /** @type UserSeat */
  const userSeatP = E(zoe).offer(
    E(electorateCreatorFacet).makeAddQuestionInvitation(),
    harden({ give: { GOV: poserGovAmount } }),
    harden({ GOV: govMint.mintPayment(poserGovAmount) }),
    { counterInstallation, questionSpec }
  );

  const { publicFacet: voteCounterPublicFacet, instance: voteCounterInstance } = await E(userSeatP).getOfferResult();

  const questionP = E(voteCounterPublicFacet).getQuestion();

  const [openQuestions, questionsDetails, questionCounterInstance] = await Promise.all([
    E(electoratePublicFacet).getOpenQuestions(),
    E(questionP).getDetails(),
    E(questionP).getVoteCounter(),
  ]);

  t.is(openQuestions.length, 1);
  t.deepEqual(openQuestions[0], questionsDetails.questionHandle);
  t.deepEqual(voteCounterInstance, questionCounterInstance);
});

test('addQuestion-fails-insufficient-token-balance', async t => {
  const {
    zoe,
    electorateCreatorFacet,
    electoratePublicFacet,
    govKit: { govBrand, govIssuer, govMint },
    timer,
    counterInstallation,
  } = await setupServices(t);

  const treshold = AmountMath.make(govBrand, 25000n);
  await E(electorateCreatorFacet).initGovernedContext('GOV', govBrand, govIssuer, treshold);

  const apiMethodName = 'hello';
  const methodArgs = ['Hello World!'];
  const deadline = TimeMath.addAbsRel(timer.getCurrentTimestamp(), 10n)

  const { positive, negative } = makeApiInvocationPositions(
    apiMethodName,
    methodArgs,
  );

  /** @type {ApiInvocationIssue} */
  const issue = harden({ apiMethodName, methodArgs });
  /** @type QuestionSpec */
  const questionSpec = coerceQuestionSpec({
    method: ChoiceMethod.UNRANKED,
    issue,
    positions: [positive, negative],
    electionType: ElectionType.API_INVOCATION,
    maxChoices: 1,
    closingRule: { timer, deadline },
    quorumRule: QuorumRule.MAJORITY,
    tieOutcome: negative,
  });

  // More than the treshold
  const poserGovAmount = AmountMath.make(govBrand, 24900n);

  /** @type UserSeat */
  const userSeatP = E(zoe).offer(
    E(electorateCreatorFacet).makeAddQuestionInvitation(),
    harden({ give: { GOV: poserGovAmount } }),
    harden({ GOV: govMint.mintPayment(poserGovAmount) }),
    { counterInstallation, questionSpec }
  );

  await t.throwsAsync(() => E(userSeatP).getOfferResult());

  const openQuestions = await E(electoratePublicFacet).getOpenQuestions();
  t.is(openQuestions.length, 0);
});