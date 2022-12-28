import { makeSoloHelpers, makeWithdrawInvitationHelper } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';

const fetchGovTokens = async homeP => {
  const GOV_PURSE_NAME = 'LPT Purse';
  const GOV_KEYWORD = 'LPT';
  const soloHelpers = await makeSoloHelpers(homeP);

  const { LENDING_POOL_INSTANCE_BOARD_ID, GOVERNANCE_ISSUER_BOARD_ID } = lendingPoolDefaults;
  const { home, getPurseFromWallet } = soloHelpers;

  const walletBridgeP = E(home.wallet).getBridge();

  console.log('Making withdrawHelper and creating govPurse...');
  const [{ withdraw }] = await Promise.all([
    makeWithdrawInvitationHelper({
      soloHelpers,
      instanceId: LENDING_POOL_INSTANCE_BOARD_ID,
      govDescription: 'Governance Faucet',
    }),
    E(walletBridgeP).suggestIssuer(GOV_PURSE_NAME, GOVERNANCE_ISSUER_BOARD_ID)
  ]);

  console.log('Withdrawing invitation...');
  const [invitation, { purse: lptPurse }] = await Promise.all([
    withdraw(),
    getPurseFromWallet(GOV_PURSE_NAME),
  ]);
  console.log({ invitation });

  console.log('Sending offer for governance tokens...');
  const userSeat = E(home.zoe).offer(invitation);

  console.log('Getting offerResult...');
  const offerResult = await E(userSeat).getOfferResult();

  const payout = await E(userSeat).getPayout(GOV_KEYWORD);
  const govAmount = await E(lptPurse).deposit(payout);
  console.log('Done:', { payout, offerResult, govAmount });
};

export default harden(fetchGovTokens);
