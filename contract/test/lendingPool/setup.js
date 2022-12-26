// @ts-check

import { E, Far } from '@endo/far';
import { makeLoopback } from '@endo/captp';

import { resolve as importMetaResolve } from 'import-meta-resolve';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';

import { makeZoeKit } from '@agoric/zoe';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { makeAgoricNamesAccess, makePromiseSpace } from '@agoric/vats/src/core/utils.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import committeeBundle from '@agoric/governance/bundles/bundle-committee.js';
import contractGovernorBundle from '@agoric/governance/bundles/bundle-contractGovernor.js';
import binaryVoteCounterBundle from '@agoric/governance/bundles/bundle-binaryVoteCounter.js';
import * as utils from '@agoric/vats/src/core/utils.js';
import { makeAmmTerms } from '@agoric/inter-protocol/src/vpool-xyk-amm/params.js';
import { AmountMath } from '@agoric/ertp';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { makeGovernedTerms } from '../../src/lendingPool/params.js';
import { setupAMMBootstrap } from '@agoric/inter-protocol/test/amm/vpool-xyk-amm/setup.js';
import { provideBundle } from '@agoric/inter-protocol/test/supports.js';
import { setupAmm, setupReserve } from '@agoric/inter-protocol/src/proposals/econ-behaviors.js';
import { startEconomicCommittee } from '@agoric/inter-protocol/src/proposals/startEconCommittee.js';
import { makePriceManager } from '../../src/lendingPool/priceManager.js';
import { makeLendingPoolScenarioHelpers } from './lendingPoolScenrioHelpers.js';
import { makeLendingPoolAssertions } from './lendingPoolAssertions.js';
import { makeStorageNodeChild } from '@agoric/vats/src/lib-chainStorage.js';

const { details: X } = assert;

const COMPARE_CURRENCY_ISSUER_NAME = "IST";

const SECONDS_PER_HOUR = 60n * 60n;
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR;

const BASIS_POINTS = 10_000n;

export const CONTRACT_ROOTS = {
  faucet: './faucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  amm: '@agoric/inter-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js',
  reserve: '@agoric/inter-protocol/src/reserve/assetReserve.js',
  lendingPoolElectorate: '../../src/governance/lendingPoolElectorate.js',
  lendingPoolElectionManager: '../../src/governance/lendingPoolElectionManager.js',
  counter: '@agoric/governance/src/binaryVoteCounter.js',
  priceManagerContract: '../../src/lendingPool/priceManagerContract.js',
};

/**
 * @file This file contains methods for setting up the Agoric environment
 * for LendingPool protocol. We inherited the logic in econ-behaviors and
 * support.js in the VaultFactory.
 */

/**
 * This function installs and instantiates lendingPool and amm contracts alongside
 * with all the necessary variables.
 *
 * For the tests here, we've determined 3 types of tokens to run our tests. Those
 * tokens; VAN, PAN and USD. Here we use all those digital assets to set our
 * environment up.
 *
 * @param t
 * @param {ManualTimer} timer
 * @param ammPoolsConfig
 * @returns {Promise<{zoe: *, timer: (ManualTimer|*), ammFacets: {instance: *, ammPanPoolLiquidity: *, ammCreatorFacet: *, ammPublicFacet: GovernedPublicFacet<XYKAMMPublicFacet>, ammVanPoolLiquidity: *}, lendingPool: {lendingPoolPublicFacet: unknown extends (object & {then(onfulfilled: infer F): any}) ? (F extends ((value: infer V, ...args: any) => any) ? Awaited<V> : never) : unknown, lendingPoolCreatorFacet: unknown extends (object & {then(onfulfilled: infer F): any}) ? (F extends ((value: infer V, ...args: any) => any) ? Awaited<V> : never) : unknown}, scenarioHelpers: LendingPoolScenarioHelpers, governor: {governorInstance: unknown extends (object & {then(onfulfilled: infer F): any}) ? (F extends ((value: infer V, ...args: any) => any) ? Awaited<V> : never) : unknown, governorCreatorFacet: *, governorPublicFacet: *}, assertions}>}
 */
export const setupServices = async (
  t,
  timer = buildManualTimer(t.log),
  ammPoolsConfig = undefined,
) => {
  const {
    farZoeKit: { zoe },
    compareCurrencyKit: { brand: compCurrencyBrand },
    vanKit: { mint: vanMint },
    panKit: { mint: panMint },
    loanTiming,
  } = t.context;
  t.context.timer = timer;

  const {
    compareVanInitialLiquidityValue,
    comparePanInitialLiquidityValue,
    vanInitialLiquidityValue,
    panInitialLiquidityValue,
  } = ammPoolsConfig ? ammPoolsConfig : t.context.ammPoolsConfig;

  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    t,
    vanInitialLiquidityValue,
    compareVanInitialLiquidityValue,
    panInitialLiquidityValue,
    comparePanInitialLiquidityValue
  );
  const { consume, produce, instance } = space;
  // trace(t, 'amm', { ammFacets });

  const {
    installation: { produce: iProduce },
  } = space;
  iProduce.LendingPool.resolve(t.context.installations.LendingPool);
  iProduce.liquidate.resolve(t.context.installations.liquidate);
  iProduce.lendingPoolElectorate.resolve(t.context.installations.lendingPoolElectorate);
  iProduce.lendingPoolElectionManager.resolve(t.context.installations.lendingPoolElectionManager);

  await setupLendinPoolElectorate(space);

  /** @type PriceManager*/
  const priceManager = makePriceManager({});
  produce.priceManager.resolve(priceManager);

  await startLendingPool(space, { loanParams: loanTiming });

  const governorCreatorFacet = consume.lendingPoolGovernorCreator;
  const governorPublicFacet = consume.lendingPoolGovernorPublic;
  const lendingPoolElectoratePF = consume.lendingPoolElectoratePublicFacet;
  const lendingPoolElectorateCF = consume.lendingPoolElectorateCreatorFacet;

  /** @type {Promise<LendingPoolCreatorFacet>} */
  const lendingPoolCreatorFacetP = (
    E(governorCreatorFacet).getCreatorFacet()
  );

  /** @type {[any, LendingPoolCreatorFacet, LendingPoolPublicFacet]} */
  const [
    governorInstance,
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    lendingPoolInstance
  ] = await Promise.all([
    instance.consume.lendingPoolGovernor,
    lendingPoolCreatorFacetP,
    E(governorCreatorFacet).getPublicFacet(),
    instance.consume.lendingPool,
  ]);

  const { g, l, e } = {
    g: {
      governorInstance,
      governorPublicFacet,
      governorCreatorFacet,
    },
    l: {
      lendingPoolCreatorFacet,
      lendingPoolPublicFacet,
      lendingPoolInstance,
    },
    e: {
      lendingPoolElectoratePF,
      lendingPoolElectorateCF,
    }
  };

  /** @type LendingPoolScenarioHelpers */
  const scenarioHelpers = makeLendingPoolScenarioHelpers(
    zoe,
    { lendingPoolCreatorFacet, lendingPoolPublicFacet },
    timer,
    compCurrencyBrand,
    vanMint,
    panMint);

  const assertions = makeLendingPoolAssertions(t);

  return {
    zoe,
    governor: g,
    lendingPool: l,
    electorate: e,
    ammFacets,
    timer,
    assertions,
    scenarioHelpers,
  };
}

export const getPath = async (sourceRoot) => {
  const url = await importMetaResolve(sourceRoot, import.meta.url);
  return new URL(url).pathname;
};

export const startLendingPool = async (
  {
    consume: {
      board,
      chainStorage,
      chainTimerService,
      priceManager: priceManagerP,
      zoe,
      lendingPoolElectorateCreatorFacet, // lendingPoolElectorate
    },
    produce, // {  loanFactoryCreator }
    brand: {
      consume: { [COMPARE_CURRENCY_ISSUER_NAME]: compareBrandP },
    },
    instance,
    installation: {
      consume: { LendingPool, liquidate, lendingPoolElectionManager },
    },
  },
  {
    loanParams = {
      chargingPeriod: SECONDS_PER_HOUR,
      recordingPeriod: SECONDS_PER_DAY,
      priceCheckPeriod: SECONDS_PER_DAY,
    } = {},
  },
) => {

  const installations = await Collect.allValues({
    LendingPool,
    liquidate,
  });

  const poserInvitationP = E(lendingPoolElectorateCreatorFacet).getElectorateFacetInvitation();
  const [initialPoserInvitation, invitationAmount] = await Promise.all([
    poserInvitationP,
    E(E(zoe).getInvitationIssuer()).getAmountOf(poserInvitationP),
  ]);

  const [
    ammInstance,
    lendingPoolElectorateInstance,
    lendingPoolElectionManagerInstall,
    priceManager,
    timer,
    compareBrand
  ] = await Promise.all([
    instance.consume.amm,
    instance.consume.lendingPoolElectorate, // lendingPoolElectorate
    lendingPoolElectionManager, // lendingPoolElectionManager
    priceManagerP,
    chainTimerService,
    compareBrandP,
  ]);

  const ammPublicFacet = await E(zoe).getPublicFacet(ammInstance);

  const loanFactoryTerms = makeGovernedTerms(
    priceManager, // priceMan here
    loanParams,
    installations.liquidate,
    timer,
    invitationAmount,
    ammPublicFacet,
    compareBrand,
    {
      keyword: 'LPT',
      units: 100_000n,
      decimals: 6,
      committeeSize: 5,
    },
  );

  const governorTerms = harden({
    timer,
    lendingPoolElectorateInstance,
    governedContractInstallation: installations.LendingPool,
    governed: {
      terms: loanFactoryTerms,
      issuerKeywordRecord: {},
    },
  });
  const {
    creatorFacet: lendingPoolElectionMgrCreatorFacet,
    publicFacet: lendingPoolElectionMgrPublicFacet,
    instance: lendingPoolElectionMgrInstance,
  } =
    await E(zoe).startInstance(
      lendingPoolElectionManagerInstall,
      undefined,
      governorTerms,
      harden({
        governed: {
          initialPoserInvitation,
        },
      }),
    );

  const [lendingPoolInstance, lendingPoolCreator] = await Promise.all([
    E(lendingPoolElectionMgrCreatorFacet).getInstance(),
    E(lendingPoolElectionMgrCreatorFacet).getCreatorFacet(),
  ]);

  produce.lendingPoolCreator.resolve(lendingPoolCreator);
  produce.lendingPoolGovernorCreator.resolve(lendingPoolElectionMgrCreatorFacet);
  produce.lendingPoolGovernorPublic.resolve(lendingPoolElectionMgrPublicFacet);

  // Advertise the installations, instances in agoricNames.
  instance.produce.lendingPool.resolve(lendingPoolInstance);
  instance.produce.lendingPoolGovernor.resolve(lendingPoolElectionMgrInstance);
};

harden(startLendingPool)

export const setupAmmAndElectorate = async (
  t,
  vanLiquidity,
  compLiquidityPoolVan,
  panLiquidity,
  compLiquidityPoolPan) => {
  const {
    installations,
    farZoeKit,
    vanKit,
    panKit,
    compareCurrencyKit,
    electorateTerms = { committeeName: 'The Cabal', committeeSize: 1 },
    timer,
  } = t.context;
  const { feeMintAccess, zoe } = farZoeKit;
  const space = await setupAMMBootstrap(timer, farZoeKit);
  space.produce.zoe.resolve(farZoeKit.zoe);
  space.produce.feeMintAccess.resolve(feeMintAccess);
  const { consume, brand, issuer, installation, instance } = space;
  installation.produce.amm.resolve(installations.amm);
  installation.produce.reserve.resolve(installations.reserve);
  brand.produce.IST.resolve(compareCurrencyKit.brand);
  issuer.produce.IST.resolve(compareCurrencyKit.issuer);

  await Promise.all([
    startEconomicCommittee(space, {
      options: { econCommitteeOptions: electorateTerms },
    }),
    setupAmm(space, {
      options: {
        minInitialPoolLiquidity: 1000n,
      },
    }),
  ]);

  await setupReserve(space);

  const installs = await Collect.allValues({
    amm: installation.consume.amm,
    governor: installation.consume.contractGovernor,
    electorate: installation.consume.committee,
    counter: installation.consume.binaryVoteCounter,
  });

  const {
    creatorFacet: ammCreatorFacet,
    instanceWithoutReserve: governedInstance,
    governorCreatorFacet,
    publicFacet: ammPublicFacet
  } = await consume.ammKit;

  const governorInstance = await instance.consume.ammGovernor;
  const governorPublicFacet = await E(zoe).getPublicFacet(governorInstance);
  const g = {
    governorInstance,
    governorPublicFacet,
    governorCreatorFacet,
  };

  const amm = {
    ammCreatorFacet,
    ammPublicFacet,
    instance: governedInstance,
  };

  const { initPool } = makeAmmLiquidityManager(t, zoe, ammPublicFacet, compareCurrencyKit);

  await Promise.all([
    initPool(vanKit, vanLiquidity, compLiquidityPoolVan, 'VAN'),
    initPool(panKit, panLiquidity, compLiquidityPoolPan, 'PAN'),
  ]);

  const committeeCreator = await consume.economicCommitteeCreatorFacet;
  const electorateInstance = await instance.consume.economicCommittee;

  const poserInvitationP = E(committeeCreator).getPoserInvitation();
  const poserInvitationAmount = await E(
    E(zoe).getInvitationIssuer(),
  ).getAmountOf(poserInvitationP);

  return {
    zoe,
    installs,
    electorate: installs.electorate,
    committeeCreator,
    electorateInstance,
    governor: g,
    amm,
    invitationAmount: poserInvitationAmount,
    space,
  };
};

harden(setupAmmAndElectorate);

const setupLendinPoolElectorate = async (
  {
    consume: {
      zoe,
    },
    produce,
    installation: {
      consume: { lendingPoolElectorate },
    },
    instance: {
      produce: instanceProduce
    }
  }) => {

  const {
    creatorFacet: lendingPoolElectorateCreatorFacet,
    publicFacet: lendingPoolElectoratePublicFacet,
    instance: lendingPoolElectorateInstance
  } = await E(zoe).startInstance(lendingPoolElectorate);

  instanceProduce.lendingPoolElectorate.resolve(lendingPoolElectorateInstance);
  produce.lendingPoolElectorateCreatorFacet.resolve(lendingPoolElectorateCreatorFacet);
  produce.lendingPoolElectoratePublicFacet.resolve(lendingPoolElectoratePublicFacet);
};

harden(setupLendinPoolElectorate);
export {
  setupLendinPoolElectorate
};

/**
 *
 * @param t
 * @param {ZoeService} zoe
 * @param {XYKAMMPublicFacet} ammPublicFacet
 * @param {IssuerKit} centralR
 */
const makeAmmLiquidityManager = (t, zoe, ammPublicFacet, centralR) => {

  const makeCentral = (value) => AmountMath.make(centralR.brand, value * 10n ** BigInt(centralR.displayInfo.decimalPlaces));

  const initPool = async (secondaryR, secondaryValue, centralValue, kwd) => {
    const makeSecondary = (value) => AmountMath.make(secondaryR.brand, value * 10n ** BigInt(secondaryR.displayInfo.decimalPlaces));

    /** @type Issuer */
    const lpTokenIssuer = await E(ammPublicFacet).addIssuer(
      secondaryR.issuer,
      kwd,
    );
    const lpTokenBrand = await E(lpTokenIssuer).getBrand();

    const addPoolInvitation = E(ammPublicFacet).addPoolInvitation();
    const proposal = harden({
      give: {
        Secondary: makeSecondary(secondaryValue),
        Central: makeCentral(centralValue),
      },
      want: { Liquidity: AmountMath.make(lpTokenBrand, 1000n) },
    });
    const payments = {
      Secondary: secondaryR.mint.mintPayment(makeSecondary(secondaryValue)),
      Central: centralR.mint.mintPayment(makeCentral(centralValue)),
    };

    /** @type UserSeat */
    const addLiquiditySeat = await E(zoe).offer(
      addPoolInvitation,
      proposal,
      payments,
    );
    t.is(
      await E(addLiquiditySeat).getOfferResult(),
      'Added liquidity.',
    );

    return { seat: addLiquiditySeat, lpTokenIssuer };
  };

  return harden({ initPool });
}

