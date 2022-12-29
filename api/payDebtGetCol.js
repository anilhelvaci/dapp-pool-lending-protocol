import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { E } from '@endo/far';

const payDebtGetCol = async homeP => {
  const { home, getBrandAndIssuerFromBoard } = await makeSoloHelpers(homeP);
  const { LENDING_POOL_INSTALL_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID, VAN_ISSUER_BOARD_ID } = lendingPoolDefaults;

  const [
    { brand: collateralUnderlyingBrand }
  ] = await Promise.all([
    getBrandAndIssuerFromBoard(VAN_ISSUER_BOARD_ID)
  ]);

  const walletBridgeP = E(home.wallet).getBridge();

  const offerConfig = {
    id: `${Date.now()}`,
    continuingInvitation: {
      priorOfferId: '1672265760721',
      description: 'AdjustBalances',
    },
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        Debt: {
          pursePetname: 'PAN Purse',
          value: 2000000n,
        }
      },
      want: {
        Collateral: {
          pursePetname: 'AgVAN Purse',
          value: 2500000000n,
        }
      },
      arguments: {
        collateralUnderlyingBrand,
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.')
};

export default harden(payDebtGetCol);