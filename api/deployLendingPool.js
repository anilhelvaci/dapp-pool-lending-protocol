import { getSpaces, makeBundle, makeSoloHelpers, startPriceManager } from 'contract/test/lendingPool/helpers.js';
import { startLendingPool, setupLendinPoolElectorate, getPath } from 'contract/test/lendingPool/setup.js';
import { makePromiseSpace } from '@agoric/vats/src/core/utils.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { CONTRACT_ROOTS } from 'contract/test/lendingPool/setup.js';
import { objectMap } from '@agoric/internal';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { SECONDS_PER_DAY } from 'contract/src/interest.js';
import fs from 'fs';

const deployLendingPool = async (homeP, { bundleSource, pathResolve }) => {
  const { getIstBrandAndIssuer, getValueFromScracth, getAmm } = await makeSoloHelpers(homeP);
  const { zoe, board, scratch } = await homeP;

  const spaces = getSpaces();
  const { produce, installation, brand, instance, consume } = spaces;

  const {
    TIMER_ID,
  } = lendingPoolDefaults

  const [{ istBrand }, { value: timer }, { ammInstance }] = await Promise.all([
    getIstBrandAndIssuer(),
    getValueFromScracth(TIMER_ID),
    getAmm()
  ]);

  produce.zoe.resolve(zoe);
  produce.chainTimerService.resolve(timer);
  brand.produce.IST.resolve(istBrand);
  instance.produce.amm.resolve(ammInstance);

  const bundles = await Collect.allValues({
    liquidate: makeBundle(bundleSource, CONTRACT_ROOTS.liquidate),
    LendingPool: makeBundle(bundleSource, CONTRACT_ROOTS.LendingPool),
    priceManagerContract: makeBundle(bundleSource, CONTRACT_ROOTS.priceManagerContract),
    lendingPoolElectorate: makeBundle(bundleSource, CONTRACT_ROOTS.lendingPoolElectorate),
    lendingPoolElectionManager: makeBundle(bundleSource, CONTRACT_ROOTS.lendingPoolElectionManager),
    counter: makeBundle(bundleSource, CONTRACT_ROOTS.counter),
  });
  const installations = objectMap(bundles, bundle => E(zoe).install(bundle));

  installation.produce.LendingPool.resolve(installations.LendingPool);
  installation.produce.liquidate.resolve(installations.liquidate);
  installation.produce.lendingPoolElectorate.resolve(installations.lendingPoolElectorate);
  installation.produce.lendingPoolElectionManager.resolve(installations.lendingPoolElectionManager);

  console.log('Starting LendingPoolElectorate...');
  await setupLendinPoolElectorate(spaces);

  console.log('Starting PriceManager...');
  const priceManInstallation = await installations.priceManagerContract;
  const {
    priceAuthorityManagerPublicFacet: priceManager,
    priceAuthorityManagerInstance
  } = await startPriceManager(zoe, priceManInstallation);
  produce.priceManager.resolve(priceManager);

  const loanParams = {
    chargingPeriod: SECONDS_PER_DAY,
    recordingPeriod: SECONDS_PER_DAY * 7n,
    priceCheckPeriod: SECONDS_PER_DAY * 7n * 2n,
  };

  console.log('Starting LendingPool...')
  await startLendingPool(spaces, { loanParams });

  const [
    lendingPoolInstance,
    lendingPoolGovernorInstance,
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    governanceIssuer,
  ] = await Promise.all([
    instance.consume.lendingPool,
    instance.consume.lendingPoolGovernor,
    consume.lendingPoolCreator,
    consume.lendingPoolPublicFacet,
    E(consume.lendingPoolPublicFacet).getGovernanceIssuer(),
  ]);

  console.log('Putting stuff into board...');
  const [
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    AMM_INSTANCE_BOARD_ID,
    PRICE_MANAGER_PUBLIC_FACET_BOARD_ID,
    PRICE_MANAGER_INSTANCE_BOARD_ID,
    LENDING_POOL_PUBLIC_FACET_BOARD_ID,
    GOVERNANCE_ISSUER_BOARD_ID,
  ] = await Promise.all([
    E(board).getId(lendingPoolInstance),
    E(board).getId(lendingPoolGovernorInstance),
    E(board).getId(ammInstance),
    E(board).getId(priceManager),
    E(board).getId(priceAuthorityManagerInstance),
    E(board).getId(lendingPoolPublicFacet),
    E(board).getId(governanceIssuer),
  ]);

  console.log('Putting stuff into scratch...');
  const [
    LENDING_POOL_CREATOR_FACET_ID,
  ] = await Promise.all([
    E(scratch).set('lending_pool_creator_facet_id', lendingPoolCreatorFacet),
  ])

  const dappConstsUpdated = {
    ...lendingPoolDefaults,
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    LENDING_POOL_CREATOR_FACET_ID,
    LENDING_POOL_PUBLIC_FACET_BOARD_ID,
    GOVERNANCE_ISSUER_BOARD_ID,
    AMM_INSTANCE_BOARD_ID,
    PRICE_MANAGER_PUBLIC_FACET_BOARD_ID,
    PRICE_MANAGER_INSTANCE_BOARD_ID,
  };

  console.log('Dapp Constants', dappConstsUpdated);
  const defaultsFile = pathResolve(`../ui/src/generated/lendingPoolDefaults.js`);
  console.log('writing', defaultsFile);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./deploy.js')}
export default ${JSON.stringify(dappConstsUpdated, undefined, 2)};
`;

  await fs.promises.writeFile(defaultsFile, defaultsContents);
};

harden(deployLendingPool);

export default deployLendingPool;