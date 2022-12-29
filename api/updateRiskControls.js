import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { getPoolMetadata, makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';

const { details: X } = assert;

const updateRiskControls = async homeP => {
  assert(process.env.POOL_KWD || process.env.UNDERLYING_BOARD_ID,
    X`Set either POOL_KWD or UNDERLYIN_BOARD_ID.`);

  const issuerBoardId = process.env.POOL_KWD ? lendingPoolDefaults[`${process.env.POOL_KWD}_ISSUER_BOARD_ID`]
    : process.env.UNDERLYING_BOARD_ID;

  const {
    LENDING_POOL_CREATOR_FACET_ID,
    LENDING_POOL_INSTALL_BOARD_ID,
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_PUBLIC_FACET_BOARD_ID,
  } = lendingPoolDefaults;

  const { home, getValueFromScracth, getBrandAndIssuerFromBoard, getValueFromBoard } = await makeSoloHelpers(homeP);

  const [{ value: lendingPoolCF }, { brand: underlyingBrand }, { value: lendingPoolPF }] = await Promise.all([
    getValueFromScracth(LENDING_POOL_CREATOR_FACET_ID),
    getBrandAndIssuerFromBoard(issuerBoardId),
    getValueFromBoard(LENDING_POOL_PUBLIC_FACET_BOARD_ID),
  ]);

  const walletBridgeP = E(home.wallet).getBridge();

  const poolManP = E(lendingPoolPF).getPool(underlyingBrand);
  const { protocolBrand } = await getPoolMetadata(poolManP);

  const changes = buildChanges(protocolBrand);
  console.log('Changes', { changes });

  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(lendingPoolCF).makeUpdateRiskControlsInvitation(),
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      arguments:
        {
          underlyingBrand, changes,
        },
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.')

};

const buildChanges = underlyingBrand => {
  const changes = {};

  if (process.env.BORROWABLE) {
    changes.Borrowable = (process.env.BORROWABLE === 'true');
  }

  if (process.env.USABLE_AS_COL) {
    changes.UsableAsCollateral = (process.env.USABLE_AS_COL === 'true');
  }

  if (process.env.COL_LIMIT) {
    changes.CollateralLimit = AmountMath.make(underlyingBrand, BigInt(process.env.COL_LIMIT));
  }

  return changes;
};

export default harden(updateRiskControls);