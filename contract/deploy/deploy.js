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
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import { SECONDS_PER_YEAR } from '../src/interest.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import buildManualTimer from '@agoric/zoe/tools/manualTimer.js';
import { makeScriptedPriceAuthority } from '@agoric/zoe/tools/scriptedPriceAuthority.js';

const contractRoots = {
  lendingPoolFaucet: './lendingPoolFaucet.js',
  priceAuthorityFaucet: './priceAuthorityFaucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  priceManagerContract: '../../src/lendingPool/priceManagerContract.js',
  amm: '@agoric/run-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js',
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

  const home = await homePromise;
  const board = home.board;
  const zoe = home.zoe;
  const wallet = home.wallet;
  const timer = home.localTimerService;

  const secondsPerDay = SECONDS_PER_YEAR / 365n;

  const bundles = await Collect.allValues({
    lendingPoolFaucet: makeBundle(bundleSource, contractRoots.lendingPoolFaucet),
    priceAuthorityFaucet: makeBundle(bundleSource, contractRoots.priceAuthorityFaucet),
    liquidate: makeBundle(bundleSource, contractRoots.liquidate),
    LendingPool: makeBundle(bundleSource, contractRoots.LendingPool),
    priceManagerContract: makeBundle(bundleSource, contractRoots.priceManagerContract),
    amm: makeBundle(bundleSource, contractRoots.amm),
  });

  const contractInstallations = Collect.mapValues(bundles, bundle =>
    E(zoe).install(bundle),
  );

  const {
    vanAsset,
    panAsset,
    usdAsset,
    priceAuthorityFaucet,
    installations,
  } = await startFaucets(zoe, contractInstallations);

  // get issuers and brands
  const vanIssuer = await E(vanAsset.publicFacet).getIssuer();
  const vanBrand = await E(vanIssuer).getBrand();

  const panIssuer = await E(panAsset.publicFacet).getIssuer();
  const panBrand = await E(panIssuer).getBrand();

  const usdIssuer = await E(usdAsset.publicFacet).getIssuer();
  const usdBrand = await E(usdIssuer).getBrand();

  const vanUsdPriceAuthority = await E(priceAuthorityFaucet.creatorFacet).makeScriptedPriceAuthority({
    actualBrandIn: vanBrand,
    actualBrandOut: usdBrand,
    priceList: [110n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(vanBrand, 100n),
    quoteInterval: 7n,
  });

  const panUsdPriceAuthority = await E(priceAuthorityFaucet.creatorFacet).makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: 7n,
  });

  const priceManInstallation = await contractInstallations.priceManagerContract;

  const {
    priceAuthorityManagerPublicFacet: priceManager,
    priceAuthorityManagerInstance,
  } = await startPriceManager(zoe, priceManInstallation);

  // get liquidity
  const vanLiquidity = await getLiquidityFromFaucet(zoe, E(vanAsset.creatorFacet).makeFaucetInvitation(), 5n, vanBrand, 'VAN');
  const vanLiquidityAmount = await E(vanIssuer).getAmountOf(vanLiquidity);

  const panLiquidity = await getLiquidityFromFaucet(zoe, E(panAsset.creatorFacet).makeFaucetInvitation(), 5n, panBrand, 'PAN');
  const panLiquidityAmount = await E(panIssuer).getAmountOf(panLiquidity);

  const usdLiquidity = await getLiquidityFromFaucet(zoe, E(usdAsset.creatorFacet).makeFaucetInvitation(), 5n, usdBrand, 'USD');
  const usdLiquidityAmount = await E(usdIssuer).getAmountOf(usdLiquidity);

  const usdPanLiquidity = await getLiquidityFromFaucet(zoe, E(usdAsset.creatorFacet).makeFaucetInvitation(), 5n, usdBrand, 'USD');
  const usdPanLiquidityAmount = await E(usdIssuer).getAmountOf(usdPanLiquidity);


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

  const {
    space,
    lendingPool: { lendingPoolCreatorFacet, lendingPoolPublicFacet, lendingPoolInstance },
  } = await setupServices(params, timer);

  // Make the rates for the pools
  const vanPoolRates = makeRates(vanBrand, usdBrand);
  const panPoolRates = makeRates(panBrand, usdBrand);

  console.log('lendingPoolCreatorFacet', lendingPoolCreatorFacet);

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanPoolRates, lendingPoolCreatorFacet, vanIssuer, 'VAN', vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panPoolRates, lendingPoolCreatorFacet, panIssuer, 'PAN', panUsdPriceAuthority);

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(vanPoolMan).getProtocolBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(panPoolMan).getProtocolBrand();

  console.log('agVanIssuer', agVanIssuer);
  console.log('agPanIssuer', agPanIssuer);

  const [
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_INSTALL_BOARD_ID,
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
  ] = await Promise.all([
    E(board).getId(lendingPoolInstance),
    E(board).getId(await contractInstallations.LendingPool),
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
  ]);

  const walletBridge = await E(wallet).getBridge();
  await E(walletBridge).suggestIssuer('VAN Purse', VAN_ISSUER_BOARD_ID);
  await E(walletBridge).suggestIssuer('PAN Purse', PAN_ISSUER_BOARD_ID);
  await E(walletBridge).suggestIssuer('AgVAN Purse', AGVAN_ISSUER_BOARD_ID);
  await E(walletBridge).suggestIssuer('AgPAN Purse', AGPAN_ISSUER_BOARD_ID);

  let vanLiqInvitation = await E(vanAsset.creatorFacet).makeFaucetInvitation();

  const vanLiquidityOfferConfig = {
    id: `${Date.now()}`,
    invitation: vanLiqInvitation,
    installationHandleBoardId: LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
    instanceHandleBoardId: VAN_ASSET_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {},
      want: {
        VAN: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'VAN Purse',
          value: 5n * 10n ** 8n,
        },
      },
    },
  };

  const vanLiquidityOfferID = await E(walletBridge).addOffer(vanLiquidityOfferConfig);

  let panLiqInvitation = await E(panAsset.creatorFacet).makeFaucetInvitation();

  const panLiquidityOfferConfig = {
    id: `${Date.now()}`,
    invitation: panLiqInvitation,
    installationHandleBoardId: LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
    instanceHandleBoardId: PAN_ASSET_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {},
      want: {
        PAN: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'PAN Purse',
          value: 10n * 10n ** 8n,
        },
      },
    },
  };

  const panLiquidityOfferID = await E(walletBridge).addOffer(panLiquidityOfferConfig);

  const depositVanOfferConfig = {
    id: `${Date.now()}`,
    invitation: E(vanPoolMan).makeDepositInvitation(),
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        Protocol: {
          // The pursePetname identifies which purse we want to uselib
          pursePetname: 'AgVAN Purse',
          value: 5n * 10n ** 8n * 50n,
        },
      },
      give: {
        Underlying: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'VAN Purse',
          value: 5n * 10n ** 8n,
        },
      },
    },
  };

  console.log('depositVanOfferConfig', depositVanOfferConfig);
  const depositVanfferID = await E(walletBridge).addOffer(depositVanOfferConfig);

  const depositPanOfferConfig = {
    id: `${Date.now()}`,
    invitation: E(panPoolMan).makeDepositInvitation(),
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        Protocol: {
          // The pursePetname identifies which purse we want to uselib
          pursePetname: 'AgPAN Purse',
          value: 10n * 10n ** 8n * 50n,
        },
      },
      give: {
        Underlying: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'PAN Purse',
          value: 10n * 10n ** 8n,
        },
      },
    },
  };

  console.log('depositPanOfferConfig', depositPanOfferConfig);
  const depositPanOfferID = await E(walletBridge).addOffer(depositPanOfferConfig);

  // const borrowPanOfferConfig = {
  //   id: `${Date.now()}`,
  //   invitation: E(lendingPoolPublicFacet).makeBorrowInvitation(),
  //   installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
  //   instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
  //   proposalTemplate: {
  //     want: {
  //       Debt: {
  //         // The pursePetname identifies which purse we want to uselib
  //         pursePetname: 'PAN Purse',
  //         value: 4n * 10n ** 6n,
  //       },
  //     },
  //     give: {
  //       Collateral: {
  //         // The pursePetname identifies which purse we want to use
  //         pursePetname: 'AgVAN Purse',
  //         value: 1n * 10n ** 8n * 50n,
  //       },
  //     },
  //     arguments: {
  //       collateralUnderlyingBrand: vanBrand,
  //     },
  //   },
  // };
  //
  // console.log('borrowPanOfferConfig', borrowPanOfferConfig);
  // const borrowPanOfferID = await E(walletBridge).addOffer(borrowPanOfferConfig);

  console.log(`-- LENDING_POOL_INSTANCE_BOARD_ID: ${LENDING_POOL_INSTANCE_BOARD_ID} --`);
  console.log(`-- LENDING_POOL_INSTALL_BOARD_ID: ${LENDING_POOL_INSTALL_BOARD_ID} --`);
  console.log(`-- VAN_ASSET_INSTANCE_BOARD_ID: ${VAN_ASSET_INSTANCE_BOARD_ID} --`);
  console.log(`-- PAN_ASSET_INSTANCE_BOARD_ID: ${PAN_ASSET_INSTANCE_BOARD_ID} --`);
  console.log(`-- USD_ASSET_INSTANCE_BOARD_ID: ${USD_ASSET_INSTANCE_BOARD_ID} --`);
  console.log(`-- PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID: ${PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID} --`);
  console.log(`-- VAN_ISSUER_BOARD_ID: ${VAN_ISSUER_BOARD_ID} --`);
  console.log(`-- PAN_ISSUER_BOARD_ID: ${PAN_ISSUER_BOARD_ID} --`);
  console.log(`-- USD_ISSUER_BOARD_ID: ${USD_ISSUER_BOARD_ID} --`);
  console.log(`-- AGVAN_ISSUER_BOARD_ID: ${AGVAN_ISSUER_BOARD_ID} --`);
  console.log(`-- AGPAN_ISSUER_BOARD_ID: ${AGPAN_ISSUER_BOARD_ID} --`);
  console.log(`-- PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID: ${PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID} --`);
  console.log(`-- LENDING_POOL_FAUCET_INSTALL_BOARD_ID: ${LENDING_POOL_FAUCET_INSTALL_BOARD_ID} --`);
  console.log(`-- VAN_LIQUIDITY_OFFER_ID: ${vanLiquidityOfferID} --`);
  console.log(`-- PAN_LIQUIDITY_OFFER_ID: ${panLiquidityOfferID} --`);
  console.log(`-- DEPOSIT_VAN_OFFER_ID: ${depositVanfferID} --`);
  console.log(`-- DEPOSIT_PAN_OFFER_ID: ${depositPanOfferID} --`);
  console.log(`-- PRICE_MANAGER_INSTANCE_BOARD_ID: ${PRICE_MANAGER_INSTANCE_BOARD_ID} --`);
  // console.log(`-- BORROW_PAN_OFFER_ID: ${borrowPanOfferID} --`);
}