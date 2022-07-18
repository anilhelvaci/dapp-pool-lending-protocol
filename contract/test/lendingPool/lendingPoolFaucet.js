// @ts-check
import { Far } from '@endo/marshal';
import { assertProposalShape } from '@agoric/zoe/src/contractSupport/index.js';
import { AssetKind } from '@agoric/ertp';

/**
 * This is a faucet that provides liquidity for the ertp asset created
 * using the parameter in terms. Just for demonstration purposes.
 */

/** @type {ContractStartFn} */
export async function start(zcf) {
  const {
    keyword,
    displayInfo,
  } = zcf.getTerms();

  console.log(`${keyword} deployed successfully`);

  const assetMint = await zcf.makeZCFMint(keyword, AssetKind.NAT, displayInfo);
  const { issuer } = assetMint.getIssuerRecord();

  function makeFaucetInvitation() {
    /** @param {ZCFSeat} seat */
    async function faucetHook(seat) {
      const assertAmountKeywordRecord = {};
      assertAmountKeywordRecord[keyword] = null;
      assertProposalShape(seat, { want: assertAmountKeywordRecord });
      console.log("*[Proposal]*", seat.getProposal());
      const {
        want: proposalWantKeywordRecord,
      } = seat.getProposal();

      assetMint.mintGains(harden(proposalWantKeywordRecord), seat);
      seat.exit();
      return `success`;
    }

    return zcf.makeInvitation(faucetHook, 'Provide Liquidity');
  }

  const creatorFacet = Far('faucetInvitationMaker', { makeFaucetInvitation });
  const publicFacet = Far('publicFacet',
    {
      hello: () => `Hello from ${keyword} liquidity provider`,
      getIssuer: () => issuer,
    });
  return harden({ creatorFacet, publicFacet });
}
