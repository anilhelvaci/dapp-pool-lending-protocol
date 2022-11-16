import { makeStore } from '@agoric/store';
import { QuorumRule } from '@agoric/governance';
import { makePublishKit, makeSubscriptionKit } from '@agoric/notifier';
import {
  quorumThreshold,
  assertCanPoseQuestions,
  getElectorateFacetInvitation,
  assertGovernedContextInitialized,
  getQuestion,
  getOpenQuestions,
  startCounter,
} from './tools.js';
import { E, Far } from '@endo/far';

/**
 *
 * @param {ZCF} zcf
 */
const start = (zcf) => {

  const governedContext = {};
  const allQuestions = makeStore('Question');

  const {
    publisher: questionsPublisher,
    subscriber: questionsSubscriber,
  } = makePublishKit();

  const initGovernedContext = async (keyword, brand, issuer, treshold) => {
    Object.assign(governedContext, {
      keyword: keyword,
      brand: brand,
      issuer: issuer,
      treshold: treshold
    });
    await zcf.saveIssuer(issuer, keyword);
    harden(governedContext);
  };


  const makeAddQuestionInvitation = () => {
    /** @type OfferHandler */
    const addQuestion = async (poserSeat, { counterInstallation, questionSpec }) => {
      assertGovernedContextInitialized(governedContext);
      assertCanPoseQuestions(poserSeat, governedContext.keyword, governedContext.treshold);
      // TODO: assertOfferArgs

      const { zcfSeat: questionSeat } = zcf.makeEmptySeatKit();
      const { give: { [governedContext.keyword]: amountToLock } } = poserSeat.getProposal();

      questionSeat.incrementBy(
        poserSeat.decrementBy(harden({ [governedContext.keyword]: amountToLock })),
      );

      zcf.reallocate(questionSeat, poserSeat);

      const { creatorFacet, publicFacet, deadline, questionHandle, instance } = await startCounter(
        zcf,
        questionSpec,
        quorumThreshold(questionSpec.quorumRule),
        counterInstallation,
        allQuestions,
        questionsPublisher,
      );

      const questionFacet = { voteCap: creatorFacet, publicFacet, deadline, questionSeat };
      allQuestions.set(questionHandle, questionFacet);

      return { publicFacet, instance };
    };
    return zcf.makeInvitation(addQuestion, 'AddQuestion');
  };

  const eleltorateFacet = {
    makeAddQuestionInvitation,
    initGovernedContext,
  };

  const publicFacet = Far('PublicFacet', {
    getQuestionSubscriber: () => questionsSubscriber,
    getOpenQuestions: () => getOpenQuestions(allQuestions),
    getQuestion: handleP => getQuestion(handleP, allQuestions),
    getGovernedBrand: () => governedContext.brand,
  });

  const creatorFacet = Far('CreatorFacet', {
    getElectorateFacetInvitation: () => getElectorateFacetInvitation(zcf, eleltorateFacet),
    getQuestionSubscriber: () => questionsSubscriber,
    makeAddQuestionInvitation,
    initGovernedContext,
  });

  return { creatorFacet, publicFacet };
};

harden(start);
export { start };