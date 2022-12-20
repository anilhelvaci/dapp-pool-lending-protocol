// @ts-check

import './types.js';

import {
  makeParamManagerSync,
  makeParamManager,
  CONTRACT_ELECTORATE,
  ParamTypes
} from '@agoric/governance';
import { makeSubscriptionKit } from '@agoric/notifier';

export const CHARGING_PERIOD_KEY = harden('ChargingPeriod');
export const RECORDING_PERIOD_KEY = harden('RecordingPeriod');
export const PRICE_CHECK_PERIOD_KEY = harden('PriceCheckPeriod');

export const LIQUIDATION_MARGIN_KEY = harden('LiquidationMargin');
export const INITIAL_EXCHANGE_RATE_KEY = harden('InitialExchangeRateFee');
export const BASE_RATE_KEY = harden('BaseRate');
export const MULTIPILIER_RATE_KEY = harden('MultipilierRate');
export const PENALTY_RATE_KEY = harden('PenaltyRate');
export const USABLE_AS_COLLATERAL = harden('UsableAsCollateral');
export const COLLATERAL_LIMIT = harden('CollateralLimit');
export const BORROWABLE = harden('Borrowable');

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
 * @param {LendingPoolTiming} initialValues
 */
const makeLoanTimingManager = (initialValues) => {
  return makeParamManagerSync(getSubscriptionKit(),{
    [CHARGING_PERIOD_KEY]: [ParamTypes.NAT, initialValues.chargingPeriod],
    [RECORDING_PERIOD_KEY]: [ParamTypes.NAT, initialValues.recordingPeriod],
    [PRICE_CHECK_PERIOD_KEY]: [ParamTypes.NAT, initialValues.priceCheckPeriod] // TODO this now deprecated and not being used anywhere, should remove it
  })
};

/**
 * @param {Rates} rates
 */
const makeLoanParamManager = (rates) => {
  return makeParamManagerSync(getSubscriptionKit(), {
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
  })
};

/**
 * @param {Rates} rates
 * @param {{
 *   borrawable: Boolean,
 *   usableAsCol: Boolean,
 *   colLimit: Amount
 * }} riskControls
 */
const makePoolParamManager = ({ rates, riskControls }) => {
  return makeParamManagerSync(getSubscriptionKit(), {
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
    [INITIAL_EXCHANGE_RATE_KEY]: [ParamTypes.RATIO, rates.initialExchangeRate],
    [BASE_RATE_KEY]: [ParamTypes.RATIO, rates.baseRate],
    [MULTIPILIER_RATE_KEY]: [ParamTypes.RATIO, rates.multipilierRate],
    [PENALTY_RATE_KEY]: [ParamTypes.RATIO, rates.penaltyRate],
    [BORROWABLE]: [ParamTypes.UNKNOWN, riskControls.borrowable],
    [USABLE_AS_COLLATERAL]: [ParamTypes.UNKNOWN, riskControls.usableAsCol],
    [COLLATERAL_LIMIT]: [ParamTypes.AMOUNT, riskControls.colLimit],
  })
};

/**
 * @param {ERef<ZoeService>} zoe
 * @param {Invitation} electorateInvitation
 * @returns {Promise<{
 *   getParams: GetGovernedLoanParams,
 *   getInvitationAmount: (name: string) => Amount,
 *   getInternalParamValue: (name: string) => Invitation,
 *   updateElectorate: (invitation: Invitation) => void,
 * }>}
 */
const makeElectorateParamManager = async (zoe, electorateInvitation) => {
  return makeParamManager(getSubscriptionKit(), {
      [CONTRACT_ELECTORATE]: [ParamTypes.INVITATION, electorateInvitation],
    },
    zoe);
};

/**
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
  const timingParamMgr = makeLoanTimingManager(loanTiming);
  const rateParamMgr = makeLoanParamManager(rates);

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

/**
 * Creates a standard subscriptionKit and wraps it in an object
 * where its properties are destructurable by the ParamManager.
 */
const getSubscriptionKit = () => {
  const { publication, subscription } = makeSubscriptionKit();
  return harden({ publisher: publication, subscriber: subscription });
}

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
