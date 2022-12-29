import { getPoolMetadata, makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import { POOL_CONFIG } from './poolConfigurations.js';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';

const { details: X } = assert;

const borrowPanColVan = async homeP => {
  assert(process.env.DEBT_VAL || process.env.COL_VAL, X`DEBT_VAL or COL_VAL env variable not provided.`);

  const PROTOCOL_PURSE_NAME = 'AgVAN Purse';
  const DEBT_PURSE_NAME = 'PAN Purse';

  const {
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_INSTALL_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
    PAN_ISSUER_BOARD_ID,
    LENDING_POOL_PUBLIC_FACET_BOARD_ID,
  } = lendingPoolDefaults;

  const { home, getBrandAndIssuerFromBoard, getValueFromBoard, suggestIssuer } = await makeSoloHelpers(homeP);
  const walletBridgeP = E(home.wallet).getBridge();

  console.log('Getting stuff from ag-solo...');
  const [
    { brand: collateralUnderlyingBrand },
    { value: lendingPoolPublicFacet }
  ] = await Promise.all([
    getBrandAndIssuerFromBoard(VAN_ISSUER_BOARD_ID),
    getValueFromBoard(LENDING_POOL_PUBLIC_FACET_BOARD_ID)
  ]);

  console.log('Suggesting issuers...');
  await Promise.all([
    suggestIssuer(DEBT_PURSE_NAME, PAN_ISSUER_BOARD_ID),
  ]);


  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(lendingPoolPublicFacet).makeBorrowInvitation(),
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        Debt: {
          // The pursePetname identifies which purse we want to uselib
          pursePetname: DEBT_PURSE_NAME,
          value: BigInt(process.env.DEBT_VAL),
        },
      },
      give: {
        Collateral: {
          // The pursePetname identifies which purse we want to use
          pursePetname: PROTOCOL_PURSE_NAME,
          value: BigInt(process.env.COL_VAL),
        },
      },
      arguments: {
        collateralUnderlyingBrand,
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.');
};

export default harden(borrowPanColVan);