import { E } from "@endo/far";
import lendingPoolDefaults from "../../../generated/lendingPoolDefaults";
import { floorMultiplyBy, oneMinus } from "@agoric/zoe/src/contractSupport/ratio";
import { OperationType } from '../../../constants.js';

const makeDepositOffer = async (
  {
    walletP,
    lendingPoolPublicFacet,
    supplyPurse,
    protocolPurse,
    supplyAmount,
    protocolAmount,
    slippageRatio,
  }) => {

  const { LENDING_POOL_INSTANCE_BOARD_ID, LENDING_POOL_INSTALL_BOARD_ID } = lendingPoolDefaults;

  const invitation = E(lendingPoolPublicFacet).makeDepositInvitation(supplyAmount.brand);

  const protocolExpected = floorMultiplyBy(
    protocolAmount,
    oneMinus(slippageRatio),
  );

  const offerConfig = {
    id: `${Date.now()}`,
    invitation,
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        Underlying: {
          // The pursePetname identifies which purse we want to use
          pursePetname: supplyPurse.pursePetname,
          value: supplyAmount.value,
        },
      },
      want: {
        Protocol: {
          pursePetname: protocolPurse.pursePetname,
          value: protocolExpected.value,
        },
      },
    },
    operation: OperationType.DEPOSIT
  };

  return E(walletP).addOffer(offerConfig);
};

export default makeDepositOffer;