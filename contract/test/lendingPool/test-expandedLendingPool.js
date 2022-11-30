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
    lendingPool: {
      lendingPoolPublicFacet,
      lendingPoolInstance
    },
    assertions: {
      assertGovTokenInitializedCorrectly,
      assertGovFetchedCorrectly,
    },
    scenarioHelpers: {
      fetchGovTokens,
    },
  } = await setupServices(t);

  await assertGovTokenInitializedCorrectly({ lendingPoolPublicFacet, lendingPoolInstance });

  const aliceFetchGovSeatP = fetchGovTokens(0);
  await assertGovFetchedCorrectly(aliceFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 80_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const bobFetchGovSeatP = fetchGovTokens(1);
  await assertGovFetchedCorrectly(bobFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 60_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const maggieFetchGovSeatP = fetchGovTokens(2);
  await assertGovFetchedCorrectly(maggieFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 40_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const peterFetchGovSeatP = fetchGovTokens(3);
  await assertGovFetchedCorrectly(peterFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 20_000n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const chrisFetchGovSeatP = fetchGovTokens(4);
  await assertGovFetchedCorrectly(chrisFetchGovSeatP, {
    lendingPoolPublicFacet,
    keyword: 'LPT',
    expectedBalanceValue: 0n * 10n ** 6n,
    expectedSupplyValue: 20_000n * 10n ** 6n,
  });

  const invalidInvIndexFetchGovSeatP = fetchGovTokens(5);
  await t.throwsAsync(() => E(invalidInvIndexFetchGovSeatP).getOfferResult());

  const usedInvIndexFetchGovSeatP = fetchGovTokens(0);
  await t.throwsAsync(() => E(usedInvIndexFetchGovSeatP).getOfferResult());

});

test('add-new-pool-with-governance-voting', async t => {
  const services = await setupServices(t);
  console.log('services', services);
  t.is('is', 'is');
});

