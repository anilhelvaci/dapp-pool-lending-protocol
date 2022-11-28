import { QuorumRule } from '@agoric/governance';
import { natSafeMath } from '@agoric/zoe/src/contractSupport/index.js';
import { assert, details as X, q } from '@agoric/assert';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/far';
import { getOpenQuestions, getQuestion, startCounter } from '@agoric/governance/src/electorateTools.js';

const { ceilDivide } = natSafeMath;

const quorumThreshold = (committeeSize, quorumRule) => {
  switch (quorumRule) {
    case QuorumRule.MAJORITY:
      return ceilDivide(committeeSize, 2);
    case QuorumRule.ALL:
      return committeeSize;
    case QuorumRule.NO_QUORUM:
      return 0;
    default:
      throw Error(`${quorumRule} is not a recognized quorum rule`);
  }
};
harden(quorumThreshold);

/**
 *
 * @param {ZCFSeat} poserSeat
 * @param {String} keyword
 * @param {Amount} treshold
 */
const assertCanPoseQuestions = (poserSeat, keyword, treshold) => {
  const { give: { [keyword]: amountToLock } } = poserSeat.getProposal();
  assert(AmountMath.isGTE(amountToLock, treshold),
    X`The amount ${amountToLock} should be greater than or equal to the treshold amount ${treshold}`);

  return amountToLock;
};
harden(assertCanPoseQuestions);

/**
 * @param {ZCF} zcf
 * @param {ElectorateFacet} electorateFacet
 */
const getElectorateFacetInvitation = (zcf, electorateFacet) => {
  const electorateFacetHandler = () => Far(`ElectorateFacet`, electorateFacet);
  return zcf.makeInvitation(electorateFacetHandler, `electorateFacet`);
};
harden(getElectorateFacetInvitation);

const assertGovernedContextInitialized = (governedContext) => {
  console.log('governedContext', governedContext);
  const { totalSupply } = governedContext;
  assert(totalSupply,
    X`Make sure you initialize the governedContext with the following properities: totalSupply`);
};
harden(assertGovernedContextInitialized);

const calculateGovAmountFromValue = ({ govBrand, govDecimals }, { value, decimals } ) => {
  const effectiveDecimals = decimals ? decimals : govDecimals;
  return AmountMath.make(govBrand, value * 10n ** BigInt(effectiveDecimals));
};
harden(calculateGovAmountFromValue);

export {
  getQuestion,
  getOpenQuestions,
  startCounter,
  calculateGovAmountFromValue,
  assertGovernedContextInitialized,
  getElectorateFacetInvitation,
  assertCanPoseQuestions,
  quorumThreshold
};
