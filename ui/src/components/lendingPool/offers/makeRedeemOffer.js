import { E } from "@endo/far";
import lendingPoolDefaults from "../../../generated/lendingPoolDefaults";
import { floorMultiplyBy, oneMinus } from "@agoric/zoe/src/contractSupport/ratio";
import { OperationType } from '../../../constants.js';
import { makeRatio, ratiosSame } from '@agoric/zoe/src/contractSupport/ratio.js';

const makeRedeemOffer = async (
  {
    walletP,
    lendingPoolPublicFacet,
    underlyingPurse,
    protocolPurse,
    underlyingAmount,
    protocolAmount,
    slippageRatio,
  }) => {

  const { LENDING_POOL_INSTANCE_BOARD_ID, LENDING_POOL_INSTALL_BOARD_ID } = lendingPoolDefaults;

  const invitation = E(lendingPoolPublicFacet).makeRedeemInvitation(underlyingAmount.brand);
  const safeSlippage = ratiosSame(slippageRatio, makeRatio(0n, underlyingAmount.brand)) ?
    makeRatio(1n, underlyingAmount.brand) : slippageRatio;

  const underlyingExpected = floorMultiplyBy(
    underlyingAmount,
    oneMinus(safeSlippage),
  );

  const offerConfig = {
    id: `${Date.now()}`,
    invitation,
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        Protocol: {
          pursePetname: protocolPurse.pursePetname,
          value: protocolAmount.value,
        },
      },
      want: {
        Underlying: {
          pursePetname: underlyingPurse.pursePetname,
          value: underlyingExpected.value,
        },
      },
    },
    operation: OperationType.REDEEM
  };

  return E(walletP).addOffer(offerConfig);
};

export default makeRedeemOffer;