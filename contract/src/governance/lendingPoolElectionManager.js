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
    augmentedTerms,
    privateArgs.governed,
  );

  const questions = makeStore('questions');

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
    const [ proposalTreshold, totalSupply ] = await Promise.all([
      E(governedPF).getProposalTreshold(),
      E(governedPF).getTotalSupply()
    ])
    return { proposalTreshold, totalSupply }
  };
  
  const getQuestionData = (questionHandle) => {
    const { details, outcomeOfUpdate, instance } = questions.get(questionHandle);
    return { details, outcomeOfUpdate, instance };
  };

  const getAmountLockedInQuestion = (questionHandle) => {
    const { questionSeat } = questions.get(questionHandle);
    return questionSeat.getAmountAllocated(governanceKeyword);
   };

  const { voteOnApiInvocation, createdQuestion: createdApiQuestion } =
    await initApiGovernance();

  const makePoseQuestionsInvitation = () => {
    /** @type OfferHandler */
    const poseQuestion = async (poserSeat, offerArgs) => {
      const { totalSupply, proposalTreshold } = await getGovernanceMetadata();
      assert(!AmountMath.isEmpty(totalSupply), X`Can't pose questions when there's no governance token supply`);
      const amountToLock = assertCanPoseQuestions(poserSeat, governanceKeyword, proposalTreshold);

      // TODO: Implement some method like `assertOfferArgs`
      const {
        apiMethodName,
        methodArgs,
        voteCounterInstallation,
        deadline,
        vote
      } = offerArgs;

      const effectiveTotalSupply = vote ? totalSupply : AmountMath.subtract(totalSupply, amountToLock);
      assert(!AmountMath.isEmpty(effectiveTotalSupply), X`Can't pose questions when the effectiveTotalSuplly is zero.`);

      const { zcfSeat: questionSeat } = zcf.makeEmptySeatKit();

      questionSeat.incrementBy(
        poserSeat.decrementBy( harden({ [governanceKeyword]: amountToLock }) ),
      );

      popMint.mintGains({ POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) }, poserSeat);

      zcf.reallocate(poserSeat, questionSeat);

      await E(electorateFacet).updateTotalSupply(AmountMath.getValue(govBrand, effectiveTotalSupply));

      const {
        details,
        outcomeOfUpdate,
        instance,
      } = await voteOnApiInvocation(apiMethodName, methodArgs, voteCounterInstallation, deadline);

      const { questionHandle } = await details;
      questions.init(questionHandle, { questionSeat, details, outcomeOfUpdate, instance });

      if (vote) {
        const { positive } = makeApiInvocationPositions(apiMethodName, methodArgs);
        const voteWeight = AmountMath.getValue(govBrand, amountToLock);
        await E(electorateFacet).voteOnQuestion(questionHandle, [positive], voteWeight);
      }

      const popAmount = AmountMath.make(popBrand, harden([{
        govLocked: amountToLock,
        status: 'success',
        role: 'poser',
        questionHandle,
      }]));

      popMint.mintGains({ POP: popAmount }, poserSeat);
      poserSeat.exit();

      return 'The questison has been successfuly asked. Please redeem your tokens after the voting is ended.';
    };

    return zcf.makeInvitation(poseQuestion, 'PoseQuestionsInvittion');
  };

  const makeVoteOnQuestionInvitation = () => {
    /** @type OfferHandler */
    const voteOnQuestion = async (voterSeat, offerArgs) => {
      // TODO: assertOfferArgs - check positions valid
      const { questionHandle, positions } = offerArgs;
      assert(questions.has(questionHandle), X`There is no such question.`);

      const { questionSeat, instance } = questions.get(questionHandle);
      const voteCounterPublicFacetP = E(zoe).getPublicFacet(instance);
      const isQuestionOpen = await E(voteCounterPublicFacetP).isOpen();
      assert(isQuestionOpen, X`Voting is closed.`);

      const {
        give: { [governanceKeyword]: amountToLock }
      } = voterSeat.getProposal();

      questionSeat.incrementBy(
        voterSeat.decrementBy(harden({ [governanceKeyword]: amountToLock }))
      );
      zcf.reallocate(questionSeat, voterSeat);

      const popAmount = AmountMath.make(popBrand, harden([{
        govLocked: amountToLock,
        status: 'success',
        role: 'voter',
        questionHandle,
      }]));

      popMint.mintGains({ POP: popAmount }, voterSeat);
      voterSeat.exit();

      const voteWeight = AmountMath.getValue(govBrand, amountToLock);
      await E(electorateFacet).voteOnQuestion(questionHandle, positions, voteWeight);

      return 'Successfully voted. Do not forget to redeem your governance tokens once the voting is ended.';
    };

    return zcf.makeInvitation(voteOnQuestion, 'VoteOnQuestionInvitation');
  };

  const makeRedeemAssetInvitation = () => {
    /** @type OfferHandler */
    const redeem = async voterSeat => {
      const {
        give: { POP: amountToRedeem }
      } = voterSeat.getProposal();

      console.log({ amountToRedeem });
      const [{ questionHandle, govLocked }] = AmountMath.getValue(popBrand, amountToRedeem);
      // TODO: question should be closed
      assert(questions.has(questionHandle), X`No such question.`);
      const { questionSeat, instance } = questions.get(questionHandle);

      const voteCounterPublicFacetP = E(zoe).getPublicFacet(instance);
      const isQuestionOpen = await E(voteCounterPublicFacetP).isOpen();
      assert(!isQuestionOpen, X`Wait until the voting ends.`);

      questionSeat.incrementBy(
        voterSeat.decrementBy(harden({ POP: amountToRedeem }))
      );
      questionSeat.decrementBy(
        voterSeat.incrementBy({ [governanceKeyword]: govLocked }),
      );
      zcf.reallocate(questionSeat, voterSeat);
      popMint.burnLosses({ POP: amountToRedeem }, questionSeat);
      voterSeat.exit();

    return 'Thanks for participating in protocol governance.';
    };

    return zcf.makeInvitation(redeem, 'VoteOnQuestionInvitation');
  };

  const publicFacet = Far('PublicFacet', {
    makePoseQuestionsInvitation,
    makeVoteOnQuestionInvitation,
    makeRedeemAssetInvitation,
    getGovernedContract: () => governedInstance,
    getPopInfo: () => harden({ popBrand, popIssuer }),
    getQuestionData,
    getAmountLockedInQuestion,
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