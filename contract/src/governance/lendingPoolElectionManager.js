import { E, Far } from '@endo/far';
import { makeStore } from '@agoric/store';
import { CONTRACT_ELECTORATE } from '@agoric/governance';

/**
 *
 * @param {ZCF} zcf
 * @param {Object} privateArgs
 */
const start = async (zcf, privateArgs) => {
  /** @type ZoeService */
  const zoe = zcf.getZoeService();
  const {
    timer,
    governedContractInstallation,
    governed: {
      issuerKeywordRecord: governedIssuerKeywordRecord,
      terms: contractTerms,
    },
  } = zcf.getTerms();

  assert(
    contractTerms.governedParams[CONTRACT_ELECTORATE],
    X`Contract must declare ${CONTRACT_ELECTORATE} as a governed parameter`,
  );

  const augmentedTerms = harden({
    ...contractTerms,
    electionManager: zcf.getInstance(),
  });

  const {
    creatorFacet: governedCF,
    instance: governedInstance,
    publicFacet: governedPF,
    adminFacet,
  } = await E(zoe).startInstance(
    governedContractInstallation,
    governedIssuerKeywordRecord,
    // @ts-expect-error XXX governance types
    augmentedTerms,
    privateArgs.governed,
  );

  const questionSeats = makeStore('QuestionSeats');

  const limitedCreatorFacet = E(governedCF).getLimitedCreatorFacet();
  const governedParamMgrRetriever = E(governedCF).getParamMgrRetriever();

  /** @type {() => Promise<Instance>} */
  const getElectorateInstance = async () => {
    const invitationAmount = await E(governedPF).getInvitationAmount(
      CONTRACT_ELECTORATE,
    );
    return invitationAmount.value[0].instance;
  };

  /** @type {() => Promise<PoserFacet>} */
  const getUpdatedPoserFacet = async () => {
    const newInvitation = await E(
      E(governedParamMgrRetriever).get({ key: 'governedParams' }),
    ).getInternalParamValue(CONTRACT_ELECTORATE);

    return E(E(zoe).offer(newInvitation)).getOfferResult();
  };
  const poserFacet = await getUpdatedPoserFacet();
  assert(poserFacet, 'question poser facet must be initialized');

  const makePoseQuestionsInvitation = () => {
    /** @type OfferHandler */
    const poseQuestion = (poserSeat) => {

    };

    return zcf.makeInvitation(poseQuestion, 'PoseQuestionsInvittion');
  };

  const makeVoteOnQuestionInvitation = () => {
    /** @type OfferHandler */
    const voteOnQuestion = (voterSeat) => {

    };

    return zcf.makeInvitation(voteOnQuestion, 'VoteOnQuestionInvitation');
  };

  const makeRedeemAssetInvitation = () => {
    /** @type OfferHandler */
    const redeem = (voterSeat) => {

    };

    return zcf.makeInvitation(redeem, 'VoteOnQuestionInvitation');
  };

  const publicFacet = Far('PublicFacet', {
    makePoseQuestionsInvitation,
    makeVoteOnQuestionInvitation,
    makeRedeemAssetInvitation,
    getGovernedContract: () => governedInstance
  });

  const creatorFacet = Far('CreatorFacet', {
    getElectorateInstance,
    getCreatorFacet: () => limitedCreatorFacet,
    getAdminFacet: () => adminFacet,
    getInstance: () => governedInstance,
    getPublicFacet: () => governedPF,
  });

  return { creatorFacet, publicFacet };
};

harden(start);
export { start };