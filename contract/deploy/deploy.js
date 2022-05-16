// @ts-check

import '@agoric/zoe/exported.js';
import {
  setUpZoeForTest,
  setupAmmServices,
} from '../test/lendingPool/setup.js';
import { E } from '@agoric/eventual-send';
import '@agoric/zoe/src/contractSupport/index.js';
import { depositMoney, addPool, makeRates, setupAssets, makeBundle, getLiquidityFromFaucet, startPriceManager } from '../test/lendingPool/helpers.js';
import { makePriceManager } from '../src/lendingPool/priceManager.js';
import { startLendingPool, startFaucets } from '../test/lendingPool/helpers.js';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import { SECONDS_PER_YEAR } from '../src/interest.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
const contractRoots = {
  lendingPoolFaucet: './lendingPoolFaucet.js',
  priceAuthorityFaucet: './priceAuthorityFaucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
  priceManagerContract: '../../src/lendingPool/priceManagerContract.js',
};

const setupAmmAndElectorate = async (timer,
                               zoe,
                               vanLiquidity,
                               usdLiquidity,
                               usdIssuer,
                               vanIssuer,
                               electorateTerms) => {

  const usdBrand = await E(usdIssuer).getBrand();
  const centralR = { issuer: usdIssuer, brand: usdBrand };



  const {
    amm,
    committeeCreator,
    governor,
    invitationAmount,
    electorateInstance,
    space,
  } = await setupAmmServices(electorateTerms, centralR, timer, zoe);

  const liquidityIssuer = E(amm.ammPublicFacet).addPool(vanIssuer, 'VAN');
  const liquidityBrand = await E(liquidityIssuer).getBrand();

  const liqProposal = harden({
    give: {
      Secondary: vanLiquidity.proposal,
      Central: usdLiquidity.proposal,
    },
    want: { Liquidity: AmountMath.makeEmpty(liquidityBrand) },
  });
  const liqInvitation = await E(
    amm.ammPublicFacet,
  ).makeAddLiquidityInvitation();

  console.log("liqProposal", liqProposal);

  const ammLiquiditySeat = await E(zoe).offer(
    liqInvitation,
    liqProposal,
    harden({
      Secondary: vanLiquidity.payment,
      Central: usdLiquidity.payment,
    }),
  );

  const newAmm = {
    ammCreatorFacet: amm.ammCreatorFacet,
    ammPublicFacet: amm.ammPublicFacet,
    instance: amm.governedInstance,
    ammLiquidity: E(ammLiquiditySeat).getPayout('Liquidity'),
  };

  return {
    governor,
    amm: newAmm,
    committeeCreator,
    electorateInstance,
    invitationAmount,
    space,
  };
};

/**
 * What we need to deploy the lendingPool contract
 * zoe: home.zoe
 * timer: home.TimerService
 * quoteMint: makeIssuerKit?
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

  const bundlePs = {
    lendingPoolFaucet: makeBundle(bundleSource, contractRoots.lendingPoolFaucet),
    priceAuthorityFaucet: makeBundle(bundleSource, contractRoots.priceAuthorityFaucet),
    liquidate: makeBundle(bundleSource, contractRoots.liquidate),
    LendingPool: makeBundle(bundleSource, contractRoots.LendingPool),
    priceManagerContract: makeBundle(bundleSource, contractRoots.priceManagerContract),
  };

  const faucetBundles = await Collect.allValues({
    lendingPoolFaucet: bundlePs.lendingPoolFaucet,
    priceAuthorityFaucet: bundlePs.priceAuthorityFaucet,
  });

  const { vanAsset, panAsset, usdAsset, priceAuthorityFaucet, installations } = await startFaucets(zoe, faucetBundles);

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
    quoteInterval: secondsPerDay * 7n
  });

  const panUsdPriceAuthority = await E(priceAuthorityFaucet.creatorFacet).makeScriptedPriceAuthority({
    actualBrandIn: panBrand,
    actualBrandOut: usdBrand,
    priceList: [200n],
    timer,
    undefined,
    unitAmountIn: AmountMath.make(panBrand, 100n),
    quoteInterval: secondsPerDay * 7n,
  });

  const priceManBundle = await Collect.allValues({
    priceManagerContract: bundlePs.priceManagerContract,
  });

  const { priceAuthorityManagerPublicFacet: priceManager, priceAuthorityManagerInstance } = await startPriceManager(zoe, priceManBundle);

  // console.log("vanUsdPriceAuthority", vanUsdPriceAuthority);
  // console.log("panUsdPriceAuthority", panUsdPriceAuthority);

  // get liquidity
  const vanLiquidity = await getLiquidityFromFaucet(zoe, E(vanAsset.creatorFacet).makeFaucetInvitation(), 5n, vanBrand, "VAN");
  const vanLiquidityAmount = await E(vanIssuer).getAmountOf(vanLiquidity);

  const panLiquidity = await getLiquidityFromFaucet(zoe, E(panAsset.creatorFacet).makeFaucetInvitation(), 5n, panBrand, "PAN");
  const panLiquidityAmount = await E(panIssuer).getAmountOf(panLiquidity);

  const usdLiquidity = await getLiquidityFromFaucet(zoe, E(usdAsset.creatorFacet).makeFaucetInvitation(), 5n, usdBrand, "USD");
  const usdLiquidityAmount = await E(usdIssuer).getAmountOf(usdLiquidity);


  console.log("vanLiquidity", vanLiquidity);
  console.log("vanLiquidityAmount", vanLiquidityAmount);
  console.log("panLiquidity", panLiquidity);
  console.log("panLiquidityAmount", panLiquidityAmount);
  console.log("usdLiquidity", usdLiquidity);
  console.log("usdLiquidityAmount", usdLiquidityAmount);

  const vanLiquidityAMM = {
    proposal: harden(vanLiquidityAmount),
    payment: vanLiquidity,
  };

  const usdLiquidityAMM = {
    proposal: harden(usdLiquidityAmount),
    payment: usdLiquidity,
  };

  const loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n
  };

  const electorateTerms = { committeeName: 'TheCabal', committeeSize: 5 };

  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    timer,
    zoe,
    vanLiquidityAMM,
    usdLiquidityAMM,
    usdIssuer,
    vanIssuer,
    electorateTerms,
  );

  const { consume, produce } = space;

  const quoteMint = makeIssuerKit('quote', AssetKind.SET).mint;
  // const priceManager = makePriceManager({});
  produce.priceManager.resolve(priceManager);
  const vaultBundles = await Collect.allValues({
    LendingPool: bundlePs.LendingPool,
    liquidate: bundlePs.liquidate,
  });
  produce.vaultBundles.resolve(vaultBundles);
  produce.bootstrappedAssets.resolve({  });
  produce.compareCurrencyBrand.resolve(usdBrand);
  const {
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    lendingPoolInstance,
    installations: lendingPoolInstallations
  } = await startLendingPool(space, { loanParams: loanTiming });

  const lendingPool = await E(lendingPoolCreatorFacet).getLimitedCreatorFacet();

  // Make the rates for the pools
  const vanPoolRates = makeRates(vanBrand, usdBrand);
  const panPoolRates = makeRates(panBrand, usdBrand);

  // Add the pools
  const vanPoolMan = await addPool(zoe, vanPoolRates, lendingPool, vanIssuer, "VAN", vanUsdPriceAuthority);
  const panPoolMan = await addPool(zoe, panPoolRates, lendingPool, panIssuer, "PAN", panUsdPriceAuthority);

  // Check the protocol tokens received
  const agVanIssuer = await E(vanPoolMan).getProtocolIssuer();
  const agVanBrand = await E(vanPoolMan).getProtocolBrand();
  const agPanIssuer = await E(panPoolMan).getProtocolIssuer();
  const agPanBrand = await E(panPoolMan).getProtocolBrand();

  console.log("agVanIssuer", agVanIssuer);
  console.log("agPanIssuer", agPanIssuer);

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
    E(board).getId(lendingPoolInstallations.LendingPool),
    E(board).getId(vanAsset.instance),
    E(board).getId(panAsset.instance),
    E(board).getId(usdAsset.instance),
    E(board).getId(priceAuthorityFaucet.instance),
    E(board).getId(vanIssuer),
    E(board).getId(panIssuer),
    E(board).getId(usdIssuer),
    E(board).getId(agVanIssuer),
    E(board).getId(agPanIssuer),
    E(board).getId(installations.priceAuthorityFaucet),
    E(board).getId(installations.lendingPoolFaucet),
    E(board).getId(priceAuthorityManagerInstance),
  ]);

  const walletBridge = await E(wallet).getBridge();
  await E(walletBridge).suggestIssuer("VAN Purse", VAN_ISSUER_BOARD_ID);
  await E(walletBridge).suggestIssuer("PAN Purse", PAN_ISSUER_BOARD_ID);
  await E(walletBridge).suggestIssuer("AgVAN Purse", AGVAN_ISSUER_BOARD_ID);
  await E(walletBridge).suggestIssuer("AgPAN Purse", AGPAN_ISSUER_BOARD_ID);

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
          value: 5n * 10n ** 8n ,
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
          value: 10n * 10n ** 8n ,
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
          value: 1n * 10n ** 8n * 50n ,
        },
      },
      give: {
        Underlying: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'VAN Purse',
          value: 1n * 10n ** 8n ,
        },
      },
    },
  };

  console.log("depositVanOfferConfig", depositVanOfferConfig);
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
          value: 10n * 10n ** 8n * 50n ,
        },
      },
      give: {
        Underlying: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'PAN Purse',
          value: 10n * 10n ** 8n ,
        },
      },
    },
  };

  console.log("depositPanOfferConfig", depositPanOfferConfig);
  const depositPanOfferID = await E(walletBridge).addOffer(depositPanOfferConfig);

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