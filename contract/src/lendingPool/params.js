// @ts-check

import './types.js';

import {
  makeParamManagerSync,
  makeParamManager,
  CONTRACT_ELECTORATE,
  ParamTypes
} from '@agoric/governance';
import { makeStoredPublisherKit } from '@agoric/notifier';

export const CHARGING_PERIOD_KEY = 'ChargingPeriod';
export const RECORDING_PERIOD_KEY = 'RecordingPeriod';
export const PRICE_CHECK_PERIOD_KEY = 'PriceCheckPeriod'

export const LIQUIDATION_MARGIN_KEY = 'LiquidationMargin';
export const INITIAL_EXCHANGE_RATE_KEY = 'InitialExchangeRateFee';
export const BASE_RATE_KEY = 'BaseRate';
export const MULTIPILIER_RATE_KEY = 'MultipilierRate';
export const PENALTY_RATE_KEY = 'PenaltyRate';
export const PROPOSAL_TRESHOLD_KEY = 'ProposalTreshold';

/**
 * @param {Amount} electorateInvitationAmount
 */
const makeElectorateParams = electorateInvitationAmount => {
  return harden({
    [CONTRACT_ELECTORATE]: [ParamTypes.INVITATION, electorateInvitationAmount],
  });
};

/**
 * @param {LendingPoolTiming} loanTiming
 * @param {Rates} rates
 */
const makeLoanParams = (loanTiming, rates) => {
  return {
    [CHARGING_PERIOD_KEY]: [ParamTypes.NAT,  loanTiming.chargingPeriod],
    [RECORDING_PERIOD_KEY]: [ParamTypes.NAT, loanTiming.recordingPeriod],
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
    [BASE_RATE_KEY]: [ParamTypes.RATIO, rates.baseRate],
    [MULTIPILIER_RATE_KEY]: [ParamTypes.RATIO, rates.multipilierRate],
  };
};

/**
 * @param {ERef<StorageNode>} storageNode
 * @param {ERef<Marshaller>} marshaller
 * @param {LendingPoolTiming} initialValues
 */
const makeLoanTimingManager = (storageNode, marshaller, initialValues) => {
  return makeParamManagerSync(makeStoredPublisherKit(storageNode, marshaller),{
    [CHARGING_PERIOD_KEY]: [ParamTypes.NAT, initialValues.chargingPeriod],
    [RECORDING_PERIOD_KEY]: [ParamTypes.NAT, initialValues.recordingPeriod],
    [PRICE_CHECK_PERIOD_KEY]: [ParamTypes.NAT, initialValues.priceCheckPeriod] // TODO this now deprecated and not being used anywhere, should remove it
  })
};

/**
 * @param {ERef<StorageNode>} storageNode
 * @param {ERef<Marshaller>} marshaller
 * @param {Rates} rates
 */
const makeLoanParamManager = (storageNode, marshaller, rates) => {
  return makeParamManagerSync(makeStoredPublisherKit(storageNode, marshaller), {
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
  })
};

/**
 * @param {ERef<StorageNode>} storageNode
 * @param {ERef<Marshaller>} marshaller
 * @param {Rates} rates
 */
const makePoolParamManager = (storageNode, marshaller, rates) => {
  return makeParamManagerSync(makeStoredPublisherKit(storageNode, marshaller), {
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
    [INITIAL_EXCHANGE_RATE_KEY]: [ParamTypes.RATIO, rates.initialExchangeRate],
    [BASE_RATE_KEY]: [ParamTypes.RATIO, rates.baseRate],
    [MULTIPILIER_RATE_KEY]: [ParamTypes.RATIO, rates.multipilierRate],
    [PENALTY_RATE_KEY]: [ParamTypes.RATIO, rates.penaltyRate],
  })
};

/**
 * @param {ERef<StorageNode>} storageNode
 * @param {ERef<Marshaller>} marshaller
 * @param {ERef<ZoeService>} zoe
 * @param {Invitation} electorateInvitation
 * @returns {Promise<{
 *   getParams: GetGovernedLoanParams,
 *   getInvitationAmount: (name: string) => Amount,
 *   getInternalParamValue: (name: string) => Invitation,
 *   updateElectorate: (invitation: Invitation) => void,
 * }>}
 */
const makeElectorateParamManager = async (zoe, storageNode, marshaller, electorateInvitation) => {
  return makeParamManager(makeStoredPublisherKit(storageNode, marshaller), {
      [CONTRACT_ELECTORATE]: [ParamTypes.INVITATION, electorateInvitation],
    },
    zoe);
};

/**
 * @param {{
 *   storageNode,
 *   marshaller
 * }} publishKitParams
 * @param {ERef<PriceManager>} priceManager
 * @param {LoanTiming} loanTiming
 * @param {Installation} liquidationInstall
 * @param {ERef<TimerService>} timerService
 * @param {Amount} invitationAmount
 * @param {Rates} rates
 * @param {XYKAMMPublicFacet} ammPublicFacet
 * @param {Brand} compareCurrencyBrand
 * @param {{
 *   keyword: String,
 *   units: BigInt,
 *   decimals: Number,
 *   committeeSize: Number
 * }} governance
 */
const makeGovernedTerms = (
  { storageNode, marshaller },
  priceManager,
  loanTiming,
  liquidationInstall,
  timerService,
  invitationAmount,
  rates,
  ammPublicFacet,
  compareCurrencyBrand,
  governance
) => {
  const timingParamMgr = makeLoanTimingManager(storageNode, marshaller, loanTiming);

  const rateParamMgr = makeLoanParamManager(storageNode, marshaller, rates);

  return harden({
    ammPublicFacet,
    priceManager,
    loanParams: rateParamMgr.getParams(),
    loanTimingParams: timingParamMgr.getParams(),
    timerService,
    liquidationInstall,
    governedParams: makeElectorateParams(invitationAmount),
    governance,
    compareCurrencyBrand
  });
};

harden(makeLoanParamManager);
harden(makePoolParamManager);
harden(makeElectorateParamManager);
harden(makeGovernedTerms);
harden(makeLoanParams);
harden(makeElectorateParams);

export {
  makeElectorateParamManager,
  makeLoanParamManager,
  makePoolParamManager,
  makeGovernedTerms,
  makeLoanParams,
  makeElectorateParams,
};
