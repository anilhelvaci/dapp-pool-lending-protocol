import { makeStore } from '@agoric/store';
import { QuorumRule } from '@agoric/governance';
import { makeSubscriptionKit } from '@agoric/notifier';
import {
  quorumThreshold,
  assertCanPoseQuestions,
  getElectorateFacetInvitation,
  assertGovernedContextInitialized,
  getQuestion,
  getOpenQuestions,
  startCounter,
} from './tools.js';
import { Far } from '@endo/far';

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
  } = makeSubscriptionKit();

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

  /**
   *
   * @param {ZCFSeat} poserSeat
   * @param {Installation} voteCounter
   * @param {QuestionSpec} questionSpec
   */
  const addQuestion = async (poserSeat, voteCounter, questionSpec) => {
    assertGovernedContextInitialized(governedContext);
    assertCanPoseQuestions(poserSeat, governedContext.keyword, governedContext.treshold);

    const { zcfSeat: questionSeat } = zcf.makeEmptySeatKit();
    const { give: { [tokenKeyword]: amountToLock } } = poserSeat.getProposal();

    questionSeat.incrementBy(
      poserSeat.decrementBy({[tokenKeyword]: amountToLock})
    );

    zcf.reallocate(questionSeat, poserSeat);

    const { creatorFacet, publicFacet, deadline, questionHandle, instance } = startCounter(
      zcf,
      questionSpec,
      quorumThreshold(questionSpec.quorumRule),
      voteCounter,
      allQuestions,
      questionsPublisher,
    );

    const questionFacet = { voteCap: creatorFacet, publicFacet, deadline, questionSeat };
    allQuestions.set(questionHandle, questionFacet);

    return { publicFacet, instance };
  };

  const eleltorateFacet = {
    addQuestion,
    initGovernedContext,
  }

  const publicFacet = Far('PublicFacet', {
    getQuestionSubscriber: () => questionsSubscriber,
    getOpenQuestions: () => getOpenQuestions(allQuestions),
    getQuestion: handleP => getQuestion(handleP, allQuestions),
    getGovernedBrand: () => governedContext.brand,
  });

  const creatorFacet = Far('CreatorFacet', {
    getElectorateFacetInvitation: () => getElectorateFacetInvitation(zcf, eleltorateFacet),
    getQuestionSubscriber: () => questionsSubscriber,
    addQuestion,
    initGovernedContext,
  });

  return { creatorFacet, publicFacet };
};

harden(start);
export { start };