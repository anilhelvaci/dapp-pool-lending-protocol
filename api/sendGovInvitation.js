import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import { AmountMath } from '@agoric/ertp';
import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';

const { details: X } = assert;

const sendGovInvitation = async homeP => {
  assert(process.env.DEST_ADDR && process.env.INV_INDEX,
    X`Missing 'DEST_ADDR' or 'INV_INDEX' env variables.`);

  const { LENDING_POOL_CREATOR_FACET_ID } = lendingPoolDefaults;

  const { home, getValueFromScracth } = await makeSoloHelpers(homeP);
  const { namesByAddress } = await home;

  console.log('Getting LendingPoolCreatorFacet...');
  const { value: lendingPoolCF } = await getValueFromScracth(LENDING_POOL_CREATOR_FACET_ID);

  console.log('Getting Governance Invitation...');
  const invitation = await E(lendingPoolCF).getGovernanceInvitation(parseInt(process.env.INV_INDEX));
  console.log('Looking up depositFacet...');
  const destDepositFacet = E(namesByAddress).lookup(process.env.DEST_ADDR, 'depositFacet');
  console.log('Sending invitation...');
  await E(destDepositFacet).receive(invitation);
  console.log('Done.');
};

export default harden(sendGovInvitation);