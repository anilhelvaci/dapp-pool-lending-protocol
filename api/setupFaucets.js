import { E } from '@endo/far';
import { makeBundle, makeSoloHelpers, startFaucets } from 'contract/test/lendingPool/helpers.js';
import { CONTRACT_ROOTS } from 'contract/deploy/deploy.js';
import fs from 'fs';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { objectMap } from '@agoric/internal';
import { SECONDS_PER_DAY } from 'contract/src/interest.js';

const setupFaucets = async (homeP, { bundleSource, pathResolve }) => {

  const { home, suggestIssuer } = await makeSoloHelpers(homeP);
  const { board, scratch, zoe } = home;

  const bundles = await Collect.allValues({
    lendingPoolFaucet: makeBundle(bundleSource, CONTRACT_ROOTS.lendingPoolFaucet),
    priceAuthorityFaucet: makeBundle(bundleSource, CONTRACT_ROOTS.priceAuthorityFaucet),
    manualTimerFaucet: makeBundle(bundleSource, CONTRACT_ROOTS.manualTimerFaucet)
  });

  const contractInstallations = objectMap(bundles, bundle => E(zoe).install(bundle));

  console.log('Starting faucets...');
  const {
    vanAsset,
    panAsset,
    priceAuthorityFaucet,
    manualTimerFaucet,
  } = await startFaucets(zoe, contractInstallations);

  console.log('Building timer...');
  const timer = await E(manualTimerFaucet.creatorFacet).makeManualTimer({
    startValue: 0n,
    timeStep: SECONDS_PER_DAY * 7n,
  });

  console.log('Getting faucet issuers...');
  const [vanIssuer, panIssuer] = await Promise.all([
    E(vanAsset.publicFacet).getIssuer(),
    E(panAsset.publicFacet).getIssuer(),
  ]);

  console.log('Putting private stuff to scratch...');
  const [
    VAN_ASSET_CREATOR_FACET_ID,
    PAN_ASSET_CREATOR_FACET_ID,
    TIMER_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
  ] = await Promise.all(
    [
      E(scratch).set('van_asset_creator_facet_id', vanAsset.creatorFacet),
      E(scratch).set('pan_asset_creator_facet_id', panAsset.creatorFacet),
      E(scratch).set('timer_id', timer),
      E(scratch).set('price_authority_faucet_creator_facet_id', priceAuthorityFaucet.creatorFacet),
    ],
  );

  console.log('Putting stuff to board...');
  const [
    VAN_ASSET_INSTANCE_BOARD_ID,
    PAN_ASSET_INSTANCE_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID,
    LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
  ] = await Promise.all([
    E(board).getId(vanAsset.instance),
    E(board).getId(panAsset.instance),
    E(board).getId(priceAuthorityFaucet.instance),
    E(board).getId(vanIssuer),
    E(board).getId(panIssuer),
    E(board).getId(await contractInstallations.priceAuthorityFaucet),
    E(board).getId(await contractInstallations.lendingPoolFaucet),
  ]);

  console.log('Suggesting VAN and PAN issuers...');
  await Promise.all([
    suggestIssuer('VAN Purse', VAN_ISSUER_BOARD_ID),
    suggestIssuer('PAN Purse', PAN_ISSUER_BOARD_ID),
  ]);

  const dappConstants = {
    VAN_ASSET_INSTANCE_BOARD_ID,
    PAN_ASSET_INSTANCE_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTANCE_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_INSTALL_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
    LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
    VAN_ASSET_CREATOR_FACET_ID,
    PAN_ASSET_CREATOR_FACET_ID,
    TIMER_ID,
  };
  const defaultsFile = pathResolve(`../ui/src/generated/lendingPoolDefaults.js`);
  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./setupFaucets.js')}
export default ${JSON.stringify(dappConstants, undefined, 2)};
`;

  await fs.promises.writeFile(defaultsFile, defaultsContents);
};

export default harden(setupFaucets);