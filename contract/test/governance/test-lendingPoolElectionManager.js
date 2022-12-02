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
    timer,
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
        marshaller,
      },
    });

  const [governedPF, governedCF] = await Promise.all([
    E(electionManagerCreatorFacet).getPublicFacet(),
    E(electionManagerCreatorFacet).getCreatorFacet(),
  ]);

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
  ]);
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
    timer: buildManualTimer(t.log),
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

test('simple-add-question', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 }) ;
});

test('add-question-lower-than-treshold', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    splitGovPayout,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  // Alice tries to add a new question
  const [splittedPayment] = await splitGovPayout(aliceGovPayout, { value: 1n, decimals: 4n });
  /** @type UserSeat */
  const aliceQuestionSeatP = addQuestion(splittedPayment, offerArgs);
  await t.throwsAsync(() => E(aliceQuestionSeatP).getOfferResult());
});

test('simple-vote', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
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

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 1n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 1n });

  const maggieGovSeat = fetchGovFromFaucet({ unitsWanted: 2n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 2n });

  const peterGovSeat = fetchGovFromFaucet({ unitsWanted: 15n, decimals: 5n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 15n, decimals: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = voteOnQuestion(bobGovPayout, positive, aliceQuestionHandle);
  await checkVotedSuccessfully(bobVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 1n });

  // Maggie votes `Against`
  const maggieVoteSeat = voteOnQuestion(maggieGovPayout, negative, aliceQuestionHandle);
  await checkVotedSuccessfully(maggieVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 2n });

  // Petet votes `For`
  const peterVoteSeat = voteOnQuestion(peterGovPayout, positive, aliceQuestionHandle);
  await checkVotedSuccessfully(peterVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 15n, decimals: 5n });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: positive,
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat],
    executionOutcome: {
      resultPromise: E(governedPF).getTestPromise(),
      expectedResolveValue: 'Hello Alice!!!',
    },
  });
});

test('try-voting-with-a-token-other-than-gov-token', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  /** @type IssuerKit */
  const bobTokenR = makeIssuerKit('BobToken', AssetKind.NAT);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteWithMaliciousToken,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const bobVoteAmount = AmountMath.make(bobTokenR.brand, 10n * 6n);
  const bobVotePayment = bobTokenR.mint.mintPayment(bobVoteAmount);

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob tries to vote but it should throw
  await t.throwsAsync(() => voteWithMaliciousToken(bobVotePayment, bobVoteAmount, positive, aliceQuestionHandle));
});

test('try-to-vote-after-the-questin-closed', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 1n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 1n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  const { questionHandle: aliceQuestionHandle } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Voting ends, question is closed
  await E(timer).tickN(11n);

  // Bob tries to vote `For`
  /** @type UserSeat */
  const bobVoterSeatP = voteOnQuestion(bobGovPayout, positive, aliceQuestionHandle);
  await t.throwsAsync(() => E(bobVoterSeatP).getOfferResult());
});

test('try-to-redeem-when-question-open', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
    redeem,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 1n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 1n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = await addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = voteOnQuestion(bobGovPayout, positive, aliceQuestionHandle);
  const { popPayment: bobPopPayout } = await checkVotedSuccessfully(bobVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 1n,
  });

  // Bob tries to redeem before the voting ends
  /** @type UserSeat */
  const bobRedeemSeatP = redeem(bobPopPayout, { redeemValue: 1n });
  await t.throwsAsync(() => E(bobRedeemSeatP).getOfferResult());
});

test('add-question-bad-offer-args', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeatOne = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayoutOne = await checkGovFetchedCorrectly(aliceGovSeatOne, { unitsWanted: 5n });


  const offerArgsMissingApiMethodName = harden({
    // Property 'apiMethodName' should exist
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  const aliceQSeatMissingApiMethodName = addQuestion(aliceGovPayoutOne, offerArgsMissingApiMethodName);
  await t.throwsAsync(() => E(aliceQSeatMissingApiMethodName).getOfferResult(), { message: 'Bad apiMethodName' });

  const aliceGovSeatTwo = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayoutTwo = await checkGovFetchedCorrectly(aliceGovSeatTwo, { unitsWanted: 5n });

  const offerArgsBadMethodArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: 'Alice', // Should be an array
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  const aliceQSeatBadMethodArgs = addQuestion(aliceGovPayoutTwo, offerArgsBadMethodArgs);
  await t.throwsAsync(() => E(aliceQSeatBadMethodArgs).getOfferResult(), { message: 'Bad methodArgs' });

  const aliceGovSeatThree = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayoutThree = await checkGovFetchedCorrectly(aliceGovSeatThree, { unitsWanted: 5n });

  const offerArgsMissingCounter = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    // Property 'voteCounterInstallation' should exist
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  const aliceQSeatMissingCounter = addQuestion(aliceGovPayoutThree, offerArgsMissingCounter);
  await t.throwsAsync(() => E(aliceQSeatMissingCounter).getOfferResult(), { message: 'Bad voteCounterInstallation' });

  const aliceGovSeatFour = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayoutFour = await checkGovFetchedCorrectly(aliceGovSeatFour, { unitsWanted: 5n });

  const offerArgsMissingDeadline = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    // Property 'deadline' should exist
    vote: false,
  });

  const aliceQSeatMissingDeadline = addQuestion(aliceGovPayoutFour, offerArgsMissingDeadline);
  await t.throwsAsync(() => E(aliceQSeatMissingDeadline).getOfferResult(), { message: 'Bad deadline' });

  const aliceGovSeatFive = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayoutFive = await checkGovFetchedCorrectly(aliceGovSeatFive, { unitsWanted: 5n });

  const offerArgsMissingVote = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    // Property 'vote' should exist
  });

  const aliceQSeatMissingVote = addQuestion(aliceGovPayoutFive, offerArgsMissingVote);
  await t.throwsAsync(() => E(aliceQSeatMissingVote).getOfferResult(), { message: 'Bad vote' });
});

test('vote-on-question-bad-offer-args', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestionBadOfferArgs,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 1n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 1n });

  const maggieGovSeat = fetchGovFromFaucet({ unitsWanted: 2n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 2n });

  const peterGovSeat = fetchGovFromFaucet({ unitsWanted: 15n, decimals: 5n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 15n, decimals: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob tries to vote without a 'questionHandle'
  const bobVoteSeat = voteOnQuestionBadOfferArgs(bobGovPayout, { positions: [positive] });
  await t.throwsAsync(() => E(bobVoteSeat).getOfferResult(), { message: 'Bad questionHandle' });

  // Maggie tries to vote without 'positions'
  const maggieVoteSeat = voteOnQuestionBadOfferArgs(maggieGovPayout, { questionHandle: aliceQuestionHandle });
  await t.throwsAsync(() => E(maggieVoteSeat).getOfferResult(), { message: 'Bad positions' })

  // Petet tries to with an invalid 'positions' format
  const peterVoteSeat = voteOnQuestionBadOfferArgs(peterGovPayout, { questionHandle: aliceQuestionHandle, positions: true });
  await t.throwsAsync(() => E(peterVoteSeat).getOfferResult(), { message: 'Bad positions' })
});


/**
 * Scenario - 1
 * - Alice asks a question
 * - Alice chooses not to vote with the tokens she used to ask the question
 * - Bob chosses to vote 'For' with the weight 1000000 GOV tokens
 * - Maggie chooses to vote 'Against' with the weight 2000000 GOV tokens
 * - Peter chooses to vote 'For' with the weight 1500000 GOV tokens
 * - Outcome position is 'positive'
 * - Everybody redeems
 * - Question balance is zero
 */
test('scenario-1', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
    redeem,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 5n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 5n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 1n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 1n });

  const maggieGovSeat = fetchGovFromFaucet({ unitsWanted: 2n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 2n });

  const peterGovSeat = fetchGovFromFaucet({ unitsWanted: 15n, decimals: 5n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 15n, decimals: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  // Alice adds a new question
  const aliceQuestionSeat = await addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: alicePopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = voteOnQuestion(bobGovPayout, positive, aliceQuestionHandle);
  const { popPayment: bobPopPayment } = await checkVotedSuccessfully(bobVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 1n,
  });

  // Maggie votes `Against`
  const maggieVoteSeat = voteOnQuestion(maggieGovPayout, negative, aliceQuestionHandle);
  const { popPayment: maggiePopPayment } = await checkVotedSuccessfully(maggieVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 2n,
  });

  // Petet votes `For`
  const peterVoteSeat = voteOnQuestion(peterGovPayout, positive, aliceQuestionHandle);
  const { popPayment: peterPopPayment } = await checkVotedSuccessfully(peterVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 15n,
    decimals: 5n,
  });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: positive,
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat],
    executionOutcome: {
      resultPromise: E(governedPF).getTestPromise(),
      expectedResolveValue: 'Hello Alice!!!',
    },
  });

  // Bob redeems
  const bobRedeemSeat = redeem(bobPopPayment, { redeemValue: 1n });
  await checkRedeemedProperly(bobRedeemSeat, { unitsWanted: 1n });

  // Maggie redeems
  const maggieRedeemSeat = redeem(maggiePopPayment, { redeemValue: 2n });
  await checkRedeemedProperly(maggieRedeemSeat, { unitsWanted: 2n });

  // Peter redeems
  const peterRedeemSeat = redeem(peterPopPayment, { redeemValue: 15n, decimals: 5n });
  await checkRedeemedProperly(peterRedeemSeat, { unitsWanted: 15n, decimals: 5n });

  // Alice redeems
  const aliceRedeemSeat = redeem(alicePopPayment, { redeemValue: 5n });
  await checkRedeemedProperly(aliceRedeemSeat, { unitsWanted: 5n });

  // Question balance should be empty
  await checkQuestionBalance({
    questionHandle: aliceQuestionHandle, expected: {
      value: 0n,
    },
  });
});

/**
 * Scenario - 2
 * - Alice asks a question
 * - Alice wants to vote with her tokens
 * - Alice votes 6 units of GOV, positive
 * - Bob votes 1.3 units of GOV negative
 * - Maggie votes 3 units of GOV, negative
 * - Peter votes 0.4 units of GOV, negative
 * - Outcome is positive
 * - Everybody redeems
 * - Questions balance is zero
 */
test('scenario-2', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
    redeem,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 6n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 6n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 13n, decimals: 5n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 13n, decimals: 5n });

  const maggieGovSeat = fetchGovFromFaucet({ unitsWanted: 3n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 3n });

  const peterGovSeat = fetchGovFromFaucet({ unitsWanted: 4n, decimals: 5n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 4n, decimals: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: alicePopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `Against`
  const bobVoteSeat = voteOnQuestion(bobGovPayout, negative, aliceQuestionHandle);
  const { popPayment: bobPopPayment } = await checkVotedSuccessfully(bobVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 13n,
    decimals: 5n,
  });

  // Maggie votes `Against`
  const maggieVoteSeat = voteOnQuestion(maggieGovPayout, negative, aliceQuestionHandle);
  const { popPayment: maggiePopPayment } = await checkVotedSuccessfully(maggieVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 3n,
  });

  // Petet votes `Against`
  const peterVoteSeat = voteOnQuestion(peterGovPayout, negative, aliceQuestionHandle);
  const { popPayment: peterPopPayment } = await checkVotedSuccessfully(peterVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 4n,
    decimals: 5n,
  });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: positive,
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat],
    executionOutcome: {
      resultPromise: E(governedPF).getTestPromise(),
      expectedResolveValue: 'Hello Alice!!!',
    },
  });

  // Bob redeems
  const bobRedeemSeat = redeem(bobPopPayment, { redeemValue: 13n, decimals: 5n });
  await checkRedeemedProperly(bobRedeemSeat, { unitsWanted: 13n, decimals: 5n });

  // Maggie redeems
  const maggieRedeemSeat = redeem(maggiePopPayment, { redeemValue: 3n });
  await checkRedeemedProperly(maggieRedeemSeat, { unitsWanted: 3n });

  // Peter redeems
  const peterRedeemSeat = redeem(peterPopPayment, { redeemValue: 4n, decimals: 5n });
  await checkRedeemedProperly(peterRedeemSeat, { unitsWanted: 4n, decimals: 5n });

  // Alice redeems
  const aliceRedeemSeat = redeem(alicePopPayment, { redeemValue: 6n });
  await checkRedeemedProperly(aliceRedeemSeat, { unitsWanted: 6n });

  // Question balance should be empty
  await checkQuestionBalance({
    questionHandle: aliceQuestionHandle, expected: {
      value: 0n,
    },
  });
});

/**
 * Scenario - 3
 * - Alice asks a question
 * - Alice wants to vote with her tokens
 * - Alice votes 6 units of GOV, positive
 * - Bob votes 2 units of GOV negative
 * - Maggie votes 3 units of GOV, negative
 * - Peter votes 1.4 units of GOV, negative
 * - Outcome is negative
 * - Everybody redeems
 * - Questions balance is zero
 */
test('scenario-3', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
    redeem,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 6n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 6n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 2n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 2n });

  const maggieGovSeat = fetchGovFromFaucet({ unitsWanted: 3n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 3n });

  const peterGovSeat = fetchGovFromFaucet({ unitsWanted: 14n, decimals: 5n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 14n, decimals: 5n });

  const offerArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayout, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: alicePopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `Against`
  const bobVoteSeat = voteOnQuestion(bobGovPayout, negative, aliceQuestionHandle);
  const { popPayment: bobPopPayment } = await checkVotedSuccessfully(bobVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 2n,
  });

  // Maggie votes `Against`
  const maggieVoteSeat = voteOnQuestion(maggieGovPayout, negative, aliceQuestionHandle);
  const { popPayment: maggiePopPayment } = await checkVotedSuccessfully(maggieVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 3n,
  });

  // Petet votes `Against`
  const peterVoteSeat = voteOnQuestion(peterGovPayout, negative, aliceQuestionHandle);
  const { popPayment: peterPopPayment } = await checkVotedSuccessfully(peterVoteSeat, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 14n,
    decimals: 5n,
  });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: negative,
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat],
  });

  // Bob redeems
  const bobRedeemSeat = redeem(bobPopPayment, { redeemValue: 2n });
  await checkRedeemedProperly(bobRedeemSeat, { unitsWanted: 2n });

  // Maggie redeems
  const maggieRedeemSeat = redeem(maggiePopPayment, { redeemValue: 3n });
  await checkRedeemedProperly(maggieRedeemSeat, { unitsWanted: 3n });

  // Peter redeems
  const peterRedeemSeat = redeem(peterPopPayment, { redeemValue: 14n, decimals: 5n });
  await checkRedeemedProperly(peterRedeemSeat, { unitsWanted: 14n, decimals: 5n });

  // Alice redeems
  const aliceRedeemSeat = redeem(alicePopPayment, { redeemValue: 6n });
  await checkRedeemedProperly(aliceRedeemSeat, { unitsWanted: 6n });

  // Question balance should be empty
  await checkQuestionBalance({
    questionHandle: aliceQuestionHandle, expected: {
      value: 0n,
    },
  });
});

/**
 * Scenario - 4
 * - Alice asks a question
 * - Bob asks a question
 * - Bob votes Alice's question negative, 1 unit of GOV
 * - Maggie votes Alice's question negative, 2 units of GOV
 * - Peter votes Alice's question positive 1 unit of GOV
 * - Alice votes Bob's question negative, 2 units of GOV
 * - Maggie votes Bob's question positive, 1 unit of GOV
 * - Peter votes Bob's question negative, 1 unit of GOV
 * - Outcome of Alice's question is positive
 * - Outcome of Bob's question is negative
 * - Everybody redeems
 * - Balances of both questions are zero
 */
test('scenario-4', async t => {
  const {
    zoe,
    timer,
    electionManager: { electionManagerPublicFacet },
    electorate: { electoratePublicFacet },
    governed: { governedPF },
    installs,
  } = await setupServices(t);

  const {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
    redeem,
    splitGovPayout,
  } = await makeGovernanceScenarioHeplpers(zoe, governedPF, electionManagerPublicFacet);

  const {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet);

  const aliceGovSeat = fetchGovFromFaucet({ unitsWanted: 4n });
  const aliceGovPayout = await checkGovFetchedCorrectly(aliceGovSeat, { unitsWanted: 4n });
  const [aliceQuestionPayout, aliceVotePayout] = await splitGovPayout(aliceGovPayout, { value: 2n });

  const bobGovSeat = fetchGovFromFaucet({ unitsWanted: 2n });
  const bobGovPayout = await checkGovFetchedCorrectly(bobGovSeat, { unitsWanted: 2n });
  const [bobQuestionPayout, bobVotePayout] = await splitGovPayout(bobGovPayout, { value: 1n });

  const maggieGovSeat = fetchGovFromFaucet({ unitsWanted: 4n });
  const maggieGovPayout = await checkGovFetchedCorrectly(maggieGovSeat, { unitsWanted: 4n });
  const [maggieVoteAliceQPayout, maggieVoteBobQPayout] = await splitGovPayout(maggieGovPayout, { value: 2n });

  const peterGovSeat = fetchGovFromFaucet({ unitsWanted: 2n });
  const peterGovPayout = await checkGovFetchedCorrectly(peterGovSeat, { unitsWanted: 2n });
  const [peterVoteAliceQPayout, peterVoteBobQPayout] = await splitGovPayout(peterGovPayout, { value: 1n });

  const aliceQuestionOfferArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Alice'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  const bobQuestionOfferArgs = harden({
    apiMethodName: 'resolveArgument',
    methodArgs: ['Bob'],
    voteCounterInstallation: installs.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  const {
    positive: aliceQPositive,
    negative: aliceQNegative,
  } = makeApiInvocationPositions(aliceQuestionOfferArgs.apiMethodName, aliceQuestionOfferArgs.methodArgs);

  const {
    positive: bobQPositive,
    negative: bobQNegative,
  } = makeApiInvocationPositions(bobQuestionOfferArgs.apiMethodName, bobQuestionOfferArgs.methodArgs);

  // Alice and Bob ask their questions
  const aliceQuestionSeatP = addQuestion(aliceQuestionPayout, aliceQuestionOfferArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: aliceQuestionPopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeatP, { questionIndex: 0 });

  const bobQuestionSeatP = addQuestion(bobQuestionPayout, bobQuestionOfferArgs);
  const {
    questionHandle: bobQuestionHandle,
    popPayment: bobQuestionPopPayment,
  } = await checkQuestionAskedCorrectly(bobQuestionSeatP, { questionIndex: 1 });

  // Voting for Alice's question
  const bobVoteSeatP = voteOnQuestion(bobVotePayout, aliceQNegative, aliceQuestionHandle);
  const { popPayment: bobPopPayment } = await checkVotedSuccessfully(bobVoteSeatP, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 1n,
  });

  const maggieVoteSeatAliceQP = voteOnQuestion(maggieVoteAliceQPayout, aliceQPositive, aliceQuestionHandle);
  const { popPayment: maggiePopPaymentAliceQ } = await checkVotedSuccessfully(maggieVoteSeatAliceQP, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 2n,
  });

  const peterVoteSeatAliceQP = voteOnQuestion(peterVoteAliceQPayout, aliceQPositive, aliceQuestionHandle);
  const { popPayment: peterPopPaymentAliceQ } = await checkVotedSuccessfully(peterVoteSeatAliceQP, {
    questionHandle: aliceQuestionHandle,
    valueLocked: 1n,
  });

  // Voting for Bob's question
  const aliceVoteSeatP = voteOnQuestion(aliceVotePayout, bobQNegative, bobQuestionHandle);
  const { popPayment: alicePopPayment } = await checkVotedSuccessfully(aliceVoteSeatP, {
    questionHandle: bobQuestionHandle,
    valueLocked: 2n,
  });

  const maggieVoteSeatBobQP = voteOnQuestion(maggieVoteBobQPayout, bobQPositive, bobQuestionHandle);
  const { popPayment: maggiePopPaymentBobQ } = await checkVotedSuccessfully(maggieVoteSeatBobQP, {
    questionHandle: bobQuestionHandle,
    valueLocked: 2n,
  });

  const peterVoteSeatBobQP = voteOnQuestion(peterVoteBobQPayout, bobQNegative, bobQuestionHandle);
  const { popPayment: peterPopPaymentBobQ } = await checkVotedSuccessfully(peterVoteSeatBobQP, {
    questionHandle: bobQuestionHandle,
    valueLocked: 1n,
  });

  // Both elections end at the same time
  await E(timer).tickN(11n);

  // Alice's question passes
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: aliceQPositive,
    seats: [aliceQuestionSeatP, bobVoteSeatP, maggieVoteSeatAliceQP, peterVoteSeatAliceQP],
    executionOutcome: {
      resultPromise: E(governedPF).getTestPromise(),
      expectedResolveValue: 'Hello Alice!!!',
    },
  });

  // Bob's question gets denied
  await checkVotingEndedProperly({
    questionHandle: bobQuestionHandle,
    result: bobQNegative,
    seats: [bobQuestionSeatP, aliceVoteSeatP, maggieVoteSeatBobQP, peterVoteSeatBobQP],
  });

  // Bob redeems
  const bobQuestionRedeemSeatP = redeem(bobQuestionPopPayment, { redeemValue: 1n });
  await checkRedeemedProperly(bobQuestionRedeemSeatP, { unitsWanted: 1n });

  const bobVoteRedeemSeatP = redeem(bobPopPayment, { redeemValue: 1n });
  await checkRedeemedProperly(bobVoteRedeemSeatP, { unitsWanted: 1n });

  // Alice redeems
  const aliceQuestionRedeemSeatP = redeem(aliceQuestionPopPayment, { redeemValue: 2n });
  await checkRedeemedProperly(aliceQuestionRedeemSeatP, { unitsWanted: 2n });

  const aliceVoteRedeemSeatP = redeem(alicePopPayment, { redeemValue: 2n });
  await checkRedeemedProperly(aliceVoteRedeemSeatP, { unitsWanted: 2n });

  // Maggie redeems
  const maggieAliceQRedeemSeatP = redeem(maggiePopPaymentAliceQ, { redeemValue: 2n });
  await checkRedeemedProperly(maggieAliceQRedeemSeatP, { unitsWanted: 2n });

  const maggieBobQRedeemSeatP = redeem(maggiePopPaymentBobQ, { redeemValue: 2n });
  await checkRedeemedProperly(maggieBobQRedeemSeatP, { unitsWanted: 2n });

  // Peter redeems
  const peterAliceQRedeemSeatP = redeem(peterPopPaymentAliceQ, { redeemValue: 1n });
  await checkRedeemedProperly(peterAliceQRedeemSeatP, { unitsWanted: 1n });

  const peterBobQRedeemSeatP = redeem(peterPopPaymentBobQ, { redeemValue: 1n });
  await checkRedeemedProperly(peterBobQRedeemSeatP, { unitsWanted: 1n });

  // Question balances should be empty
  await Promise.all([
    checkQuestionBalance({
      questionHandle: aliceQuestionHandle, expected: {
        value: 0n,
      },
    }),
    checkQuestionBalance({
      questionHandle: bobQuestionHandle, expected: {
        value: 0n,
      },
    })
  ]);

});