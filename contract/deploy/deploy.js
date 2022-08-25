// @ts-check

import '@agoric/zoe/exported.js';
import {
  startLendingPool,
  setupAmmAndElectorate,
} from '../test/lendingPool/setup.js';
import { E } from '@agoric/eventual-send';
import '@agoric/zoe/src/contractSupport/index.js';
import {
  addPool,
  makeRates,
  makeBundle,
  getLiquidityFromFaucet,
  startPriceManager,
} from '../test/lendingPool/helpers.js';
import { startFaucets } from '../test/lendingPool/helpers.js';
import { SECONDS_PER_YEAR } from '../src/interest.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import fs from 'fs';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';

const contractRoots = {
  lendingPoolFaucet: './lendingPoolFaucet.js',
  priceAuthorityFaucet: './priceAuthorityFaucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  priceManagerContract: '../../src/lendingPool/priceManagerContract.js',
  amm: '@agoric/run-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js',
  manualTimerFaucet: './manualTimerFaucet.js'
};

async function setupServices(
  t,
  timer = buildManualTimer(console.log),
) {
  const {
    zoe,
    loanTiming,
    vanInitialLiquidity,
    compareInitialLiquidity,
    panInitialLiquidity,
    usdPanInitialLiquidity,
    priceManager,
  } = t.context;
  t.context.timer = timer;

  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    t,
    vanInitialLiquidity,
    compareInitialLiquidity,
    panInitialLiquidity,
    usdPanInitialLiquidity
  );
  const { consume, produce, instance } = space;
  // trace(t, 'amm', { ammFacets });

  const {
    installation: { produce: iProduce },
  } = space;
  iProduce.LendingPool.resolve(t.context.installation.LendingPool);
  iProduce.liquidate.resolve(t.context.installation.liquidate);
  produce.priceManager.resolve(priceManager);

  await startLendingPool(space, { loanParams: loanTiming });

  const governorCreatorFacet = consume.lendingPoolGovernorCreator;
  /** @type {Promise<LoanFactory & LimitedCreatorFacet<any>>} */
  const lendingPoolCreatorFacetP = /** @type { any } */ (
    E(governorCreatorFacet).getCreatorFacet()
  );

  /** @type {[any, LoanFactory, VFC['publicFacet'], PoolManager, PriceAuthority]} */
    // @ts-expect-error cast
  const [
      governorInstance,
      lendingPoolCreatorFacet,
      lendingPoolInstance,
      lendingPoolPublicFacet,
    ] = await Promise.all([
      instance.consume.lendingPoolGovernor,
      lendingPoolCreatorFacetP,
      instance.consume.lendingPool,
      E(governorCreatorFacet).getPublicFacet(),
    ]);
  // trace(t, { governorInstance, lendingPoolCreatorFacet, lendingPoolPublicFacet });

  const { g, l } = {
    g: {
      governorInstance,
      governorPublicFacet: E(zoe).getPublicFacet(governorInstance),
      governorCreatorFacet,
    },
    l: {
      lendingPoolCreatorFacet,
      lendingPoolPublicFacet,
      lendingPoolInstance,
    },
  };

  return {
    zoe,
    governor: g,
    lendingPool: l,
    ammFacets,
    timer,
    space,
  };
}

/**
 * Here we deploy the actual LendingPool contract along with other contracts that
 * LendingPool either is dependent on(amm) or needs to create the context for
 * demonstration.
 *
 * After we set things up, we send some offers to the wallet to demonstrate the functionality and
 * testing purposes. There's a plan for more sophisticated set of deploy scripts so the logic
 * here might deprecate soon.
 *
 *
 */
export default async function deployContract(
  homePromise,
  { bundleSource, pathResolve },
) {
  const secondsPerDay = SECONDS_PER_YEAR / 365n;

  const home = await homePromise;
  const board = home.board;
  const zoe = home.zoe;
  const wallet = home.wallet;

  console.log('Bundling contracts...');
  const bundles = await Collect.allValues({
    lendingPoolFaucet: makeBundle(bundleSource, contractRoots.lendingPoolFaucet),
    priceAuthorityFaucet: makeBundle(bundleSource, contractRoots.priceAuthorityFaucet),
    liquidate: makeBundle(bundleSource, contractRoots.liquidate),
    LendingPool: makeBundle(bundleSource, contractRoots.LendingPool),
    priceManagerContract: makeBundle(bundleSource, contractRoots.priceManagerContract),
    amm: makeBundle(bundleSource, contractRoots.amm),
    manualTimerFaucet: makeBundle(bundleSource, contractRoots.manualTimerFaucet)
  });

  const contractInstallations = Collect.mapValues(bundles, bundle =>
    E(zoe).install(bundle),
  );

  console.log('Starting faucets...');
  const {
    vanAsset,
    panAsset,
    usdAsset,
    priceAuthorityFaucet,
    manualTimerFaucet,
  } = await startFaucets(zoe, contractInstallations);

  console.log('Getting faucet issuers...');
  const [vanIssuer, panIssuer, usdIssuer] = await Promise.all([
    E(vanAsset.publicFacet).getIssuer(),
    E(panAsset.publicFacet).getIssuer(),
    E(usdAsset.publicFacet).getIssuer(),
  ]);

  console.log('Getting faucet brands...');
  const [vanBrand, panBrand, usdBrand] = await Promise.all([
    E(vanIssuer).getBrand(),
    E(panIssuer).getBrand(),
    E(usdIssuer).getBrand(),
  ]);

  console.log('Building timer...');
  const timer = process.env.USE_MANUAL_TIMER ? await E(manualTimerFaucet.creatorFacet).makeManualTimer({
    startValue: 0n,
    timeStep: secondsPerDay * 7n,
  }) : home.localTimerService;

  console.log('Making priceAuthorities...');
  const [vanUsdPriceAuthority, panUsdPriceAuthority] = await Promise.all([
    E(priceAuthorityFaucet.creatorFacet).makeManualPriceAuthority({
      actualBrandIn: vanBrand,
      actualBrandOut: usdBrand,
      initialPrice: makeRatio(110n * 10n ** 6n, usdBrand, 10n ** 8n, vanBrand),
      timer
    }),
    E(priceAuthorityFaucet.creatorFacet).makeManualPriceAuthority({
      actualBrandIn: panBrand,
      actualBrandOut: usdBrand,
      initialPrice: makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, panBrand),
      timer,
    })
  ]);

  console.log('Waiting for priceManager installation...');
  const priceManInstallation = await contractInstallations.priceManagerContract;

  console.log('Starting priceManager...');
  const {
    priceAuthorityManagerPublicFacet: priceManager,
    priceAuthorityManagerInstance,
  } = await startPriceManager(zoe, priceManInstallation);

  console.log('Getting liquidity from faucets...');
  const [vanLiquidity, panLiquidity, usdLiquidity, usdPanLiquidity] = await Promise.all([
    getLiquidityFromFaucet(zoe, E(vanAsset.creatorFacet).makeFaucetInvitation(), 100n, vanBrand, 'VAN'),
    getLiquidityFromFaucet(zoe, E(panAsset.creatorFacet).makeFaucetInvitation(), 100n, panBrand, 'PAN'),
    getLiquidityFromFaucet(zoe, E(usdAsset.creatorFacet).makeFaucetInvitation(), 110n * 100n, usdBrand, 'USD'), // make VAN/USD AMM price consistant with priceAuthority
    getLiquidityFromFaucet(zoe, E(usdAsset.creatorFacet).makeFaucetInvitation(), 200n * 100n, usdBrand, 'USD'), // make PAN/USD AMM price consistant with priceAuthority
  ]);

  console.log('Getting liquidity amounts...');
  const [vanLiquidityAmount, panLiquidityAmount, usdLiquidityAmount, usdPanLiquidityAmount] = await Promise.all([
    E(vanIssuer).getAmountOf(vanLiquidity),
    E(panIssuer).getAmountOf(panLiquidity),
    E(usdIssuer).getAmountOf(usdLiquidity),
    E(usdIssuer).getAmountOf(usdPanLiquidity),
  ]);

  console.log('vanLiquidity', vanLiquidity);
  console.log('vanLiquidityAmount', vanLiquidityAmount);
  console.log('panLiquidity', panLiquidity);
  console.log('panLiquidityAmount', panLiquidityAmount);
  console.log('usdLiquidity', usdLiquidity);
  console.log('usdLiquidityAmount', usdLiquidityAmount);
  console.log('usdPanLiquidity', usdPanLiquidity);
  console.log('usdPanLiquidityAmount', usdPanLiquidityAmount);

  const vanLiquidityAMM = {
    proposal: harden(vanLiquidityAmount),
    payment: vanLiquidity,
  };

  const panLiquidityAMM = {
    proposal: harden(panLiquidityAmount),
    payment: panLiquidity,
  };

  const usdLiquidityAMM = {
    proposal: harden(usdLiquidityAmount),
    payment: usdLiquidity,
  };

  const usdPanLiquidityAMM = {
    proposal: harden(usdPanLiquidityAmount),
    payment: usdPanLiquidity,
  };

  const loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n,
  };

  const electorateTerms = { committeeName: 'TheCabal', committeeSize: 5 };

  const params = {};
  params.context = {
    zoe,
    compareCurrencyKit: { issuer: usdIssuer, brand: usdBrand },
    vanKit: { issuer: vanIssuer, brand: vanBrand },
    panKit: { issuer: panIssuer, brand: panBrand },
    loanTiming,
    vanInitialLiquidity: vanLiquidityAMM,
    compareInitialLiquidity: usdLiquidityAMM,
    panInitialLiquidity: panLiquidityAMM,
    usdPanInitialLiquidity: usdPanLiquidityAMM,
    electorateTerms,
    priceManager,
    installation: contractInstallations,
  };

  console.log('Setting up sevices...');
  const {
    space,
    lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet, lendingPoolInstance },
    ammFacets: { instance: ammInstance },
  } = await setupServices(params, timer);

  // Make the rates for the pools
  const vanPoolRates = makeRates(vanBrand, usdBrand);
  const panPoolRates = makeRates(panBrand, usdBrand);

  console.log('lendingPoolCreatorFacet', lendingPoolCreatorFacet);

  console.log('Adding pools to LendingPool protocol...');
  const [vanPoolMan, panPoolMan] = await Promise.all([
    addPool(zoe, vanPoolRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority),
    addPool(zoe, panPoolRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority)
  ]);

  console.log('Getting brand and issuer objects for protocolTokens...');
  const [agVanIssuer, agVanBrand, agPanIssuer, agPanBrand] = await Promise.all([
    E(vanPoolMan).getProtocolIssuer(),
    E(vanPoolMan).getProtocolBrand(),
    E(panPoolMan).getProtocolIssuer(),
    E(panPoolMan).getProtocolBrand(),
  ]);

  console.log('Putting stuff to board...');
  const [
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_INSTALL_BOARD_ID,
    AMM_INSTANCE_BOARD_ID,
    VAN_ASSET_INSTANCE_BOARD_ID,
    PAN_ASSET_INSTANCE_BOARD_ID,
    USD_ASSET_INSTANCE_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    USD_ISSUER_BOARD_ID,
    AGVAN_ISSUER_BOARD_ID,
    AGPAN_ISSUER_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID,
    LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
    PRICE_MANAGER_INSTANCE_BOARD_ID,
    walletBridge,
  ] = await Promise.all([
    E(board).getId(lendingPoolInstance),
    E(board).getId(await contractInstallations.LendingPool),
    E(board).getId(ammInstance),
    E(board).getId(vanAsset.instance),
    E(board).getId(panAsset.instance),
    E(board).getId(usdAsset.instance),
    E(board).getId(priceAuthorityFaucet.instance),
    E(board).getId(vanIssuer),
    E(board).getId(panIssuer),
    E(board).getId(usdIssuer),
    E(board).getId(agVanIssuer),
    E(board).getId(agPanIssuer),
    E(board).getId(await contractInstallations.priceAuthorityFaucet),
    E(board).getId(await contractInstallations.lendingPoolFaucet),
    E(board).getId(priceAuthorityManagerInstance),
    E(wallet).getBridge(),
  ]);

  console.log('Putting private stuff to scratch...');
  const [
    VAN_ASSET_CREATOR_FACET_ID,
    PAN_ASSET_CREATOR_FACET_ID,
    USD_ASSET_CREATOR_FACET_ID,
    TIMER_ID,
    VAN_USD_PRICE_AUTH_ID,
    PAN_USD_PRICE_AUTH_ID,
    LENDING_POOL_CREATOR_FACET_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
  ] = await Promise.all(
    [
      E(home.scratch).set('van_asset_creator_facet_id', vanAsset.creatorFacet),
      E(home.scratch).set('pan_asset_creator_facet_id', panAsset.creatorFacet),
      E(home.scratch).set('usd_asset_creator_facet_id', usdAsset.creatorFacet),
      E(home.scratch).set('timer_id', timer),
      E(home.scratch).set('van_usd_price_auth_id', vanUsdPriceAuthority),
      E(home.scratch).set('pan_usd_price_auth_id', panUsdPriceAuthority),
      E(home.scratch).set('lending_pool_creator_facet_id', lendingPoolCreatorFacet),
      E(home.scratch).set('price_authority_faucet_creator_facet_id', priceAuthorityFaucet.creatorFacet),
    ],
  );

  console.log(`-- LENDING_POOL_INSTANCE_BOARD_ID: ${LENDING_POOL_INSTANCE_BOARD_ID} --`);
  console.log(`-- LENDING_POOL_INSTALL_BOARD_ID: ${LENDING_POOL_INSTALL_BOARD_ID} --`);
  console.log(`-- LENDING_POOLCREATOR_FACET_ID: ${LENDING_POOL_CREATOR_FACET_ID} --`);
  console.log(`-- AMM_INSTANCE_BOARD_ID: ${AMM_INSTANCE_BOARD_ID} --`);
  console.log(`-- VAN_ASSET_INSTANCE_BOARD_ID: ${VAN_ASSET_INSTANCE_BOARD_ID} --`);
  console.log(`-- PAN_ASSET_INSTANCE_BOARD_ID: ${PAN_ASSET_INSTANCE_BOARD_ID} --`);
  console.log(`-- USD_ASSET_INSTANCE_BOARD_ID: ${USD_ASSET_INSTANCE_BOARD_ID} --`);
  console.log(`-- PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID: ${PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID} --`);
  console.log(`-- PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID: ${PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID} --`);
  console.log(`-- VAN_ISSUER_BOARD_ID: ${VAN_ISSUER_BOARD_ID} --`);
  console.log(`-- PAN_ISSUER_BOARD_ID: ${PAN_ISSUER_BOARD_ID} --`);
  console.log(`-- USD_ISSUER_BOARD_ID: ${USD_ISSUER_BOARD_ID} --`);
  console.log(`-- AGVAN_ISSUER_BOARD_ID: ${AGVAN_ISSUER_BOARD_ID} --`);
  console.log(`-- AGPAN_ISSUER_BOARD_ID: ${AGPAN_ISSUER_BOARD_ID} --`);
  console.log(`-- PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID: ${PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID} --`);
  console.log(`-- LENDING_POOL_FAUCET_INSTALL_BOARD_ID: ${LENDING_POOL_FAUCET_INSTALL_BOARD_ID} --`);
  console.log(`-- PRICE_MANAGER_INSTANCE_BOARD_ID: ${PRICE_MANAGER_INSTANCE_BOARD_ID} --`);
  console.log(`-- VAN_ASSET_CREATOR_FACET_ID: ${VAN_ASSET_CREATOR_FACET_ID} --`);
  console.log(`-- PAN_ASSET_CREATOR_FACET_ID: ${PAN_ASSET_CREATOR_FACET_ID} --`);
  console.log(`-- USD_ASSET_CREATOR_FACET_ID: ${USD_ASSET_CREATOR_FACET_ID} --`);
  console.log(`-- VAN_USD_PRICE_AUTH_ID: ${VAN_USD_PRICE_AUTH_ID} --`);
  console.log(`-- PAN_USD_PRICE_AUTH_ID: ${PAN_USD_PRICE_AUTH_ID} --`);
  console.log(`-- TIMER_ID: ${TIMER_ID} --`);

  const dappConstants = {
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_INSTALL_BOARD_ID,
    LENDING_POOL_CREATOR_FACET_ID,
    AMM_INSTANCE_BOARD_ID,
    VAN_ASSET_INSTANCE_BOARD_ID,
    PAN_ASSET_INSTANCE_BOARD_ID,
    USD_ASSET_INSTANCE_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    USD_ISSUER_BOARD_ID,
    AGVAN_ISSUER_BOARD_ID,
    AGPAN_ISSUER_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
    LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
    PRICE_MANAGER_INSTANCE_BOARD_ID,
    VAN_ASSET_CREATOR_FACET_ID,
    PAN_ASSET_CREATOR_FACET_ID,
    USD_ASSET_CREATOR_FACET_ID,
    TIMER_ID,
    VAN_USD_PRICE_AUTH_ID,
    PAN_USD_PRICE_AUTH_ID
  };
  const defaultsFile = pathResolve(`../../ui/src/generated/lendingPoolDefaults.js`);
  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./deploy.js')}
export default ${JSON.stringify(dappConstants, undefined, 2)};
`;

  await fs.promises.writeFile(defaultsFile, defaultsContents);
}