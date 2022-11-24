import '@agoric/zoe/tools/prepare-test-env.js';
import test from 'ava';
import { setUpZoeForTest } from '@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { objectMap } from '@agoric/internal';
import { E, Far } from '@endo/far';
import { deeplyFulfilled } from '@endo/marshal';
import { getPath } from '../lendingPool/setup.js';
import { AmountMath, makeIssuerKit, AssetKind } from '@agoric/ertp';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import { makeApiInvocationPositions, setupApiGovernance } from '@agoric/governance/src/contractGovernance/governApi.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { ChoiceMethod, coerceQuestionSpec, ElectionType, QuorumRule } from '@agoric/governance';
import { TimeMath } from '@agoric/swingset-vat/src/vats/timer/timeMath.js';
import { CONTRACT_ELECTORATE } from '@agoric/governance';
import { makeMockChainStorageRoot } from '@agoric/vats/tools/storage-test-utils.js';
import { makeStorageNodeChild } from '@agoric/vats/src/lib-chainStorage.js';
import { makeBoard } from '@agoric/vats/src/lib-board.js';
import { ceilMultiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeGovernanceScenarioHeplpers } from './governanceScenarioHelpers.js';
import { makeGovernanceAssertionHelpers } from './governanceAssertions.js';

// Paths are given according to ../lendingPool/setup.js
const CONTRACT_ROOTS = {
  lendingPoolElectorate: '../../src/governance/lendingPoolElectorate.js',
  lendingPoolElectionManager: '../../src/governance/lendingPoolElectionManager.js',
  dummyGovenedContract: '../governance/dummyGovernedContract.js',
  counter: '@agoric/governance/src/binaryVoteCounter.js',
};


const setupServices = async (t) => {
  const {
    farZoeKit: { /** @type ZoeService */ zoe },
    installations,
    timer
  } = t.context;

  const installs = await Collect.allValues({
    lendingPoolElectorate: installations.lendingPoolElectorate,
    lendingPoolElectionManager: installations.lendingPoolElectionManager,
    dummyGovenedContract: installations.dummyGovenedContract,
    counter: installations.counter,
  });

  const STORAGE_PATH = 'ElectionManager';
  const chainStorage = makeMockChainStorageRoot();
  const storageNode = await makeStorageNodeChild(chainStorage, STORAGE_PATH);
  const marshaller = await E(makeBoard()).getReadonlyMarshaller();

  const {
    creatorFacet: electorateCreatorFacet,
    publicFacet: electoratePublicFacet,
  } = await E(zoe).startInstance(installs.lendingPoolElectorate, {}, {});

  const {
    creatorFacet: electionManagerCreatorFacet,
    publicFacet: electionManagerPublicFacet,
  } = await E(zoe).startInstance(
    installs.lendingPoolElectionManager,
    harden({}),
    harden({
      timer,
      governedContractInstallation: installs.dummyGovenedContract,
      governed: {
        issuerKeywordRecord: {},
        terms: { governedParams: { [CONTRACT_ELECTORATE]: true } },
      },
    }),
    {
      governed: {
        initialPoserInvitation: E(electorateCreatorFacet).getElectorateFacetInvitation(),
        storageNode,
        marshaller
      },
    });

  const [governedPF, governedCF] = await Promise.all([
    E(electionManagerCreatorFacet).getPublicFacet(),
    E(electionManagerCreatorFacet).getCreatorFacet(),
  ])

  return {
    zoe,
    timer,
    electionManager: {
      electionManagerCreatorFacet,
      electionManagerPublicFacet,
    },
    electorate: {
      electorateCreatorFacet,
      electoratePublicFacet,
    },
    governed: {
      governedPF,
      governedCF,
    },
    installs,
  };
};

test.before(async t => {
  const farZoeKit = setUpZoeForTest();

  const bundleCache = await unsafeMakeBundleCache('./bundles/'); // package-relative

  const paths = await Promise.all([
    getPath(CONTRACT_ROOTS.lendingPoolElectorate),
    getPath(CONTRACT_ROOTS.lendingPoolElectionManager),
    getPath(CONTRACT_ROOTS.dummyGovenedContract),
    getPath(CONTRACT_ROOTS.counter),
  ])
  // note that the liquidation might be a different bundle name
  const bundles = await Collect.allValues({
    lendingPoolElectorate: bundleCache.load(paths[0], 'lendingPoolElectorate'),
    lendingPoolElectionManager: bundleCache.load(paths[1], 'lendingPoolElectionManager'),
    dummyGovenedContract: bundleCache.load(paths[2], 'dummyElectionManager'),
    counter: bundleCache.load(paths[3], 'binaryVoteCounter'),
  });
  const installations = objectMap(bundles, bundle => E(farZoeKit.zoe).install(bundle));

  const contextPs = {
    farZoeKit,
    bundles,
    installations,
    timer: buildManualTimer(t.log)
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = {
    ...frozenCtx,
    bundleCache,
  };
  // trace(t, 'CONTEXT');
});

test('initial', async t => {
  const services = await setupServices(t);
  t.log(services);
  t.is('test', 'test');
});

test('addQuestion', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerCreatorFacet, electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs
  } = await setupServices(t);

  const [govBrand, govIssuer, govKeyword, { popBrand, popIssuer }] = await Promise.all([
    E(governedPF).getGovernanceBrand(),
    E(governedPF).getGovernanceIssuer(),
    E(governedPF).getGovernanceKeyword(),
    E(electionManagerPublicFacet).getPopInfo(),
  ]);

  const govAmountWanted = AmountMath.make(govBrand, 5n * 10n ** 6n);

  /**
   * @type {UserSeat}
   */
  const aliceUserSeat = await E(zoe).offer(
    E(governedPF).makeFaucetInvitation(),
    harden({ want: { [govKeyword]: govAmountWanted } }),
  );

  const [offerResult, govPayout, propTreshold] = await Promise.all([
    E(aliceUserSeat).getOfferResult(),
    E(aliceUserSeat).getPayout(govKeyword),
    E(governedPF).getProposalTreshold(),
  ]);

  const govAmountReceived = await E(govIssuer).getAmountOf(govPayout);
  t.deepEqual(offerResult, 'Sucess! Check your payouts.')
  t.deepEqual(govAmountReceived, govAmountWanted);
  t.deepEqual(propTreshold, ceilMultiplyBy(
    govAmountReceived,
    makeRatio(2n, govBrand)
  ));

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 10n),
    vote: true,
  });

  const propsal = harden({
    give: { [govKeyword]: govAmountReceived },
    want: { POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) }
  });

  const payment = harden({
    [govKeyword]: govPayout,
  });

  const aliceQuestionsSeat = await E(zoe).offer(
    E(electionManagerPublicFacet).makePoseQuestionsInvitation(),
    propsal,
    payment,
    offerArgs
  );

  const questionOfferResult = await E(aliceQuestionsSeat).getOfferResult();
  const popPayoutP = E(aliceQuestionsSeat).getPayout('POP');

  const [openQuestions, popAmountReceived] = await Promise.all([
    E(electoratePublicFacet).getOpenQuestions(),
    E(popIssuer).getAmountOf(popPayoutP),
  ]);

  const { value: [{ questionHandle } ] } = popAmountReceived;
  const questionFromElectorateP = E(electoratePublicFacet).getQuestion(openQuestions[0]);
  const voteCounterFromElectorate = await E(questionFromElectorateP).getVoteCounter();
  const { instance } = await E(electionManagerPublicFacet).getQuestionData(questionHandle);

  t.log(popAmountReceived);

  t.deepEqual(questionOfferResult,
    'The questison has been successfuly asked. Please redeem your tokens after the voting is ended.');
  t.truthy(openQuestions.length === 1);
  t.deepEqual(openQuestions[0], questionHandle);
  t.deepEqual(voteCounterFromElectorate, instance);

});

test('addQuestion-lower-than-treshold', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerCreatorFacet, electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs
  } = await setupServices(t);

  const [govBrand, govIssuer, govKeyword, { popBrand, popIssuer }] = await Promise.all([
    E(governedPF).getGovernanceBrand(),
    E(governedPF).getGovernanceIssuer(),
    E(governedPF).getGovernanceKeyword(),
    E(electionManagerPublicFacet).getPopInfo(),
  ]);

  const govAmountWanted = AmountMath.make(govBrand, 5n * 10n ** 6n);

  /**
   * @type {UserSeat}
   */
  const aliceUserSeat = await E(zoe).offer(
    E(governedPF).makeFaucetInvitation(),
    harden({ want: { [govKeyword]: govAmountWanted } }),
  );

  const [offerResult, govPayout, propTreshold] = await Promise.all([
    E(aliceUserSeat).getOfferResult(),
    E(aliceUserSeat).getPayout(govKeyword),
    E(governedPF).getProposalTreshold(),
  ]);

  const govAmountReceived = await E(govIssuer).getAmountOf(govPayout);
  t.deepEqual(offerResult, 'Sucess! Check your payouts.')
  t.deepEqual(govAmountReceived, govAmountWanted);
  t.deepEqual(propTreshold, ceilMultiplyBy(
    govAmountReceived,
    makeRatio(2n, govBrand)
  ));

  const lockAmount = ceilMultiplyBy(govAmountReceived, makeRatio(1n, govBrand));
  const [lockPayment] = await E(govIssuer).split(govPayout, lockAmount);

  const proposal = harden({
    give: { [govKeyword]: lockAmount },
    want: { POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) },
  });

  const payment = harden({
    [govKeyword]: lockPayment,
  });

  /**
   * @type {UserSeat}
   */
  const aliceBadQuestionSeat = await E(zoe).offer(
    E(electionManagerPublicFacet).makePoseQuestionsInvitation(),
    proposal,
    payment,
    harden({}),
  );

  await t.throwsAsync(async () => E(aliceBadQuestionSeat).getOfferResult());
});

test('voteOnQuestion', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerCreatorFacet, electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = await fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n});

  const bobGovSeat = await fetchGovFromFaucet({ unitsWanted: 1n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 1n });

  const maggieGovSeat = await fetchGovFromFaucet({ unitsWanted: 2n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 2n })

  const peterGovSeat = await fetchGovFromFaucet({ unitsWanted: 15n, decimals: 5n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 15n, decimals: 5n })

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  // Alice adds a new question
  const aliceQuestionSeat = await addQuestion(aliceGovPayout, offerArgs);
  const aliceQuestionHandle = await checkQuestionAskedCorrectly(aliceQuestionSeat);

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = await voteOnQuestion(bobGovPayout, positive, aliceQuestionHandle);
  await checkVotedSuccessfully(bobVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 1n });

  // Maggie votes `Against`
  const maggieVoteSeat = await voteOnQuestion(maggieGovPayout, negative, aliceQuestionHandle);
  await checkVotedSuccessfully(maggieVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 2n });

  // Petet votes `For`
  const peterVoteSeat = await voteOnQuestion(peterGovPayout, positive, aliceQuestionHandle);
  await checkVotedSuccessfully(peterVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 15n, decimals: 5n });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: positive,
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat],
    executionOutcome: {
      resultPromise: E(governedPF).getTestPromise(),
      expectedResolveValue: 'Hello Alice!!!'
    },
  });

});