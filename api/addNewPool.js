// @ts-check

import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import newPoolConfig from './newPoolConfig.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import {
  addPool,
  getLiquidityFromFaucet,
  makeBundle, makeRates, depositMoney,
} from 'contract/test/lendingPool/helpers.js';

const lendingPoolFaucetContractRoot = './lendingPoolFaucet.js';

const addNewPool = async (homeP, { bundleSource }) => {
  const home = await homeP;
  const scratch = home.scratch;
  const zoe = home.zoe;
  const board = home.board;

  console.log('Creating a new pool with the config:', newPoolConfig);
  const { assetConfig } = newPoolConfig;

  const {
    LENDING_POOL_CREATOR_FACET_ID,
    AMM_INSTANCE_BOARD_ID,
    USD_ASSET_INSTANCE_BOARD_ID,
    USD_ISSUER_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
    TIMER_ID,
  } = lendingPoolDefaults;

  const usdInstanceP = E(board).getValue(USD_ASSET_INSTANCE_BOARD_ID);
  const usdPublicFacetP = E(zoe).getPublicFacet(usdInstanceP);
  const usdLiquidityInvitationP = E(usdPublicFacetP).makeFaucetInvitation();
  const usdIssuerP = E(board).getValue(USD_ISSUER_BOARD_ID);
  const usdBrandP = E(usdIssuerP).getBrand();
  const bundle = await makeBundle(bundleSource, lendingPoolFaucetContractRoot);
  const assetFaucetInstallation = await E(zoe).install(bundle);
  const ammInstanceP = E(board).getValue(AMM_INSTANCE_BOARD_ID);

  console.log('Getting lendingPoolCreatorFacet, ammPublicFacet and starting assetFaucet...');
  const [lendingPoolCreatorFacet, ammPublicFacet, assetFacets] = await Promise.all([
    E(scratch).get(LENDING_POOL_CREATOR_FACET_ID),
    E(zoe).getPublicFacet(ammInstanceP),
    E(zoe).startInstance(
      assetFaucetInstallation,
      undefined,
      assetConfig
    )
  ]);

  const assetFaucetInvitationP = E(assetFacets.publicFacet).makeFaucetInvitation();
  const assetIssuerP = E(assetFacets.publicFacet).getIssuer();
  const assetBrandP = E(assetIssuerP).getBrand();

  const [assetIssuer, assetBrand, usdBrand] = await Promise.all([
    assetIssuerP,
    assetBrandP,
    usdBrandP,
  ]);

  console.log(`Getting liquidity for ${assetConfig.keyword} and USD...`);
  const [assetLiquidity, usdLiquidity] = await Promise.all([
    getLiquidityFromFaucet(zoe, assetFaucetInvitationP, newPoolConfig.ammConfig.assetLiquidity, assetBrand, assetConfig.keyword),
    getLiquidityFromFaucet(zoe, usdLiquidityInvitationP, newPoolConfig.ammConfig.compareLiquidity, usdBrand, 'USD'),
  ]);

  const priceAuthorityCreatorFacetP = E(scratch).get(PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID);
  const assetLiquidityIssuerP = E(ammPublicFacet).addPool(assetIssuer, assetConfig.keyword);
  console.log(`Adding ${assetConfig.keyword}/USD pool and getting manual timer from scratch...`);
  const [assetLiquidityBrand, manualTimer, assetLiquidityAmount, usdLiquidityAmount] = await Promise.all([
    E(assetLiquidityIssuerP).getBrand(),
    E(scratch).get(TIMER_ID),
    E(assetIssuerP).getAmountOf(assetLiquidity),
    E(usdIssuerP).getAmountOf(usdLiquidity)
  ]);

  const timer = process.env.USE_MANUAL_TIMER ? manualTimer : home.localTimerService;

  // Build addLiquidity offer
  const addAssetLiquidityInvitation = E(ammPublicFacet).makeAddLiquidityInvitation();

  const assetAddLiquidityProposal = harden({
    give: {
      Secondary: assetLiquidityAmount,
      Central: usdLiquidityAmount,
    },
    want: { Liquidity: AmountMath.makeEmpty(assetLiquidityBrand) }
  });

  const assetAddLiquidityPaymentRecord = harden({
    Secondary: assetLiquidity,
    Central: usdLiquidity,
  });

  console.log(`Adding liquidity to AMM and creating the ${assetConfig.keyword}/USD price authority...`);
  const [assetUsdPriceAuthority] = await Promise.all([
    E(priceAuthorityCreatorFacetP).makeManualPriceAuthority({
      actualBrandIn: assetBrand,
      actualBrandOut: usdBrand,
      initialPrice: makeRatio(200n * 10n ** 6n, usdBrand, 10n ** 8n, assetBrand),
      timer,
    }),
    E(zoe).offer(
      addAssetLiquidityInvitation,
      assetAddLiquidityProposal,
      assetAddLiquidityPaymentRecord
    )
  ]);

  const assetPoolRates = makeRates(assetBrand, usdBrand); // Read rates from config file

  console.log(`Adding ${assetConfig.keyword} pool...`);
  const assetPoolMan = await addPool(zoe, assetPoolRates, lendingPoolCreatorFacet, assetIssuer, assetConfig.keyword, assetUsdPriceAuthority);

  console.log(`Getting liquidity to add ${assetConfig.keyword}/USD pool...`);
  const [assetProtocolLiquidity, usdProtocolLiquidity] = await Promise.all([
    getLiquidityFromFaucet(zoe, E(assetFacets.publicFacet).makeFaucetInvitation(), newPoolConfig.ammConfig.assetLiquidity, assetBrand, assetConfig.keyword),
    getLiquidityFromFaucet(zoe, E(usdPublicFacetP).makeFaucetInvitation(), newPoolConfig.ammConfig.compareLiquidity, usdBrand, 'USD'),
  ]);

  const [assetProtocolLiquidityAmount, usdProtocolLiquidityAmount, assetProtocolBrand] = await Promise.all([
    E(assetIssuerP).getAmountOf(assetProtocolLiquidity),
    E(usdIssuerP).getAmountOf(usdProtocolLiquidity),
    E(assetPoolMan).getProtocolBrand(),
  ]);

  const depositProposal = harden({
    give: {Underlying: assetProtocolLiquidityAmount},
    want: {Protocol: AmountMath.makeEmpty(assetProtocolBrand)}
  });

  const depositPaymentRecord = harden({
    Underlying: assetProtocolLiquidity
  });

  console.log('Depositing...')
  await E(zoe).offer(
    E(assetPoolMan).makeDepositInvitation(assetBrand),
    depositProposal,
    depositPaymentRecord
  );

  console.log('Done...');
};

export default addNewPool;