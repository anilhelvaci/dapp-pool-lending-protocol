import { E } from "@endo/far";
import lendingPoolDefaults from "../../../generated/lendingPoolDefaults";

const makeBorrowOffer = async (
  {
    walletP,
    lendingPoolPublicFacet,
    collateralPurse,
    debtPurse,
    collateralAmount,
    debtAmount,
    collateralUnderlyingBrand
  }) => {

  const { LENDING_POOL_INSTANCE_BOARD_ID, LENDING_POOL_INSTALL_BOARD_ID } = lendingPoolDefaults;

  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(lendingPoolPublicFacet).makeBorrowInvitation(),
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        Debt: {
          // The pursePetname identifies which purse we want to uselib
          pursePetname: debtPurse.pursePetname,
          value: debtAmount.value,
        },
      },
      give: {
        Collateral: {
          // The pursePetname identifies which purse we want to use
          pursePetname: collateralPurse.pursePetname,
          value: collateralAmount.value,
        },
      },
      arguments: {
        collateralUnderlyingBrand,
      },
    },
  };

  console.log('borrowPanOfferConfig', offerConfig);
  return E(walletP).addOffer(offerConfig);
};

export default makeBorrowOffer;