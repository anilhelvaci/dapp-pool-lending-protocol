import { POOL_CONFIG } from './poolConfigurations.js';
import { makeAmmPoolInitializer } from 'contract/test/lendingPool/helpers.js';

const initAmmPools = async homeP => {
  const { initAmmPool } = await makeAmmPoolInitializer({ homeP });

  const { VAN: vanConfig, PAN: panCofig } = POOL_CONFIG;
  await Promise.all([
    initAmmPool(vanConfig),
    initAmmPool(panCofig),
  ]);

};

export default harden(initAmmPools);