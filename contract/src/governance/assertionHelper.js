import { assert, details as X } from '@agoric/assert';

const assertPoseQuestionOfferArgs = offerArgs => {
	const {
		apiMethodName,
		methodArgs,
		voteCounterInstallation,
		deadline,
		vote
	} = offerArgs;

	assert(apiMethodName && typeof apiMethodName === 'string', X`Bad apiMethodName`);
	assert(methodArgs && Array.isArray(methodArgs), X`Bad methodArgs`);
	assert(typeof vote === 'boolean', X`Bad vote`);
	assert(voteCounterInstallation, X`Bad voteCounterInstallation`);
	assert(deadline, X`Bad deadline`);
	return offerArgs;
};
harden(assertPoseQuestionOfferArgs);

const assertVoteOnQuestionOfferArgs = (offerArgs, questions) => {
	const { questionHandle, positions } = offerArgs;
	assert(questionHandle, X`Bad questionHandle`);
	assert(positions && Array.isArray(positions), X`Bad positions`);
	assert(questions.has(questionHandle), X`There is no such question.`);

	return { questionHandle, positions };
};
harden(assertVoteOnQuestionOfferArgs);


export {
	assertPoseQuestionOfferArgs,
	assertVoteOnQuestionOfferArgs,
}