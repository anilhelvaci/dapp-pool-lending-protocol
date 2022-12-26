import { getSpaces, makeBundle, makeSoloHelpers, startPriceManager } from 'contract/test/lendingPool/helpers.js';
import { startLendingPool, setupLendinPoolElectorate, getPath } from 'contract/test/lendingPool/setup.js';
import { makePromiseSpace } from '@agoric/vats/src/core/utils.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { CONTRACT_ROOTS } from 'contract/test/lendingPool/setup.js';
import { objectMap } from '@agoric/internal';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { SECONDS_PER_DAY } from 'contract/src/interest.js';

const deployLendingPool = async (homeP, { bundleSource }) => {
  const { getIstBrandAndIssuer, getValueFromScracth, getAmm } = await makeSoloHelpers(homeP);
  const { zoe, board } = await homeP;

  const spaces = getSpaces();
  const { produce, installation, brand, instance } = spaces;

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

  console.log('Starting priceManager...');
  const priceManInstallation = await installations.priceManagerContract;
  const {
    priceAuthorityManagerPublicFacet: priceManager,
  } = await startPriceManager(zoe, priceManInstallation);
  produce.priceManager.resolve(priceManager);

  const loanParams = {
    chargingPeriod: SECONDS_PER_DAY,
    recordingPeriod: SECONDS_PER_DAY * 7n,
    priceCheckPeriod: SECONDS_PER_DAY * 7n * 2n,
  };

  await startLendingPool(spaces, { loanParams });

  const [
    lendingPoolInstance,
    lendingPoolGovernorInstance,
  ] = await Promise.all([
    instance.consume.lendingPool,
    instance.consume.lendingPoolGovernor,
  ]);

  const [
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID
  ] = await Promise.all([
    E(board).getId(lendingPoolInstance),
    E(board).getId(lendingPoolGovernorInstance)
  ]);

  const dappConsts = {
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
  };

  console.log('Dapp Constants', dappConsts);

};

harden(deployLendingPool);

export default deployLendingPool;