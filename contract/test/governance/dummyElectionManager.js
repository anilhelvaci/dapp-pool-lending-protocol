import { E, Far } from '@endo/far';

/**
 * @file This file is used invoke electorate methods via offers.
 * Not planned to contain any logic. Might evolve to be the actual
 * ElectionManager code.
 *
 * @param {ZCF} zcf
 * @param {{
 *   electorateFacetInvitation: Invitation
 * }} privateArgs
 */

const start = async (zcf, privateArgs) => {
    const { electorateFacetInvitation } = privateArgs;
    /** @type ZoeService */
    const zoe = await zcf.getZoeService();

    /** @type UserSeat */
    const userSeatP = E(zoe).offer(electorateFacetInvitation);
    const electorateFacet = await E(userSeatP).getOfferResult();

    const creatorFacet = Far('DummyElectionManagerCreatorFacet', {
      makeAddQuestionInvitation: () => E(electorateFacet).makeAddQuestionInvitation(),
    });

    return { creatorFacet };
};

harden(start);
export { start };