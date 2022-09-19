// @ts-check
import { Far } from '@endo/marshal';
import { assertProposalShape } from '@agoric/zoe/src/contractSupport/index.js';
import { AssetKind } from '@agoric/ertp';
import { assert, details as X} from '@agoric/assert';

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

  let faucetOpen = true;

  const assetMint = await zcf.makeZCFMint(keyword, AssetKind.NAT, displayInfo);
  const { issuer } = assetMint.getIssuerRecord();

  const assertWantAmountRecord = (seat, keyword) => {
    const assertAmountKeywordRecord = {};
    assertAmountKeywordRecord[keyword] = null;
    assertProposalShape(seat, { want: assertAmountKeywordRecord });
  };

  function makeFaucetInvitation() {
    /** @param {ZCFSeat} seat */
    async function faucetHook(seat) {
      assertWantAmountRecord(seat, keyword);
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

  const closeFaucet = () => {
    faucetOpen = false;
  };

  const openFaucet = () => {
    faucetOpen = true;
  };

  const creatorFacet = Far('faucetInvitationMaker', { closeFaucet, openFaucet });
  const publicFacet = Far('publicFacet',
    {
      hello: () => `Hello from ${keyword} liquidity provider`,
      getIssuer: () => issuer,
      makeFaucetInvitation,
    });
  return harden({ creatorFacet, publicFacet });
}
