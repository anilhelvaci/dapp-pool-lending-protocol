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

  const { creatorFacet: electionManagerCreatorFacet } = await E(zoe).startInstance(
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
    timer,
    electionManagerCreatorFacet,
    electorate: {
      electorateCreatorFacet,
      electoratePublicFacet,
    },
    governed: {
      governedPF,
      governedCF,
    }
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

