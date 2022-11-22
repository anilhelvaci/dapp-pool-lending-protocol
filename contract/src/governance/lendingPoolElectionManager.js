import { E, Far } from '@endo/far';
import { makeStore } from '@agoric/store';
import { CONTRACT_ELECTORATE } from '@agoric/governance';
import { makeApiInvocationPositions, setupApiGovernance } from '@agoric/governance/src/contractGovernance/governApi.js';
import { PROPOSAL_TRESHOLD_KEY } from '../lendingPool/params.js';
import { assertCanPoseQuestions } from './tools.js';
import { AssetKind, AmountMath } from '@agoric/ertp';
import { assert, details as X } from '@agoric/assert';

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

  const limitedCreatorFacetP = E(governedCF).getLimitedCreatorFacet();
  const governedParamMgrRetrieverP = E(governedCF).getParamMgrRetriever();

  /** @type ZCFMint */
  const [popMint, govBrand, govIssuer, governanceKeyword] = await Promise.all([
    zcf.makeZCFMint('POP', AssetKind.SET), // Proof of participation token
    E(governedPF).getGovernanceBrand(),
    E(governedPF).getGovernanceIssuer(),
    E(governedPF).getGovernanceKeyword(),
  ]);

  const { brand: popBrand, issuer: popIssuer } = popMint.getIssuerRecord();
  await Promise.all([
    // zcf.saveIssuer(popIssuer, 'POP'),
    zcf.saveIssuer(govIssuer, governanceKeyword)
  ])

  /** @type {() => Promise<Instance>} */
  const getElectorateInstance = async () => {
    const invitationAmount = await E(governedPF).getInvitationAmount(
      CONTRACT_ELECTORATE,
    );
    return invitationAmount.value[0].instance;
  };

  /** @type {() => Promise<electorateFacet>} */
  const getUpdatedElectorateFacet = async () => {
    const newInvitation = await E(
      E(governedParamMgrRetrieverP).get({ key: 'governedParams' }),
    ).getInternalParamValue(CONTRACT_ELECTORATE);

    return E(E(zoe).offer(newInvitation)).getOfferResult();
  };

  const electorateFacet = await getUpdatedElectorateFacet();
  assert(electorateFacet, 'question poser facet must be initialized');

  const initApiGovernance = async () => {
    const [governedApis, governedNames] = await Promise.all([
      E(governedCF).getGovernedApis(),
      E(governedCF).getGovernedApiNames(),
    ]);
    if (governedNames.length) {
      return setupApiGovernance(
        zoe,
        governedInstance,
        governedApis,
        governedNames,
        timer,
        () => electorateFacet,
      );
    }

    // if we aren't governing APIs, voteOnApiInvocation shouldn't be called
    return {
      voteOnApiInvocation: () => {
        throw Error('api governance not configured');
      },
      createdQuestion: () => false,
    };
  };

  const getGovernanceMetadata = async () => {
    const [ propsalTreshold ] = await Promise.all([
      E(governedPF).getProposalTreshold()
    ])
    return { propsalTreshold }
  }

  const { voteOnApiInvocation, createdQuestion: createdApiQuestion } =
    await initApiGovernance();

  const makePoseQuestionsInvitation = () => {
    /** @type OfferHandler */
    const poseQuestion = async (poserSeat, offerArgs) => {
      const { governanceKeyword, proposalTreshold } = await getGovernanceMetadata();
      const amountToLock = assertCanPoseQuestions(poserSeat, governanceKeyword, proposalTreshold);

      // TODO: Implement some method like `assertOfferArgs`
      const {
        apiMethodName,
        methodArgs,
        voteCounterInstallation,
        deadline,
        vote
      } = offerArgs;

      const { zcfSeat: questionSeat } = zcf.makeEmptySeatKit();

      questionSeat.incrementBy(
        poserSeat.decrementBy( harden({ [governanceKeyword]: amountToLock }) ),
      );

      popMint.mintGains({ POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) }, poserSeat);

      zcf.reallocate(poserSeat, questionSeat);

      const {
        details,
        outcomeOfUpdate,
      } = await voteOnApiInvocation(apiMethodName, methodArgs, voteCounterInstallation, deadline);

      const { questionHandle } = await details;
      questionSeats.init(questionHandle, questionSeat);

      if (vote) {
        const { positive } = makeApiInvocationPositions(apiMethodName, methodArgs);
        const voteWeight = AmountMath.getValue(govBrand);
        await E(electorateFacet).voteOnQuestion(questionHandle, [positive], voteWeight);
      }

      const popAmount = AmountMath.make(popBrand, harden([{
        govLocked: amountToLock,
        status: 'success',
        role: 'poser',
        questionDetails: details,
        outcomeOfUpdate
      }]));

      popMint.mintGains({ POP: popAmount }, poserSeat);
      poserSeat.exit();

      return 'The questison has been successfuly asked. Please redeem your tokens after the voting is ended.';
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
    getCreatorFacet: () => limitedCreatorFacetP,
    getAdminFacet: () => adminFacet,
    getInstance: () => governedInstance,
    getPublicFacet: () => governedPF,
  });

  return { creatorFacet, publicFacet };
};

harden(start);
export { start };