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
import { SECONDS_PER_YEAR, BASIS_POINTS } from '../../src/interest.js';
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
import { makeLendingPoolTestProfileOne } from './lendingPoolTestProfiles.js';
import { BORROWABLE } from '../../src/lendingPool/params.js';
import { ParamTypes } from '@agoric/governance';
import { observeIteration } from '@agoric/notifier';

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
    riskControls: {
      borrowable: true,
      usableAsCol: true,
      limitValue: 10_001n, // 10k units protocolToken
    }
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

test('adjust-exceed-limit', async t => {
  // Uncomment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls,
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);


  const { loanKit: { loan: aliceLoan } }  =
    await scenarioHelpers.borrow(10n ** 8n, 4n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
    }),
    checkPoolStates(),
  ]);

  /** @type AdjustConfig */
  const collateralConfig = {
    type: ADJUST_PROPOSAL_TYPE.GIVE,
    value: 3n * 10n ** 8n / 2n,
  };

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.WANT,
    value: 7n * 10n ** 8n / 100n,
  };

  // Send the offer to adjust the loan
  /** @type UserSeat */
  const aliceUpdatedLoanSeat = scenarioHelpers.adjust(aliceLoan, collateralConfig, debtConfig);
  await t.throwsAsync(() => E(aliceUpdatedLoanSeat).getOfferResult(), { message: 'Proposed operation exceeds the allowed collateral limit.' });

});

test('second-borrow-exceed-limit', async t => {
  // Uncommment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls,
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);

  const { loanKit: { loan: aliceLoan } }  = await scenarioHelpers.borrow(10n ** 8n, 4n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
    }),
    checkPoolStates(),
  ]);

  const { seat: bobBorrowSeat } = await scenarioHelpers.borrow(3n * 10n ** 8n / 2n, 4n * 10n ** 6n, true);
  await t.throwsAsync(() => E(bobBorrowSeat).getOfferResult(), { message: 'Proposed operation exceeds the allowed collateral limit.' });
});

test('second-borrow-exceed-limit-after-first-adjusts', async t => {
  // Uncommment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls,
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, colPoolMan: vanPoolMan } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);

  const { loanKit: { loan: aliceLoan } }  = await scenarioHelpers.borrow(10n ** 8n, 4n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 5_000n * 10n ** 6n),
    checkPoolStates(),
  ]);

  /** @type AdjustConfig */
  const collateralConfig = {
    type: ADJUST_PROPOSAL_TYPE.GIVE,
    value: 10n ** 8n / 2n,
  };

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.WANT,
    value: 10n ** 8n / 100n,
  };

  // Send the offer to adjust the loan
  /** @type UserSeat */
  const aliceUpdatedLoanSeat = await scenarioHelpers.adjust(aliceLoan, collateralConfig, debtConfig);
  const expectedValuesAfterAdjust = {
    collateralPayoutAmount: undefined,
    debtPayoutAmount: undefined,
    totalCollateralUnderlyingAfterUpdate: AmountMath.make(vanBrand, 10n ** 8n / 2n + 10n ** 8n),
    totalDebtAfterUpdate: AmountMath.make(panBrand, 4n * 10n ** 6n + 10n ** 8n / 100n)
  };
  await assertionHelpers.assertAdjustBalancesSuccessful(vanPoolMan, panPoolMan, aliceLoan, aliceUpdatedLoanSeat, expectedValuesAfterAdjust);
  await assertionHelpers.assertCollateralBalance(vanPoolMan, 7_500n * 10n ** 6n);

  const { seat: bobBorrowSeat } = await scenarioHelpers.borrow(10n ** 8n, 4n * 10n ** 6n, true);
  await t.throwsAsync(() => E(bobBorrowSeat).getOfferResult(), { message: 'Proposed operation exceeds the allowed collateral limit.' });
  await assertionHelpers.assertCollateralBalance(vanPoolMan, 7_500n * 10n ** 6n);
});

test('bob-can-borrow-after-alice-adjusts', async t => {
  // Uncommment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls,
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, colPoolMan: vanPoolMan } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);

  const { loanKit: { loan: aliceLoan } }  = await scenarioHelpers.borrow(3n * 10n ** 8n / 2n, 35n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 7_500n * 10n ** 6n),
    checkPoolStates(),
  ]);

  const { seat: bobLoanSeat }  = await scenarioHelpers.borrow( 10n ** 8n, 35n * 10n ** 6n, true);
  await t.throwsAsync(() => E(bobLoanSeat).getOfferResult(), { message: 'Proposed operation exceeds the allowed collateral limit.' });

  /** @type AdjustConfig */
  const collateralConfig = {
    type: ADJUST_PROPOSAL_TYPE.WANT,
    value: 10n ** 8n / 2n,
  };

  /** @type AdjustConfig */
  const debtConfig = {
    type: ADJUST_PROPOSAL_TYPE.GIVE,
    value: 5n * 10n ** 6n,
  };

  // Send the offer to adjust the loan
  /** @type UserSeat */
  const aliceUpdatedLoanSeat = await scenarioHelpers.adjust(aliceLoan, collateralConfig, debtConfig);
  const expectedValuesAfterAdjust = {
    collateralPayoutAmount: undefined,
    debtPayoutAmount: undefined,
    totalCollateralUnderlyingAfterUpdate: AmountMath.make(vanBrand, 10n ** 8n),
    totalDebtAfterUpdate: AmountMath.make(panBrand, 30n * 10n ** 6n)
  };
  await assertionHelpers.assertAdjustBalancesSuccessful(vanPoolMan, panPoolMan, aliceLoan, aliceUpdatedLoanSeat, expectedValuesAfterAdjust);
  await assertionHelpers.assertCollateralBalance(vanPoolMan, 5_000n * 10n ** 6n);

  const { loanKit: { loan: bobLoan } } = await scenarioHelpers.borrow(10n ** 8n, 4n * 10n ** 6n);
  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, bobLoan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 34n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 97n * 10n ** 7n),
      borrowingRate: makeRatio(318n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 10_000n * 10n ** 6n),
    checkPoolStates(),
  ]);
});

test('bob-can-borrow-after-alice-closes', async t => {
  // Uncommment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls,
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, colPoolMan: vanPoolMan } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);

  const { loanKit: { loan: aliceLoan } }  = await scenarioHelpers.borrow(3n * 10n ** 8n / 2n, 35n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 7_500n * 10n ** 6n),
    checkPoolStates(),
  ]);

  const { seat: bobLoanSeat }  = await scenarioHelpers.borrow( 10n ** 8n, 10n ** 6n, true);
  await t.throwsAsync(() => E(bobLoanSeat).getOfferResult(), { message: 'Proposed operation exceeds the allowed collateral limit.' });

  const debtConfig = {
    value: 35n * 10n ** 6n,
  };

  const aliceCloseSeat = await scenarioHelpers.closeLoan(aliceLoan, debtConfig);

  const expectedValuesAfterClose = {
    collateralUnderlyingAmount: AmountMath.make(vanBrand, 3n * 10n ** 8n / 2n),
    newTotalDebt: AmountMath.makeEmpty(panBrand),
  };

  await Promise.all([
    assertionHelpers.assertLoanClosedCorrectly(vanPoolMan, panPoolMan, aliceCloseSeat, aliceLoan, expectedValuesAfterClose),
    checkPoolStates(),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 0n),
  ]);

  const { loanKit: { loan: bobLoan } } = await scenarioHelpers.borrow(10n ** 8n, 4n * 10n ** 6n);
  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, bobLoan, {
      requestedDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 4n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(258n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 5_000n * 10n ** 6n),
    checkPoolStates(),
  ]);
});

test('bob-can-borrow-after-alice-gets-liquidated', async t => {
  // Uncommment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls : {
      ...riskControls,
      limitValue: 5_001n,
    },
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, colPoolMan: vanPoolMan } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);

  const { loanKit: { loan: aliceLoan } }  = await scenarioHelpers.borrow(10n ** 8n, 35n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 5_000n * 10n ** 6n),
    checkPoolStates(),
  ]);

  const { seat: bobLoanSeat }  = await scenarioHelpers.borrow( 10n ** 8n, 10n ** 6n, true);
  await t.throwsAsync(() => E(bobLoanSeat).getOfferResult(), { message: 'Proposed operation exceeds the allowed collateral limit.' });

  // Collateral price goes down, new max amount of debt is 66 USD worth PAN
  // This means that we're now underwater, so liquidation should be triggerred
  scenarioHelpers.setCollateralUnderlyingPrice(100n * 10n ** 6n);
  await eventLoopIteration();

  const expectedValuesAfterLiquidation = {
    debtAmount: AmountMath.make(panBrand, 35n * 10n ** 6n),
    initialLiquidityBeforeLoan: AmountMath.make(panBrand, 10n * 10n ** 8n),
    totalDebt: AmountMath.makeEmpty(panBrand),
    borrowRate: makeRatio(250n, panBrand, BASIS_POINTS),
    exchangeRateNumerator: 2000000n,
  };

  // Check market state after liquidation
  await Promise.all([
    assertionHelpers.assertLiquidation(panPoolMan, aliceLoan, expectedValuesAfterLiquidation),
    checkPoolStates(),
  ]);

  const { loanKit: { loan: bobLoan } } = await scenarioHelpers.borrow(10n ** 8n, 2n * 10n ** 5n);
  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, bobLoan, {
      requestedDebt: AmountMath.make(panBrand, 2n * 10n ** 5n),
      totalDebt: AmountMath.make(panBrand, 2n * 10n ** 5n),
      liquidationOccurredBefore: true,
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 5_000n * 10n ** 6n),
    checkPoolStates(),
  ]);
});

test('alice-can-borrow-bob-cannot-marked-as-non-borrowable', async t => {
  // Uncommment this when you decide to use the debugger
  // await new Promise(resolve => setTimeout(resolve, 5000));
  const {
    zoe,
    lendingPool,
    timer,
  } = await setupServices(t);

  const {
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint, brand: vanBrand },
    panKit: { mint: panMint, brand: panBrand },
    vanRates,
    panRates,
    riskControls,
  } = t.context;

  const { lendingPoolPublicFacet, lendingPoolInstance } = lendingPool;

  const scenarioHelpers = makeLendingPoolScenarioHelpers(zoe, lendingPool, timer, compCurrencyBrand, vanMint, panMint);
  const assertionHelpers = makeLendingPoolAssertions(t, lendingPoolPublicFacet, lendingPoolInstance);

  const profileInfo = {
    collateralPool: {
      keyword: 'VAN',
      brand: vanBrand,
      priceValue: 110n * 10n ** 8n,
      rates: vanRates,
      depositValue: 10n,
    },
    debtPool: {
      keyword: 'PAN',
      brand: panBrand,
      priceValue: 200n * 10n ** 8n,
      rates: panRates,
      depositValue: 10n,
    },
    riskControls,
    compCurrencyBrand,
  };

  const { checkPoolStates, debtPoolMan: panPoolMan, colPoolMan: vanPoolMan } = await makeLendingPoolTestProfileOne(t, scenarioHelpers, assertionHelpers, profileInfo);

  const { loanKit: { loan: aliceLoan } }  = await scenarioHelpers.borrow(10n ** 8n, 35n * 10n ** 6n);

  await Promise.all([
    assertionHelpers.assertBorrowSuccessfulNoInterest(panPoolMan, aliceLoan, {
      requestedDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      totalDebt: AmountMath.make(panBrand, 35n * 10n ** 6n),
      underlyingBalanceBefore: AmountMath.make(panBrand, 10n * 10n ** 8n),
      borrowingRate: makeRatio(320n, panBrand, BASIS_POINTS),
    }),
    assertionHelpers.assertCollateralBalance(vanPoolMan, 5_000n * 10n ** 6n),
    checkPoolStates(),
  ]);

  const updateSeatP = await scenarioHelpers.updateDebtPoolParams(harden({ [BORROWABLE]: false }));

  await assertionHelpers.assertParameterUpdatedCorrectly({ userSeat: updateSeatP, poolManager: panPoolMan });
  await eventLoopIteration();

  const { seat: bobLoanSeat }  = await scenarioHelpers.borrow( 10n ** 8n, 10n ** 6n, true);
  await t.throwsAsync(() => E(bobLoanSeat).getOfferResult(), { message: `The borrow brand is not marked as 'Borrowable'` });
});