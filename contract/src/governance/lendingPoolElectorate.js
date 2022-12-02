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
import { makeHandle } from '@agoric/zoe/src/makeHandle.js';

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

  const updateTotalSupply = totalSupply => {
    governedContext.totalSupply = totalSupply;
  };

  const addQuestion = async (counterInstallation, questionSpec) => {
    assertGovernedContextInitialized(governedContext);

    const { publicFacet, instance } = await startCounter(
      zcf,
      questionSpec,
      quorumThreshold(governedContext.totalSupply, questionSpec.quorumRule),
      counterInstallation,
      allQuestions,
      questionsPublisher,
    );

    return { publicFacet, instance };
  };

  const voteOnQuestion = (questionHandle, positions, shares) => {
    const { voteCap } = allQuestions.get(questionHandle);
    return E(voteCap).submitVote(makeHandle('Voter'), positions, shares);
  };

  const eleltorateFacet = {
    addQuestion,
    voteOnQuestion,
    updateTotalSupply,
  };

  const publicFacet = Far('PublicFacet', {
    getQuestionSubscriber: () => questionsSubscriber,
    getOpenQuestions: () => getOpenQuestions(allQuestions),
    getQuestion: handleP => getQuestion(handleP, allQuestions),
  });

  const creatorFacet = Far('CreatorFacet', {
    getElectorateFacetInvitation: () => getElectorateFacetInvitation(zcf, eleltorateFacet),
    getQuestionSubscriber: () => questionsSubscriber,
    addQuestion,
    voteOnQuestion,
    updateTotalSupply,
  });

  return { creatorFacet, publicFacet };
};

harden(start);
export { start };