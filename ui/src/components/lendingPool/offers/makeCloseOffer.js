import lendingPoolDefaults from '../../../generated/lendingPoolDefaults.js';
import { E } from '@endo/far';
import { OperationType } from '../../../constants.js';

const makeCloseOffer =
  ({
    walletP,
    debtAmount,
    debtPurse,
    collateralAmount,
    collateralPurse,
    loanId
   }) => {

  const { LENDING_POOL_INSTANCE_BOARD_ID, LENDING_POOL_INSTALL_BOARD_ID } = lendingPoolDefaults;

  const offerConfig = {
    id: `${Date.now()}`,
    continuingInvitation: {
      priorOfferId: loanId,
      description: 'CloseLoan',
    },
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        Debt: {
          pursePetname: debtPurse.pursePetname,
          value: debtAmount.value,
        }
      },
      want: {
        Collateral: {
          pursePetname: collateralPurse.pursePetname,
          value: collateralAmount.value,
        }
      },
    },
    operation: OperationType.CLOSE,
  };

    console.log('Sending close loan offer with the config:', offerConfig);
    return E(walletP).addOffer(offerConfig);
};

export default makeCloseOffer;