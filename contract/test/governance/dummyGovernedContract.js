import { Far } from '@endo/marshal';
import { makeElectorateParamManager } from '../../src/lendingPool/params.js';
import { CONTRACT_ELECTORATE, makeParamManager, ParamTypes } from '@agoric/governance';
import { makePublishKit, makeStoredPublisherKit } from '@agoric/notifier';
import { AssetKind, AmountMath } from '@agoric/ertp';
import { assert, details as X } from '@agoric/assert';
import { makePromiseKit } from '@endo/promise-kit';
import { ceilMultiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport/ratio.js';

/**
 *
 * @param {ZCF} zcf
 * @param {{
 *   initialPoserInvitation: Invitation
 * }} privateArgs
 */
const start = async (zcf, privateArgs) => {
  const zoe = zcf.getZoeService();
  const { initialPoserInvitation, storageNode, marshaller } = privateArgs;

  const paramManager = makeParamManager(
    makeStoredPublisherKit(storageNode, marshaller),
    { [CONTRACT_ELECTORATE]: [ParamTypes.INVITATION, initialPoserInvitation] },
    zoe);

  /**
   * @type ZCFMint
   */
  const govMint = await zcf.makeZCFMint('GOV', AssetKind.NAT, { decimalPlaces: 6 });
  const { brand: govBrand, issuer: govIssuer } = govMint.getIssuerRecord();
  /**
   * @type {Amount<K>}
   */
  const limit = AmountMath.make(govBrand, 5n * 10n ** 6n + 1n); // 5 units of GOV at a time at max.
  /**
   * @type {Ratio}
   */
  const tresholdRatio = makeRatio(2n, govBrand);
  /**
   * @type {Amount<K>}
   */
  let totalSupply = AmountMath.makeEmpty(govBrand);

  const makeFaucetInvitation = () => {
    /**
     * @type OfferHandler
     */
    const faucetHandler = (seat) => {
      const {
        want: { GOV: amountWanted }
      } = seat.getProposal();

      assert(AmountMath.isGTE(limit, amountWanted),
        X`Can only mint ${limit} at max at a time`);

      govMint.mintGains(harden({ GOV: amountWanted }), seat);
      seat.exit();

      totalSupply = AmountMath.add(totalSupply, amountWanted);

      return 'Sucess! Check your payouts.'
    };

    return zcf.makeInvitation(faucetHandler, 'Faucet');
  };

  const testPromiseKit = makePromiseKit();
  const resolveArgument = (argument) => {
    testPromiseKit.resolve(`Hello ${argument}!!!`);
  };

  const getProposalTreshold = () => {
    return ceilMultiplyBy(totalSupply, tresholdRatio);
  };

  const getParamMgrRetriever = () =>
    Far('paramManagerRetriever', {
      get: paramDesc => {
        console.log(paramDesc);
        return paramManager;
      },
    });

  const publicFacet = Far('Public Facet', {
    getGovernanceBrand: () => govBrand,
    getGovernanceIssuer: () => govIssuer,
    getGovernanceKeyword: () => 'GOV',
    getTotalSupply: () => totalSupply,
    makeFaucetInvitation,
    getTestPromise: () => testPromiseKit.promise,
    getProposalTreshold,
  });

  const limitedCreatorFacet = Far('Limited Creator Facet', {

  });

  const lendingPoolWrapper = Far('powerful lendingPool wrapper', {
    getParamMgrRetriever,
    getLimitedCreatorFacet: () => limitedCreatorFacet,
    getGovernedApis: () => harden({ resolveArgument }),
    getGovernedApiNames: () => harden(['resolveArgument']),
  });

  return harden({
    creatorFacet: lendingPoolWrapper,
    publicFacet,
  });

};

harden(start);
export { start };