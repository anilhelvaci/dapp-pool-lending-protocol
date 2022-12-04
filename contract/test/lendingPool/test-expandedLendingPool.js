// @ts-check
import { makeTracer } from '@agoric/inter-protocol/src/makeTracer.js';
import '@agoric/zoe/exported.js';
import '@agoric/zoe/tools/prepare-test-env.js';
import test from 'ava';
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
import {
  makeRates,
  setupAssets,
  makeMarketStateChecker,
  getPoolMetadata,
  calculateUnderlyingFromProtocol,
  calculateProtocolFromUnderlying,
  splitCollateral,
} from './helpers.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import {
  setupServices,
  CONTRACT_ROOTS,
  getPath,
  startLendingPool,
  setupAmmAndElectorate,
} from './setup.js';
import { setUpZoeForTest } from '@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup.js';
import { objectMap } from '@agoric/internal';
import { SECONDS_PER_YEAR } from '../../src/interest.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { unsafeMakeBundleCache } from '@agoric/swingset-vat/tools/bundleTool.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { LoanPhase } from '../../src/lendingPool/loan.js';
import { oneMinus } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeLendingPoolAssertions } from './lendingPoolAssertions.js';
import { ADJUST_PROPOSAL_TYPE, makeLendingPoolScenarioHelpers, POOL_TYPES } from './lendingPoolScenrioHelpers.js';
import { makeGovernanceScenarioHeplpers } from '../governance/governanceScenarioHelpers.js';
import { makeGovernanceAssertionHelpers } from '../governance/governanceAssertions.js';
import { TimeMath } from '@agoric/swingset-vat/src/vats/timer/timeMath.js';
import { makeApiInvocationPositions } from '@agoric/governance/src/contractGovernance/governApi.js';

test.before(async t => {
  const farZoeKit = setUpZoeForTest();

  const bundleCache = await unsafeMakeBundleCache('./bundles/'); // package-relative
  // note that the liquidation might be a different bundle name
  const bundles = await Collect.allValues({
    faucet: bundleCache.load(await getPath(CONTRACT_ROOTS.faucet), 'faucet'),
    liquidate: bundleCache.load(await getPath(CONTRACT_ROOTS.liquidate), 'liquidateMinimum'),
    LendingPool: bundleCache.load(await getPath(CONTRACT_ROOTS.LendingPool), 'lendingPool'),
    amm: bundleCache.load(await getPath(CONTRACT_ROOTS.amm), 'amm'),
    reserve: bundleCache.load(await getPath(CONTRACT_ROOTS.reserve), 'reserve'),
    lendingPoolElectorate: bundleCache.load(await getPath(CONTRACT_ROOTS.lendingPoolElectorate), 'lendingPoolElectorate'),
    lendingPoolElectionManager: bundleCache.load(await getPath(CONTRACT_ROOTS.lendingPoolElectionManager), 'lendingPoolElectionManager'),
    counter: bundleCache.load(await getPath(CONTRACT_ROOTS.counter), 'binaryVoteCounter')
  });
  const installations = objectMap(bundles, bundle => E(farZoeKit.zoe).install(bundle));

  const { vanKit, usdKit, panKit, agVanKit } = setupAssets();

  const contextPs = {
    farZoeKit,
    bundles,
    installations,
    electorateTerms: undefined,
    loanTiming: {
      chargingPeriod: 2n,
      recordingPeriod: 6n,
      priceCheckPeriod: 6n,
    },
    minInitialDebt: 50n,
    // All values are in units
    ammPoolsConfig: {
      compareVanInitialLiquidityValue: 100n,
      comparePanInitialLiquidityValue: 100n,
      vanInitialLiquidityValue: 90n * 100n,
      panInitialLiquidityValue: 100n * 100n,
    },
  };
  const frozenCtx = await deeplyFulfilled(harden(contextPs));
  t.context = {
    ...frozenCtx,
    bundleCache,
    vanKit,
    compareCurrencyKit: usdKit,
    panKit,
    agVanKit,
    vanRates: makeRates(vanKit.brand, usdKit.brand),
    panRates: makeRates(panKit.brand, usdKit.brand),
  };
  // trace(t, 'CONTEXT');
});

test('initial', async t => {
  const services = await setupServices(t);
  console.log('services', services);
  t.is('is', 'is');
});

/**
 * Governance Token
 * - Start the contract with the contract with the gov token data in the terms
 * - Check govSeat allocations
 * - Alice uses inv 0 to fetch some gov tokens. Assert;
 *     - Correct amount received
 *     - govSeat allocation decreases
 * - Repeat above process for 4 more times
 * - Try to fetch again with a used invitation. Assert;
 *     - Should throw
 * Try to get an invitation with an index greater than the committee size. Assert;
 *     - Should throw
 */
test('governance-token', async t => {
  const {
    zoe,
    lendingPool: {
      lendingPoolPublicFacet,
      lendingPoolCreatorFacet,
      lendingPoolInstance
    },
    governor: {
      governorPublicFacet,
    }
  } = await setupServices(t);

  const { fetchGovTokenSingleMember } = await makeGovernanceScenarioHeplpers(zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolCreatorFacet);
  const {
    assertGovTokenInitializedCorrectly,
    assertGovFetchedCorrectly,
  } = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  await assertGovTokenInitializedCorrectly({ lendingPoolPublicFacet, lendingPoolInstance });

  const aliceFetchGovSeatP = fetchGovTokenSingleMember(0);
  await assertGovFetchedCorrectly(aliceFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 80_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const bobFetchGovSeatP = fetchGovTokenSingleMember(1);
  await assertGovFetchedCorrectly(bobFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 60_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const maggieFetchGovSeatP = fetchGovTokenSingleMember(2);
  await assertGovFetchedCorrectly(maggieFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 40_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const peterFetchGovSeatP = fetchGovTokenSingleMember(3);
  await assertGovFetchedCorrectly(peterFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 20_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const chrisFetchGovSeatP = fetchGovTokenSingleMember(4);
  await assertGovFetchedCorrectly(chrisFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 0n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const invalidInvIndexFetchGovSeatP = fetchGovTokenSingleMember(5);
  await t.throwsAsync(() => E(invalidInvIndexFetchGovSeatP).getOfferResult());

  const usedInvIndexFetchGovSeatP = fetchGovTokenSingleMember(0);
  await t.throwsAsync(() => E(usedInvIndexFetchGovSeatP).getOfferResult());

});

/**
 * Succeessfully invoke 'addPoolType' with governance voting
 * - Committee get their GOV tokens
 * - Alice asks a question
 * - Alice, Bob and Maggie votes positive with all their tokens
 * - Peter and Chris votes negative
 * - Outcome is positive
 * - Everybody redeems
 * - Question balance is zero
 */
test('add-new-pool-with-governance-voting-positive', async t => {
  const {
    vanKit: { brand: vanBrand, issuer: vanIssuer },
    compareCurrencyKit: { brand: usdBrand },
    vanRates,
  } = t.context;

  const {
    zoe,
    lendingPool: {
      lendingPoolPublicFacet,
      lendingPoolCreatorFacet,
    },
    governor: {
      governorPublicFacet,
    },
    electorate: {
      lendingPoolElectoratePF,
    },
    timer,
  } = await setupServices(t);

  const {
    addQuestion,
    voteOnQuestion,
    redeem,
    fetchGovTokensAllCommittee,
  } = await makeGovernanceScenarioHeplpers(zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolCreatorFacet);

  const {
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolElectoratePF);

  const { assertPoolAddedCorrectly } = makeLendingPoolAssertions(t, lendingPoolPublicFacet);

  const [
    aliceGovPayment,
    bobGovPayment,
    maggieGovPayment,
    peterGovPayment,
    chrisGovpayment] = await fetchGovTokensAllCommittee();

  const price = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);

  const underlyingPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: price,
    timer,
  });

  const offerArgs = harden({
    apiMethodName: 'addPoolType',
    methodArgs: [vanIssuer, 'VAN', vanRates, underlyingPriceAuthority],
    voteCounterInstallation: t.context.installations.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayment, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: alicePopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = voteOnQuestion(bobGovPayment, positive, aliceQuestionHandle);
  const {
    popPayment: bobPopPayment
  } = await checkVotedSuccessfully(bobVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  // Maggie votes `For`
  const maggieVoteSeat = voteOnQuestion(maggieGovPayment, positive, aliceQuestionHandle);
  const {
    popPayment: maggiePopPayment,
  } = await checkVotedSuccessfully(maggieVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  // Peter votes `Against`
  const peterVoteSeat = voteOnQuestion(peterGovPayment, negative, aliceQuestionHandle);
  const {
    popPayment: peterPopPayment,
  } = await checkVotedSuccessfully(peterVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  // Peter votes `Against`
  const chrisVoteSeat = voteOnQuestion(chrisGovpayment, negative, aliceQuestionHandle);
  const {
    popPayment: chrisPopPayment,
  } = await checkVotedSuccessfully(chrisVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: positive,
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat, chrisVoteSeat],
  });

  const poolManager = await E(lendingPoolPublicFacet).getPool(vanBrand);
  await assertPoolAddedCorrectly(poolManager, lendingPoolPublicFacet);

  // Alice redeems
  const aliceRedeemSeat = redeem(alicePopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(aliceRedeemSeat, { unitsWanted: 20_000n });

  // Bob redeems
  const bobRedeemSeat = redeem(bobPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(bobRedeemSeat, { unitsWanted: 20_000n });

  // Maggie redeems
  const maggieRedeemSeat = redeem(maggiePopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(maggieRedeemSeat, { unitsWanted: 20_000n });

  // Peter redeems
  const peterRedeemSeat = redeem(peterPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(peterRedeemSeat, { unitsWanted: 20_000n });

  // Chris redeems
  const chrisRedeemSeat = redeem(chrisPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(chrisRedeemSeat, { unitsWanted: 20_000n });

  // Question balance should be empty
  await checkQuestionBalance({
    questionHandle: aliceQuestionHandle, expected: {
      value: 0n,
    },
  });

});

/**
 * Try to invoke 'addPoolType' with governance voting but the community says no
 * - Committee get their GOV tokens
 * - Alice asks a question
 * - Alice, Bob votes positive with all their tokens
 * - Maggie, Peter and Chris votes negative
 * - Outcome is negative
 * - Everybody redeems
 * - Question balance is zero
 */
test('add-new-pool-with-governance-voting-negative', async t => {
  const {
    vanKit: { brand: vanBrand, issuer: vanIssuer },
    compareCurrencyKit: { brand: usdBrand },
    vanRates,
  } = t.context;

  const {
    zoe,
    lendingPool: {
      lendingPoolPublicFacet,
      lendingPoolCreatorFacet,
    },
    governor: {
      governorPublicFacet,
    },
    electorate: {
      lendingPoolElectoratePF,
    },
    timer,
  } = await setupServices(t);

  const {
    addQuestion,
    voteOnQuestion,
    redeem,
    fetchGovTokensAllCommittee,
  } = await makeGovernanceScenarioHeplpers(zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolCreatorFacet);

  const {
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolElectoratePF)

  const [
    aliceGovPayment,
    bobGovPayment,
    maggieGovPayment,
    peterGovPayment,
    chrisGovpayment] = await fetchGovTokensAllCommittee();

  const price = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);

  const underlyingPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: price,
    timer,
  });

  const offerArgs = harden({
    apiMethodName: 'addPoolType',
    methodArgs: [vanIssuer, 'VAN', vanRates, underlyingPriceAuthority],
    voteCounterInstallation: t.context.installations.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: true,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayment, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: alicePopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive, negative } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = voteOnQuestion(bobGovPayment, positive, aliceQuestionHandle);
  const {
    popPayment: bobPopPayment
  } = await checkVotedSuccessfully(bobVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  // Maggie votes `Against`
  const maggieVoteSeat = voteOnQuestion(maggieGovPayment, negative, aliceQuestionHandle);
  const {
    popPayment: maggiePopPayment,
  } = await checkVotedSuccessfully(maggieVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  // Peter votes `Against`
  const peterVoteSeat = voteOnQuestion(peterGovPayment, negative, aliceQuestionHandle);
  const {
    popPayment: peterPopPayment,
  } = await checkVotedSuccessfully(peterVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  // Peter votes `Against`
  const chrisVoteSeat = voteOnQuestion(chrisGovpayment, negative, aliceQuestionHandle);
  const {
    popPayment: chrisPopPayment,
  } = await checkVotedSuccessfully(chrisVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  await E(timer).tickN(11n);
  await checkVotingEndedProperly({
    questionHandle: aliceQuestionHandle,
    result: negative, // Outcome should be nagative
    seats: [aliceQuestionSeat, bobVoteSeat, maggieVoteSeat, peterVoteSeat, chrisVoteSeat],
  });

  const poolManagerExists = await E(lendingPoolPublicFacet).hasPool(vanBrand);
  t.is(poolManagerExists, false);

  // Alice redeems
  const aliceRedeemSeat = redeem(alicePopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(aliceRedeemSeat, { unitsWanted: 20_000n });

  // Bob redeems
  const bobRedeemSeat = redeem(bobPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(bobRedeemSeat, { unitsWanted: 20_000n });

  // Maggie redeems
  const maggieRedeemSeat = redeem(maggiePopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(maggieRedeemSeat, { unitsWanted: 20_000n });

  // Peter redeems
  const peterRedeemSeat = redeem(peterPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(peterRedeemSeat, { unitsWanted: 20_000n });

  // Chris redeems
  const chrisRedeemSeat = redeem(chrisPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(chrisRedeemSeat, { unitsWanted: 20_000n });

  // Question balance should be empty
  await checkQuestionBalance({
    questionHandle: aliceQuestionHandle, expected: {
      value: 0n,
    },
  });
});

/**
 * Try to invoke 'addPoolType' with governance voting but cannot reach quorum
 * - Committee get their GOV tokens
 * - Alice asks a question
 * - Alice chooses not to vote with her tokens
 * - Bob votes positive with all his tokens
 * - Nobody else votes
 * - Outcome is 'No quorum'
 * - Everybody redeems
 * - Question balance is zero
 */
test('add-new-pool-with-governance-voting-no-quorum', async t => {
  const {
    vanKit: { brand: vanBrand, issuer: vanIssuer },
    compareCurrencyKit: { brand: usdBrand },
    vanRates,
  } = t.context;

  const {
    zoe,
    lendingPool: {
      lendingPoolPublicFacet,
      lendingPoolCreatorFacet,
    },
    governor: {
      governorPublicFacet,
    },
    electorate: {
      lendingPoolElectoratePF,
    },
    timer,
  } = await setupServices(t);

  const {
    addQuestion,
    voteOnQuestion,
    redeem,
    fetchGovTokensAllCommittee,
  } = await makeGovernanceScenarioHeplpers(zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolCreatorFacet);

  const {
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedWithNoQuorum,
    checkRedeemedProperly,
    checkQuestionBalance,
  } = await makeGovernanceAssertionHelpers(t, zoe, lendingPoolPublicFacet, governorPublicFacet, lendingPoolElectoratePF)

  const [
    aliceGovPayment,
    bobGovPayment] = await fetchGovTokensAllCommittee();

  const price = makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand);

  const underlyingPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    initialPrice: price,
    timer,
  });

  const offerArgs = harden({
    apiMethodName: 'addPoolType',
    methodArgs: [vanIssuer, 'VAN', vanRates, underlyingPriceAuthority],
    voteCounterInstallation: t.context.installations.counter,
    deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), 11n),
    vote: false,
  });

  // Alice adds a new question
  const aliceQuestionSeat = addQuestion(aliceGovPayment, offerArgs);
  const {
    questionHandle: aliceQuestionHandle,
    popPayment: alicePopPayment,
  } = await checkQuestionAskedCorrectly(aliceQuestionSeat, { questionIndex: 0 });

  // Prepare Positions
  const { positive } = makeApiInvocationPositions(offerArgs.apiMethodName, offerArgs.methodArgs);

  // Bob votes `For`
  const bobVoteSeat = voteOnQuestion(bobGovPayment, positive, aliceQuestionHandle);
  const {
    popPayment: bobPopPayment
  } = await checkVotedSuccessfully(bobVoteSeat, { questionHandle: aliceQuestionHandle, valueLocked: 20_000n });

  await E(timer).tickN(11n);
  await checkVotingEndedWithNoQuorum({
    questionHandle: aliceQuestionHandle,
    seats: [aliceQuestionSeat, bobVoteSeat],
  });

  const poolManagerExists = await E(lendingPoolPublicFacet).hasPool(vanBrand);
  t.is(poolManagerExists, false);

  // Alice redeems
  const aliceRedeemSeat = redeem(alicePopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(aliceRedeemSeat, { unitsWanted: 20_000n });

  // Bob redeems
  const bobRedeemSeat = redeem(bobPopPayment, { redeemValue: 20_000n });
  await checkRedeemedProperly(bobRedeemSeat, { unitsWanted: 20_000n });

  // Question balance should be empty
  await checkQuestionBalance({
    questionHandle: aliceQuestionHandle, expected: {
      value: 0n,
    },
  });
});

test('borrow-borrowable-pool', async t => {
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint },
    panKit: { mint: panMint },
  } = t.context;

  const {
    addPool,
  } = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);

  t.is('is', 'is');
});

