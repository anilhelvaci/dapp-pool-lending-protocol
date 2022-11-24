import { AmountMath, AssetKind } from '@agoric/ertp';
import { E } from '@endo/far';

/**
 *
 * @param {ZoeService} zoe
 * @param governedPF
 * @param electionManagerPublicFacet
 */
const makeGovernanceScenarioHeplpers = async (zoe, governedPF, electionManagerPublicFacet) => {

  const govBrandP = E(governedPF).getGovernanceBrand();
  const [govBrand, { decimalPlaces: govDecimals }, govIssuer, govKeyword, { popBrand, popIssuer }] = await Promise.all([
    govBrandP,
    E(govBrandP).getDisplayInfo(),
    E(governedPF).getGovernanceIssuer(),
    E(governedPF).getGovernanceKeyword(),
    E(electionManagerPublicFacet).getPopInfo(),
  ]);

  /**
   * @param {{
   *   unitsWanted: BigInt,
   *   decimals: BigInt
   * }}
   */
  const fetchGovFromFaucet = async ({ unitsWanted, decimals }) => {
    const effectiveDecimals = decimals ? decimals : govDecimals;
    const amountWanted = AmountMath.make(govBrand, unitsWanted * 10n ** BigInt(effectiveDecimals));

    return await E(zoe).offer(
      E(governedPF).makeFaucetInvitation(),
      harden({ want: { [govKeyword]: amountWanted } }),
    );
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
      harden({give: { [govKeyword]: voteAmount },
        want: {POP: AmountMath.makeEmpty(popBrand, AssetKind.SET)}}),
      harden({[govKeyword]: votePayment}),
      harden({ questionHandle, positions: [position] })
    )
  };

  return {
    fetchGovFromFaucet,
    addQuestion,
    voteOnQuestion,
  };
};

harden({
  makeGovernanceScenarioHeplpers
});

export {
  makeGovernanceScenarioHeplpers
};