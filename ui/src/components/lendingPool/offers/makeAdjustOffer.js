import { E } from '@endo/far';
import lendingPoolDefaults from '../../../generated/lendingPoolDefaults.js';
import { AdjustActions, OperationType } from '../../../constants.js';

const DEBT_KEYWORD = 'Debt';
const COLLATERAL_KEYWORD = 'Collateral';

const makeAdjustOffer = async ({
                                 debt: {
                                   action: debtAction,
                                   purse: debtPurse,
                                   amount: debtAmount,
                                 },
                                 collateral: {
                                   action: collateralAction,
                                   purse: collateralPurse,
                                   amount: collateralAmount,
                                 },
                                 collateralUnderlyingBrand,
                                 walletP,
                                 loanId,
                               }) => {

  const { LENDING_POOL_INSTALL_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID } = lendingPoolDefaults;

  let give = {};
  let want = {};

  if (debtAction === AdjustActions.GIVE) {
    give[DEBT_KEYWORD] = {
      pursePetname: debtPurse.pursePetname,
      value: debtAmount.value,
    };
  } else if (debtAction === AdjustActions.WANT) {
    want[DEBT_KEYWORD] = {
      pursePetname: debtPurse.pursePetname,
      value: debtAmount.value,
    };
  }

  if (collateralAction === AdjustActions.GIVE) {
    give[COLLATERAL_KEYWORD] = {
      pursePetname: collateralPurse.pursePetname,
      value: collateralAmount.value,
    };
  } else if (collateralAction === AdjustActions.WANT) {
    want[COLLATERAL_KEYWORD] = {
      pursePetname: collateralPurse.pursePetname,
      value: collateralAmount.value,
    };
  }

  const offerConfig = {
    id: `${Date.now()}`,
    continuingInvitation: {
      priorOfferId: loanId,
      description: 'AdjustBalances',
    },
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give,
      want,
      arguments: {
        collateralUnderlyingBrand,
      },
    },
    operation: OperationType.ADJUST,
  };

  console.log('Sending adjust offer with the config:', offerConfig);
  return E(walletP).addOffer(offerConfig);
};

export default makeAdjustOffer;