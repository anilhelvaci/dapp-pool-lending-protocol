import { assert, details as X } from '@agoric/assert';
import { E, Far } from '@endo/far';
import { ceilMultiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { AmountMath } from '@agoric/ertp';
import { calculateGovAmountFromValue } from '../../src/governance/tools.js';

/**
 *
 * @param t
 * @param {ZoeService} zoe
 * @param governedPF
 * @param electionManagerPublicFacet
 * @param electoratePublicFacet
 */
const makeGovernanceAssertionHelpers = async (t, zoe, governedPF, electionManagerPublicFacet, electoratePublicFacet) => {

  const govBrandP = E(governedPF).getGovernanceBrand();
  const [govBrand, { decimalPlaces: govDecimals }, govIssuer, govKeyword, {
    popBrand,
    popIssuer,
  }, electorateSubscriber] = await Promise.all([
    govBrandP,
    E(govBrandP).getDisplayInfo(),
    E(governedPF).getGovernanceIssuer(),
    E(governedPF).getGovernanceKeyword(),
    E(electionManagerPublicFacet).getPopInfo(),
    E(electoratePublicFacet).getQuestionSubscriber(),
  ]);

  let totalGovFetched = AmountMath.makeEmpty(govBrand);

  const checkGovFetchedCorrectly = async (fetchSeat, { unitsWanted, decimals }) => {
    const [offerResult, govPayout] = await Promise.all([
      E(fetchSeat).getOfferResult(),
      E(fetchSeat).getPayout(govKeyword),
    ]);

    const govAmountWanted = calculateGovAmountFromValue({ govBrand, govDecimals }, { value: unitsWanted, decimals });
    const [govAmountReceived, propTreshold] = await Promise.all([
      E(govIssuer).getAmountOf(govPayout),
      E(governedPF).getProposalTreshold(),
    ]);
    t.deepEqual(offerResult, 'Sucess! Check your payouts.');
    t.deepEqual(govAmountReceived, govAmountWanted);

    totalGovFetched = AmountMath.add(totalGovFetched, govAmountReceived);
    console.log({propTreshold})
    t.deepEqual(propTreshold, ceilMultiplyBy(
      totalGovFetched,
      makeRatio(2n, govBrand),
    ));

    return govPayout;
  };

  /**
   * @param {UserSeat} questionSeat
   * @param {{
   *   questionIndex: number
   * }} expected
   */
  const checkQuestionAskedCorrectly = async (questionSeat, { questionIndex }) => {

    const questionOfferResult = await E(questionSeat).getOfferResult();
    const popPayoutP = E(questionSeat).getPayout('POP');

    const [openQuestions, popPayout, popAmountReceived, publication] = await Promise.all([
      E(electoratePublicFacet).getOpenQuestions(),
      popPayoutP,
      E(popIssuer).getAmountOf(popPayoutP),
      E(electorateSubscriber).subscribeAfter(),
    ]);

    const { value: [{ questionHandle }] } = popAmountReceived;
    const questionFromElectorateP = E(electoratePublicFacet).getQuestion(openQuestions[questionIndex]);
    const voteCounterFromElectorate = await E(questionFromElectorateP).getVoteCounter();
    const { instance } = await E(electionManagerPublicFacet).getQuestionData(questionHandle);

    t.log(popAmountReceived);
    t.log(publication);

    const { head: { value: { questionHandle: handleFromSubscriber } } } = publication;

    t.deepEqual(questionOfferResult,
      'The questison has been successfuly asked. Please redeem your tokens after the voting is ended.');
    t.truthy(openQuestions.length === (questionIndex + 1));
    t.deepEqual(openQuestions[questionIndex], questionHandle);
    t.deepEqual(handleFromSubscriber, questionHandle);
    t.deepEqual(openQuestions[questionIndex], handleFromSubscriber);
    t.deepEqual(voteCounterFromElectorate, instance);

    return harden({ questionHandle, popPayment: popPayout });
  };

  const checkVotedSuccessfully = async (voteSeat, { questionHandle, valueLocked, decimals }) => {
    const [offerResult, payout] = await Promise.all([
      E(voteSeat).getOfferResult(),
      E(voteSeat).getPayout('POP'),
    ]);

    const amountLocked = calculateGovAmountFromValue({ govBrand, govDecimals }, { value: valueLocked, decimals });

    const { value: [popContent] } = await E(popIssuer).getAmountOf(payout);

    t.is(offerResult,
      'Successfully voted. Do not forget to redeem your governance tokens once the voting is ended.');
    t.deepEqual(popContent, {
      govLocked: amountLocked,
      status: 'success',
      role: 'voter',
      questionHandle,
    });

    return harden({ popPayment: payout });
  };

  /**
   *
   * @param {Array<UserSeat>} seats
   */
  const calculateTotalAmountLockedFromPop = async (seats) => {

    let totalAmount = AmountMath.makeEmpty(govBrand);

    const currentAllocations = await Promise.all(
      [...seats].map(seat => E(seat).getCurrentAllocationJig()),
    );

    currentAllocations.forEach(allocation => {
      const { POP: { value: [{ govLocked }] } } = allocation;
      totalAmount = AmountMath.add(totalAmount, govLocked);
    });

    return totalAmount;
  };

  /**
   *
   * @param questionHandle
   * @param result
   * @param {Array<UserSeat>} seats
   * @param {{
   *   resultPromise: Promise,
   *   expectedResolveValue
   * }} executionOutcome
   * @returns {Promise<void>}
   */
  const checkVotingEndedProperly = async ({ questionHandle, result, seats, executionOutcome = undefined }) => {

    const { outcomeOfUpdate, instance } = await E(electionManagerPublicFacet).getQuestionData(questionHandle);
    const voteCounterPublicFacetP = E(zoe).getPublicFacet(instance);
    const [actualResult, isOpen, totalAmountFromSeats, questionSeatGovAllocated] = await Promise.all([
      outcomeOfUpdate,
      E(voteCounterPublicFacetP).isOpen(),
      calculateTotalAmountLockedFromPop(seats),
      E(electionManagerPublicFacet).getAmountLockedInQuestion(questionHandle),
    ]);


    t.deepEqual(actualResult, result);
    t.is(isOpen, false);
    t.deepEqual(totalAmountFromSeats, questionSeatGovAllocated);

    if (executionOutcome) {
      const actualResolveValue = await (executionOutcome.resultPromise);
      t.deepEqual(executionOutcome.expectedResolveValue, actualResolveValue);
    }

  };

  /**
   *
   * @param {UserSeat} redeemSeat
   * @param {BigInt} unitsWanted
   * @param {BigInt} decimals
   */
  const checkRedeemedProperly = async (redeemSeat, { unitsWanted, decimals }) => {
    const govAmountExpected = calculateGovAmountFromValue({ govBrand, govDecimals }, { value: unitsWanted, decimals });
    const payoutP = E(redeemSeat).getPayout(govKeyword);

    const [offerResult, receivedAmount] = await Promise.all([
      E(redeemSeat).getOfferResult(),
      E(govIssuer).getAmountOf(payoutP),
    ]);

    t.is(offerResult, 'Thanks for participating in protocol governance.');
    t.deepEqual(govAmountExpected, receivedAmount);
  };

  /**
   *
   * @param {Handle} questionHandle
   * @param {{
   *   value: bigint,
   *   decimals: bigint
   * }} expected
   */
  const checkQuestionBalance = async ({ questionHandle, expected }) => {
    const expectedAmount = calculateGovAmountFromValue({ govBrand, govDecimals }, expected);
    const actualBalance = await E(electionManagerPublicFacet).getAmountLockedInQuestion(questionHandle);

    t.deepEqual(expectedAmount, actualBalance);
  };

  return {
    checkGovFetchedCorrectly,
    checkQuestionAskedCorrectly,
    checkVotedSuccessfully,
    checkVotingEndedProperly,
    checkRedeemedProperly,
    checkQuestionBalance,
  };
};

harden(makeGovernanceAssertionHelpers);
export { makeGovernanceAssertionHelpers };

