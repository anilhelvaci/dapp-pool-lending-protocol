import { AmountMath, AssetKind } from '@agoric/ertp';
import { E } from '@endo/far';
import { calculateGovAmountFromValue } from '../../src/governance/tools.js';

/**
 *
 * @param {ZoeService} zoe
 * @param governedPF
 * @param electionManagerPublicFacet
 * @param governedCF
 */
const makeGovernanceScenarioHeplpers = async (zoe, governedPF, electionManagerPublicFacet, governedCF) => {

  const govBrandP = E(governedPF).getGovernanceBrand();
  const [govBrand, { decimalPlaces: govDecimals }, govIssuer, govKeyword, {
    popBrand,
    popIssuer,
  }, govCommiteeSize] = await Promise.all([
    govBrandP,
    E(govBrandP).getDisplayInfo(),
    E(governedPF).getGovernanceIssuer(),
    E(governedPF).getGovernanceKeyword(),
    E(electionManagerPublicFacet).getPopInfo(),
    E(governedPF).getCommitteeSize(),
  ]);

  /**
   * @param {{
   *   unitsWanted: BigInt,
   *   decimals: BigInt
   * }} expected
   */
  const fetchGovFromFaucet = async ({ unitsWanted, decimals }) => {
    const amountWanted = calculateGovAmountFromValue({ govBrand, govDecimals }, { value: unitsWanted, decimals });

    return E(zoe).offer(
      E(governedPF).makeFaucetInvitation(),
      harden({ want: { [govKeyword]: amountWanted } }),
    );
  };

  const fetchGovTokenSingleMember = index => {
    const invitationP = E(governedCF).getGovernanceInvitation(index);

    return E(zoe).offer(
      invitationP,
    )
  };

  const fetchGovTokensAllCommittee = () => {
    const seatsP = [...Array(govCommiteeSize)].map((_, index) => fetchGovTokenSingleMember(index));
    const payoutsP = seatsP.map(seatp => E(seatp).getPayout(govKeyword));
    return Promise.all(payoutsP);
  };

  /**
   *
   * @param {Payment} govPayment
   * @param offerArgs
   */
  const addQuestion = async (govPayment, offerArgs) => {
    const govAmount = await E(govIssuer).getAmountOf(govPayment);

    const propsal = harden({
      give: { [govKeyword]: govAmount },
      want: { POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) },
    });

    const payment = harden({
      [govKeyword]: govPayment,
    });

    return await E(zoe).offer(
      E(electionManagerPublicFacet).makePoseQuestionsInvitation(),
      propsal,
      payment,
      offerArgs,
    );
  };

  const voteOnQuestion = async (votePayment, position, questionHandle) => {
    const voteAmount = await E(govIssuer).getAmountOf(votePayment);

    return E(zoe).offer(
      E(electionManagerPublicFacet).makeVoteOnQuestionInvitation(),
      harden({
        give: { [govKeyword]: voteAmount },
        want: { POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) },
      }),
      harden({ [govKeyword]: votePayment }),
      harden({ questionHandle, positions: [position] }),
    );
  };

  const voteOnQuestionBadOfferArgs = async (votePayment, offerArgs) => {
    const voteAmount = await E(govIssuer).getAmountOf(votePayment);

    return E(zoe).offer(
      E(electionManagerPublicFacet).makeVoteOnQuestionInvitation(),
      harden({
        give: { [govKeyword]: voteAmount },
        want: { POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) },
      }),
      harden({ [govKeyword]: votePayment }),
      harden(offerArgs),
    );
  };

  const voteWithMaliciousToken = async (payment, amount, position, questionHandle) => {
    return E(zoe).offer(
      E(electionManagerPublicFacet).makeVoteOnQuestionInvitation(),
      harden({
        give: { [govKeyword]: amount },
        want: { POP: AmountMath.makeEmpty(popBrand, AssetKind.SET) }
      }),
      harden({ [govKeyword]: payment }),
      harden({ questionHandle, positions: [position] }),
    )
  };

  const redeem = async (popPayment, { redeemValue, decimals }) => {
    const popAmount = await E(popIssuer).getAmountOf(popPayment);
    const amountWanted = calculateGovAmountFromValue({ govBrand, govDecimals }, { value: redeemValue, decimals })

    return E(zoe).offer(
      E(electionManagerPublicFacet).makeRedeemAssetInvitation(),
      harden({
        give: { POP: popAmount },
        want: { [govKeyword]: amountWanted }
      }),
      harden({ POP: popPayment })
    );
  };

  /**
   *
   * @param {Payment} govPayout
   * @param {{
   *   value: BigInt,
   *   decimals: BigInt
   * }} expected
   * @returns {Promise<*>}
   */
  const splitGovPayout = async (govPayout, expected) => {
    const wantedAmount = calculateGovAmountFromValue({govBrand, govDecimals}, expected);
    return await E(govIssuer).split(govPayout, wantedAmount);
  };

  return {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
    voteWithMaliciousToken,
    redeem,
    splitGovPayout,
    fetchGovTokenSingleMember,
    fetchGovTokensAllCommittee,
    voteOnQuestionBadOfferArgs
  };
};

harden({
  makeGovernanceScenarioHeplpers
});

export {
  makeGovernanceScenarioHeplpers
};