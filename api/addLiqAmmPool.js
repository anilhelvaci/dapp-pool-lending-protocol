import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { getLiquidityFromFaucet, makeAmmPoolInitializer } from 'contract/test/lendingPool/helpers.js';

const addLiqAmmPool = async (homeP) => {
  const home = await homeP;

  const {
    VAN_ISSUER_BOARD_ID,
    VAN_ASSET_INSTANCE_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    PAN_ASSET_INSTANCE_BOARD_ID,
  } = lendingPoolDefaults;

  const { initAmmPool } = await makeAmmPoolInitializer({ home });

  const vanPoolConfig = harden({
    issuerId: VAN_ISSUER_BOARD_ID,
    assetId: VAN_ASSET_INSTANCE_BOARD_ID,
    centralValue: 10n,
    secondaryValue: 110n * 10n,
    kwd: 'VAN',
  });

  const panPoolConfig = harden({
    issuerId: PAN_ISSUER_BOARD_ID,
    assetId: PAN_ASSET_INSTANCE_BOARD_ID,
    centralValue: 10n,
    secondaryValue: 200n * 10n,
    kwd: 'PAN',
  });

  await Promise.all([
    initAmmPool(vanPoolConfig),
    initAmmPool(panPoolConfig),
  ]);
};

harden(addLiqAmmPool);
export default addLiqAmmPool;