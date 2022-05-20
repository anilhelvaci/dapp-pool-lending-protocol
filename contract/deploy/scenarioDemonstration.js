// @ts-check
import { E } from '@agoric/eventual-send';

export const makeGatewayCosmosShowcaseKit = async () => {
  // get VAN liquidity to deposit
  const getLiquidityFromFaucet = async (wb, creatorFacet, unit, brand, installId, instanceId, pursePetname, value, keyword) => {
    const proposalWantKeywordRecord = {};
    proposalWantKeywordRecord[keyword] = {
      pursePetname: pursePetname,
      value: value ,
    }

    const offerConfig = {
      id: `${Date.now()}`,
      invitation: E(creatorFacet).makeFaucetInvitation(),
      installationHandleBoardId: installId,
      instanceHandleBoardId: instanceId,
      proposalTemplate: {
        give: {},
        want: proposalWantKeywordRecord,
      },
    };

    return await E(wb).addOffer(offerConfig);
  }

  const depositToPool = async (wb, invitation, giveKeyword, giveValue, givePursePetname, wantPursePetname, wantKeyword, wantValue, installId, instanceId) => {
    const proposalGiveKeywordRecord = {};
    proposalGiveKeywordRecord[giveKeyword] = {
      pursePetname: givePursePetname,
      value: wantValue ,
    }

    const proposalWantKeywordRecord = {};
    proposalWantKeywordRecord[wantKeyword] = {
      pursePetname: wantPursePetname,
      value: wantValue ,
    }

    const offerConfig = {
      id: `${Date.now()}`,
      invitation,
      installationHandleBoardId: installId,
      instanceHandleBoardId: instanceId,
      proposalTemplate: {
        give: proposalGiveKeywordRecord,
        want: proposalWantKeywordRecord,
      },
    };

    return await E(wb).addOffer();
  }
}