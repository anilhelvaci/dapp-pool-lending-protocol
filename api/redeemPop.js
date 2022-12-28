import { calculateGovAmountFromValue } from 'contract/src/governance/tools.js';
import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { E } from '@endo/far';

const { details: X } = assert;

const redeemPop = async homeP => {
  assert(process.env.REDEEM_VAL_UNIT, X`REDEEM_VAL_UNIT env variable not set.`);
  const { home, getPurseFromWallet, getValueFromBoard } = await makeSoloHelpers(homeP);
  const {
    LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    LENDING_POOL_GOVERNOR_PUBLIC_FACET_BOARD_ID,
  } = lendingPoolDefaults;

  const walletBridgeP = await E(home.wallet).getBridge();

  const [
    { purse: popPurse },
    { value: electionManagerPublicFacet }
  ] = await Promise.all([
    getPurseFromWallet('POP Purse'),
    getValueFromBoard(LENDING_POOL_GOVERNOR_PUBLIC_FACET_BOARD_ID)
  ]);

  const { value: popValue } = await E(popPurse).getCurrentAmount();

  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(electionManagerPublicFacet).makeRedeemAssetInvitation(),
    installationHandleBoardId: LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        POP: {
          pursePetname: 'POP Purse',
          value: popValue,
        },
      },
      want: {
        LPT: {
          pursePetname: 'LPT Purse',
          value: BigInt(process.env.REDEEM_VAL_UNIT) * 10n ** 6n,
        },
      }
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.')
};

export default harden(redeemPop);