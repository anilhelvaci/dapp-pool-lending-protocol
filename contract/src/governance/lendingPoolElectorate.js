import { makeStore } from '@agoric/store';
import { QuorumRule } from '@agoric/governance';
import { getOpenQuestions, getQuestion, startCounter } from '@agoric/governance/src/electorateTools.js';
import { makeSubscriptionKit } from '@agoric/notifier';
import { quorumThreshold, assertCanPoseQuestions } from './tools.js';


/**
 *
 * @param {ZCF} zcf
 */
const start = (zcf) => {

  /** @type {{tokenKeyword: String, treshold: Amount}} terms */
  const { tokenKeyword, treshold } = zcf.getTerms();

  const allQuestions = makeStore('Question');

  const {
    publisher: questionsPublisher,
    subscriber: questionsSubscriber,
  } = makeSubscriptionKit();

  /**
   *
   * @param {ZCFSeat} poserSeat
   * @param {Installation} voteCounter
   * @param {QuestionSpec} questionSpec
   */
  const addQuestion = async (poserSeat, voteCounter, questionSpec) => {
    assertCanPoseQuestions(poserSeat, tokenKeyword, treshold);

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

  const publicFacet = {
    getOpenQuestions: () => getOpenQuestions(allQuestions),
    getQuestion: handleP => getQuestion(handleP, allQuestions),
  };

  const creatorFacet = {
    addQuestion
  };

  return { creatorFacet, publicFacet };
};

harden(start);
export { start };