import { AmountMath, AssetKind } from '@agoric/ertp';
import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { E } from '@endo/far';
import { POOL_PROPOSAL_CONFIG } from './askPoolQuestion/config.js';
import { TimeMath } from '@agoric/swingset-vat/src/vats/timer/timeMath.js';
import { makeApiInvocationPositions } from '@agoric/governance/src/contractGovernance/governApi.js';

const { details: X } = assert;

const voteOnQuestion = async homeP => {
  assert(process.env.LOCK_VAL_UNIT && process.env.POSITION,
    X`Missing one or more env variables: LOCK_VAL_UNIT, POSITION, QUESTION_INDEX`);
  const { home, getValueFromBoard, suggestIssuer } = await makeSoloHelpers(homeP);
  const {
    POP_ISSUER_BOARD_ID,
    LENDING_POOL_GOVERNOR_PUBLIC_FACET_BOARD_ID,
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    LENDING_POOL_ELECTORATE_PUBLIC_FACET_BOARD_ID,
  } = lendingPoolDefaults;

  const [
    { value: electionManagerPublicFacet },
    { value: electoratePublicFacet },
  ] = await Promise.all([
    getValueFromBoard(LENDING_POOL_GOVERNOR_PUBLIC_FACET_BOARD_ID),
    getValueFromBoard(LENDING_POOL_ELECTORATE_PUBLIC_FACET_BOARD_ID),
    suggestIssuer('POP Purse', POP_ISSUER_BOARD_ID) // Should stay at the last index
  ]);

  const walletBridgeP = E(home.wallet).getBridge();

  console.log('Getting last open question handle...');
  const openQuestions = await E(electoratePublicFacet).getOpenQuestions();
  assert(openQuestions.length > 0, X`No open questions`);
  const questionHandle = await openQuestions[openQuestions.length - 1];

  console.log('Getting question details...');
  const questionData = await E(electionManagerPublicFacet).getQuestionData(questionHandle);
  const { issue: {
    apiMethodName,
    methodArgs,
  } } = await questionData.details;
  console.log({ questionData, apiMethodName, methodArgs });

  console.log('Making positions...');
  const { positive, negative } = makeApiInvocationPositions(apiMethodName, methodArgs);
  const position = parseInt(process.env.POSITION) > 0 ? positive : negative;

  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(electionManagerPublicFacet).makeVoteOnQuestionInvitation(),
    installationHandleBoardId: LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        POP: {
          pursePetname: 'POP Purse',
          value: [],
        },
      },
      give: {
        LPT: {
          pursePetname: 'LPT Purse',
          value: BigInt(process.env.LOCK_VAL_UNIT) * 10n ** 6n,
        },
      },
      arguments: {
        questionHandle,
        positions: [position]
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.')
};

export default harden(voteOnQuestion);