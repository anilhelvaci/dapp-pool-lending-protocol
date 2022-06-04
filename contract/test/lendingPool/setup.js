// @ts-check

import bundleSource from '@endo/bundle-source';
import { E, Far } from '@endo/far';
import { makeLoopback } from '@endo/captp';

import { resolve as importMetaResolve } from 'import-meta-resolve';
import { makeFakeVatAdmin } from '@agoric/zoe/tools/fakeVatAdmin.js';

import { makeZoeKit } from '@agoric/zoe';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { makeAgoricNamesAccess, makePromiseSpace } from '@agoric/vats/src/core/utils.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import committeeBundle from '@agoric/governance/bundles/bundle-committee.js';
import contractGovernorBundle from '@agoric/governance/bundles/bundle-contractGovernor.js';
import binaryVoteCounterBundle from '@agoric/governance/bundles/bundle-binaryVoteCounter.js';
import * as utils from '@agoric/vats/src/core/utils.js';
import { makeAmmTerms } from '@agoric/run-protocol/src/vpool-xyk-amm/params.js';
import { AmountMath } from '@agoric/ertp';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { makeGovernedTerms } from '../../src/lendingPool/params.js';
import { liquidationDetailTerms } from '@agoric/run-protocol/src/vaultFactory/liquidation.js';

const { details: X } = assert;

const COMPARE_CURRENCY_ISSUER_NAME = "USD";

const SECONDS_PER_HOUR = 60n * 60n;
const SECONDS_PER_DAY = 24n * SECONDS_PER_HOUR;

const BASIS_POINTS = 10_000n;

export const getPath = async (sourceRoot) => {
  const url = await importMetaResolve(sourceRoot, import.meta.url);
  return new URL(url).pathname;
};

export const setUpZoeForTest = (setJig = () => {
}) => {
  const { makeFar } = makeLoopback('zoeTest');

  const { zoeService, feeMintAccess: nonFarFeeMintAccess } = makeZoeKit(
    makeFakeVatAdmin(setJig).admin,
  );
  /** @type {ERef<ZoeService>} */
  const zoe = makeFar(zoeService);
  const feeMintAccess = makeFar(nonFarFeeMintAccess);
  return {
    zoe,
    feeMintAccess,
  };
};
harden(setUpZoeForTest);

export const installGovernance = (zoe, produce, bundles = undefined) => {
  if (bundles !== undefined) {
    produce.committee.resolve(E(zoe).install(bundles.committee));
    produce.contractGovernor.resolve(E(zoe).install(bundles.contractGovernor));
    produce.binaryVoteCounter.resolve(E(zoe).install(bundles.binaryVoteCounter));
  }
  produce.committee.resolve(E(zoe).install(committeeBundle));
  produce.contractGovernor.resolve(E(zoe).install(contractGovernorBundle));
  produce.binaryVoteCounter.resolve(E(zoe).install(binaryVoteCounterBundle));
};

export const setupBootstrap = (t, optTimer = undefined) => {
  const space = /** @type {any} */ (makePromiseSpace(t.log));
  const { produce, consume } =
    /** @type { import('../src/proposals/econ-behaviors.js').EconomyBootstrapPowers & BootstrapPowers } */ (
    space
  );

  const timer = optTimer || buildManualTimer(t.log);
  produce.chainTimerService.resolve(timer);

  const {
    zoe,
    compareCurrencyKit: { brand: usdBrand, issuer: usdIssuer },
  } = t.context;
  produce.zoe.resolve(zoe);

  const { agoricNames, agoricNamesAdmin, spaces } = makeAgoricNamesAccess();
  produce.agoricNames.resolve(agoricNames);
  produce.agoricNamesAdmin.resolve(agoricNamesAdmin);

  const { brand, issuer } = spaces;
  brand.produce.USD.resolve(usdBrand);
  issuer.produce.USD.resolve(usdIssuer);

  return { produce, consume, modules: { utils: { ...utils } }, ...spaces };
};

export const startEconomicCommittee = async (
  {
    consume: { zoe },
    produce: { economicCommitteeCreatorFacet },
    installation: {
      consume: { committee },
    },
    instance: {
      produce: { economicCommittee },
    },
  },
  { options: { econCommitteeOptions = {} } = {} },
) => {
  const {
    committeeName = 'Initial Economic Committee',
    committeeSize = 3,
    ...rest
  } = econCommitteeOptions;
  const { creatorFacet, instance } = await E(zoe).startInstance(
    committee,
    {},
    { committeeName, committeeSize, ...rest },
  );

  economicCommitteeCreatorFacet.resolve(creatorFacet);
  economicCommittee.resolve(instance);
};
harden(startEconomicCommittee);

/** @param { EconomyBootstrapPowers } powers */
export const setupAmm = async (
  {
    consume: {
      chainTimerService,
      zoe,
      economicCommitteeCreatorFacet: committeeCreator,
    },
    produce: { ammCreatorFacet, ammGovernorCreatorFacet },
    issuer: {
      consume: { [COMPARE_CURRENCY_ISSUER_NAME]: centralIssuer },
    },
    instance: {
      consume: { economicCommittee: electorateInstance },
      produce: { amm: ammInstanceProducer, ammGovernor },
    },
    installation: {
      consume: { contractGovernor: governorInstallation, amm: ammInstallation },
    },
  }) => {
  const poserInvitationP = E(committeeCreator).getPoserInvitation();
  const [poserInvitation, poserInvitationAmount] = await Promise.all([
    poserInvitationP,
    E(E(zoe).getInvitationIssuer()).getAmountOf(poserInvitationP),
  ]);

  const timer = await chainTimerService; // avoid promise for legibility

  const ammTerms = makeAmmTerms(timer, poserInvitationAmount);

  const ammGovernorTerms = {
    timer,
    electorateInstance,
    governedContractInstallation: ammInstallation,
    governed: {
      terms: ammTerms,
      issuerKeywordRecord: { Central: centralIssuer },
      privateArgs: { initialPoserInvitation: poserInvitation },
    },
  };
  const g = await E(zoe).startInstance(
    governorInstallation,
    {},
    ammGovernorTerms,
    { electorateCreatorFacet: committeeCreator },
  );

  const [creatorFacet, ammPublicFacet, instance] = await Promise.all([
    E(g.creatorFacet).getCreatorFacet(),
    E(g.creatorFacet).getPublicFacet(),
    E(g.publicFacet).getGovernedContract(),
  ]);
  ammGovernorCreatorFacet.resolve(g.creatorFacet);
  ammCreatorFacet.resolve(creatorFacet);

  // Confirm that the amm was indeed setup
  assert(ammPublicFacet, X`ammPublicFacet broken  ${ammPublicFacet}`);

  ammInstanceProducer.resolve(instance);
  ammGovernor.resolve(g.instance);
  return ammInstallation;
};

harden(setupAmm);

export const startLendingPool = async (
  {
    consume: {
      chainTimerService,
      priceManager: priceManagerP,
      zoe,
      economicCommitteeCreatorFacet: electorateCreatorFacet,
    },
    produce, // {  vaultFactoryCreator }
    brand: {
      consume: { [COMPARE_CURRENCY_ISSUER_NAME]: compareBrandP },
    },
    instance,
    installation: {
      consume: { LendingPool, liquidate, contractGovernor },
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

  const poserInvitationP = E(electorateCreatorFacet).getPoserInvitation();
  const [initialPoserInvitation, invitationAmount] = await Promise.all([
    poserInvitationP,
    E(E(zoe).getInvitationIssuer()).getAmountOf(poserInvitationP),
  ]);

  console.log("compareBrandP", compareBrandP)
  const compareBrand = await compareBrandP;

  /**
   * Types for the governed params for the vaultFactory; addVaultType() sets actual values
   *
   * @type {VaultManagerParamValues}
   */
  const poolManagerParams = {
    // XXX the values aren't used. May be addressed by https://github.com/Agoric/agoric-sdk/issues/4861
    liquidationMargin: makeRatio(0n, compareBrand),
    interestRate: makeRatio(0n, compareBrand, BASIS_POINTS),
    loanFee: makeRatio(0n, compareBrand, BASIS_POINTS),
    initialExchangeRate: makeRatio(0n, compareBrand, BASIS_POINTS),
    baseRate: makeRatio(0n, compareBrand, BASIS_POINTS),
    multiplierRate: makeRatio(0n, compareBrand, BASIS_POINTS),
  };

  const [
    ammInstance,
    electorateInstance,
    contractGovernorInstall,
  ] = await Promise.all([
    instance.consume.amm,
    instance.consume.economicCommittee,
    contractGovernor,
  ]);
  const ammPublicFacet = await E(zoe).getPublicFacet(ammInstance);
  const priceManager = await priceManagerP;
  const timer = await chainTimerService;

  const vaultFactoryTerms = makeGovernedTerms(
    priceManager, // priceMan here
    loanParams,
    installations.liquidate,
    timer,
    invitationAmount,
    poolManagerParams,
    ammPublicFacet,
    undefined,
    compareBrand
  );
  // console.log("vaultFactoryTerms", vaultFactoryTerms)
  const governorTerms = harden({
    timer,
    electorateInstance,
    governedContractInstallation: installations.LendingPool,
    governed: {
      terms: vaultFactoryTerms,
      issuerKeywordRecord: {},
      privateArgs: harden({ initialPoserInvitation }),
    },
  });
  const { creatorFacet: governorCreatorFacet, instance: governorInstance } =
    await E(zoe).startInstance(
      contractGovernorInstall,
      undefined,
      governorTerms,
      harden({ electorateCreatorFacet }),
    );

  const [lendingPoolInstance, lendingPoolCreator] = await Promise.all([
    E(governorCreatorFacet).getInstance(),
    E(governorCreatorFacet).getCreatorFacet(),
  ]);

  const voteCreator = Far('lendingPool vote creator', {
    voteOnParamChanges: E(governorCreatorFacet).voteOnParamChanges,
  });

  produce.lendingPoolCreator.resolve(lendingPoolCreator);
  produce.lendingPoolGovernorCreator.resolve(governorCreatorFacet);
  produce.lendingPoolVoteCreator.resolve(voteCreator);

  // Advertise the installations, instances in agoricNames.
  instance.produce.lendingPool.resolve(lendingPoolInstance);
  instance.produce.lendingPoolGovernor.resolve(governorInstance);
};

harden(startLendingPool)

export const setupAmmAndElectorate = async (
  t,
  vanLiquidity,
  compLiquidityPoolVan,
  panLiquidity,
  compLiquidityPoolPan) => {
  const {
    zoe,
    vanKit: { issuer: vanIssuer },
    panKit: { issuer: panIssuer },
    electorateTerms = { committeeName: 'The Cabal', committeeSize: 1 },
    timer,
  } = t.context;

  const space = setupBootstrap(t, timer);
  const { consume, instance } = space;
  installGovernance(zoe, space.installation.produce);
  space.installation.produce.amm.resolve(t.context.installation.amm);
  await startEconomicCommittee(space, electorateTerms);
  await setupAmm(space);

  const governorCreatorFacet = consume.ammGovernorCreatorFacet;
  const governorInstance = await instance.consume.ammGovernor;
  const governorPublicFacet = await E(zoe).getPublicFacet(governorInstance);
  const governedInstance = E(governorPublicFacet).getGovernedContract();

  /** @type { GovernedPublicFacet<XYKAMMPublicFacet> } */
    // @ts-expect-error cast from unknown
  const ammPublicFacet = await E(governorCreatorFacet).getPublicFacet();

  // Add VAN/USD Pool
  const vanLiquidityIssuer = E(ammPublicFacet).addPool(vanIssuer, 'VAN');
  const vanLiquidityBrand = await E(vanLiquidityIssuer).getBrand();

  // Add PAN/USD Pool
  const panLiquidityIssuer = E(ammPublicFacet).addPool(panIssuer, 'PAN');
  const panLiquidityBrand = await E(panLiquidityIssuer).getBrand();

  const vanPoolLiqProposal = harden({
    give: {
      Secondary: vanLiquidity.proposal,
      Central: compLiquidityPoolVan.proposal,
    },
    want: { Liquidity: AmountMath.makeEmpty(vanLiquidityBrand) },
  });
  const vanPoolAddLiqInvitation = await E(ammPublicFacet).makeAddLiquidityInvitation();

  const vanPoolAddLiquiditySeat = await E(zoe).offer(
    vanPoolAddLiqInvitation,
    vanPoolLiqProposal,
    harden({
      Secondary: vanLiquidity.payment,
      Central: compLiquidityPoolVan.payment,
    }),
  );

  const panPoolLiqProposal = harden({
    give: {
      Secondary: panLiquidity.proposal,
      Central: compLiquidityPoolPan.proposal,
    },
    want: { Liquidity: AmountMath.makeEmpty(panLiquidityBrand) },
  });
  const panPoolAddLiqInvitation = await E(ammPublicFacet).makeAddLiquidityInvitation();

  const panPoolAddLiquiditySeat = await E(zoe).offer(
    panPoolAddLiqInvitation,
    panPoolLiqProposal,
    harden({
      Secondary: panLiquidity.payment,
      Central: compLiquidityPoolPan.payment,
    }),
  );

  // TODO get the creator directly
  const newAmm = {
    ammCreatorFacet: await consume.ammCreatorFacet,
    ammPublicFacet,
    instance: governedInstance,
    ammVanPoolLiquidity: E(vanPoolAddLiquiditySeat).getPayout('Liquidity'),
    ammPanPoolLiquidity: E(panPoolAddLiquiditySeat).getPayout('Liquidity'),
  };

  return { amm: newAmm, space };
};

harden(setupAmmAndElectorate);
