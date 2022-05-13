// @ts-check

import '@agoric/zoe/exported.js';
import {
  setUpZoeForTest,
  setupAmmServices,
} from '../test/lendingPool/setup.js';
import { E } from '@agoric/eventual-send';
import '@agoric/zoe/src/contractSupport/index.js';
import { depositMoney, addPool, makeRates, setupAssets, makeBundle } from '../test/lendingPool/helpers.js';
import { makePriceManager } from '../src/lendingPool/priceManager.js';
import { startLendingPool } from '../test/lendingPool/helpers.js';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import { SECONDS_PER_YEAR } from '../src/interest.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
const contractRoots = {
  faucet: './test/lendingPool/faucet.js',
  liquidate: '../../src/lendingPool/liquidateMinimum.js',
  LendingPool: '../../src/lendingPool/lendingPool.js',
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
  const timer = home.localTimerService;
  const {
    vanKit: { mint: vanMint, issuer: vanIssuer, brand: vanBrand },
    usdKit: { mint: usdMint, issuer: usdIssuer, brand: usdBrand },
    panKit: { mint: panMint, issuer: panIssuer, brand: panBrand },
  } = setupAssets();

  const vanLiquidity = {
    proposal: harden(AmountMath.make(vanBrand, 5n * BigInt(vanBrand.getDisplayInfo().decimalPlaces))),
    payment: vanMint.mintPayment(AmountMath.make(vanBrand, 5n * BigInt(vanBrand.getDisplayInfo().decimalPlaces))),
  };

  const usdLiquidity = {
    proposal: harden(AmountMath.make(usdBrand, 5n * BigInt(usdBrand.getDisplayInfo().decimalPlaces))),
    payment: usdMint.mintPayment(AmountMath.make(usdBrand, 5n * BigInt(usdBrand.getDisplayInfo().decimalPlaces))),
  };



  const secondsPerDay = SECONDS_PER_YEAR / 365n;
  const loanTiming = {
    chargingPeriod: secondsPerDay,
    recordingPeriod: secondsPerDay * 7n,
    priceCheckPeriod: secondsPerDay * 7n * 2n
  };

  const electorateTerms = { committeeName: 'TheCabal', committeeSize: 5 };

  const bundlePs = {
    faucet: makeBundle(bundleSource, contractRoots.faucet),
    liquidate: makeBundle(bundleSource, contractRoots.liquidate),
    LendingPool: makeBundle(bundleSource, contractRoots.LendingPool),
  };



  const { amm: ammFacets, space } = await setupAmmAndElectorate(
    timer,
    zoe,
    vanLiquidity,
    usdLiquidity,
    usdIssuer,
    vanIssuer,
    electorateTerms,
  );


  const { consume, produce } = space;

  const quoteMint = makeIssuerKit('quote', AssetKind.SET).mint;
  const priceManager = makePriceManager({});
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
  } = await startLendingPool(space, { loanParams: loanTiming });

  const [
    INSTANCE_BOARD_ID,
  ] = await Promise.all([
    E(board).getId(lendingPoolInstance),
  ]);

  console.log(`-- INSTANCE_BOARD_ID: ${INSTANCE_BOARD_ID}`);

  // return {
  //   zoe,
  //   // installs,
  //   lendingPoolCreatorFacet,
  //   lendingPoolPublicFacet,
  //   lendingPoolInstance,
  //   ammFacets,
  //   runKit: { issuer: runIssuer, brand: runBrand },
  //   quoteMint,
  //   timer,
  //   priceManager
  // };
}