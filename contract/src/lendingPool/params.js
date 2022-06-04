// @ts-check

import './types.js';

import {
  makeParamManagerSync,
  makeParamManager,
  CONTRACT_ELECTORATE,
  ParamTypes
} from '@agoric/governance';

export const CHARGING_PERIOD_KEY = 'ChargingPeriod';
export const RECORDING_PERIOD_KEY = 'RecordingPeriod';
export const PRICE_CHECK_PERIOD_KEY = 'PriceCheckPeriod'

export const LIQUIDATION_MARGIN_KEY = 'LiquidationMargin';
export const INTEREST_RATE_KEY = 'InterestRate';
export const LOAN_FEE_KEY = 'LoanFee';
export const INITIAL_EXCHANGE_RATE_KEY = 'InitialExchangeRateFee';
export const BASE_RATE_KEY = 'BaseRate';
export const MULTIPILIER_RATE_KEY = 'MultipilierRate';
export const PENALTY_RATE_KEY = 'PenaltyRate';

/**
 * @param {Amount} electorateInvitationAmount
 */
const makeElectorateParams = electorateInvitationAmount => {
  return harden({
    [CONTRACT_ELECTORATE]: [ParamTypes.INVITATION, electorateInvitationAmount],
  });
};

/**
 * @param {LoanTiming} loanTiming
 * @param {Rates} rates
 */
const makeLoanParams = (loanTiming, rates) => {
  return {
    [CHARGING_PERIOD_KEY]: [ParamTypes.NAT,  loanTiming.chargingPeriod],
    [RECORDING_PERIOD_KEY]: [ParamTypes.NAT, loanTiming.recordingPeriod],
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
    [INTEREST_RATE_KEY]: [ParamTypes.RATIO, rates.interestRate],
    [LOAN_FEE_KEY]: [ParamTypes.RATIO, rates.loanFee],
    [BASE_RATE_KEY]: [ParamTypes.RATIO, rates.baseRate],
    [MULTIPILIER_RATE_KEY]: [ParamTypes.RATIO, rates.multipilierRate],
  };
};

/**
 * @param {LoanTiming} initialValues
 */
const makeLoanTimingManager = initialValues => {
  return makeParamManagerSync({
    [CHARGING_PERIOD_KEY]: [ParamTypes.NAT, initialValues.chargingPeriod],
    [RECORDING_PERIOD_KEY]: [ParamTypes.NAT, initialValues.recordingPeriod],
    [PRICE_CHECK_PERIOD_KEY]: [ParamTypes.NAT, initialValues.priceCheckPeriod]
  })
};

/**
 * @param {Rates} rates
 */
const makeVaultParamManager = rates => {
  return makeParamManagerSync({
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
    [INTEREST_RATE_KEY]: [ParamTypes.RATIO, rates.interestRate],
    [LOAN_FEE_KEY]: [ParamTypes.RATIO, rates.loanFee],
  })
};

/**
 * @param {Rates} rates
 */
const makePoolParamManager = rates => {
  return makeParamManagerSync({
    [LIQUIDATION_MARGIN_KEY]: [ParamTypes.RATIO, rates.liquidationMargin],
    [INTEREST_RATE_KEY]: [ParamTypes.RATIO, rates.interestRate],
    [LOAN_FEE_KEY]: [ParamTypes.RATIO, rates.loanFee],
    [INITIAL_EXCHANGE_RATE_KEY]: [ParamTypes.RATIO, rates.initialExchangeRate],
    [BASE_RATE_KEY]: [ParamTypes.RATIO, rates.baseRate],
    [MULTIPILIER_RATE_KEY]: [ParamTypes.RATIO, rates.multipilierRate],
    [PENALTY_RATE_KEY]: [ParamTypes.RATIO, rates.penaltyRate],
  })
};

/**
 * @param {ERef<ZoeService>} zoe
 * @param {Invitation} electorateInvitation
 * @returns {Promise<{
 *   getParams: GetGovernedVaultParams,
 *   getInvitationAmount: (name: string) => Amount,
 *   getInternalParamValue: (name: string) => Invitation,
 *   updateElectorate: (invitation: Invitation) => void,
 * }>}
 */
const makeElectorateParamManager = async (zoe, electorateInvitation) => {
  return makeParamManager({
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
 * @param {bigint=} bootstrapPaymentValue
 * @param {Brand} compareCurrencyBrand
 */
const makeGovernedTerms = (
  priceManager,
  loanTiming,
  liquidationInstall,
  timerService,
  invitationAmount,
  rates,
  ammPublicFacet,
  bootstrapPaymentValue = 0n,
  compareCurrencyBrand
) => {
  const timingParamMgr = makeLoanTimingManager(loanTiming);

  const rateParamMgr = makeVaultParamManager(rates);

  return harden({
    ammPublicFacet,
    priceManager,
    loanParams: rateParamMgr.getParams(),
    loanTimingParams: timingParamMgr.getParams(),
    timerService,
    liquidationInstall,
    governedParams: makeElectorateParams(invitationAmount),
    bootstrapPaymentValue,
    compareCurrencyBrand
  });
};

harden(makeVaultParamManager);
harden(makePoolParamManager);
harden(makeElectorateParamManager);
harden(makeGovernedTerms);
harden(makeLoanParams);
harden(makeElectorateParams);

export {
  makeElectorateParamManager,
  makeVaultParamManager,
  makePoolParamManager,
  makeGovernedTerms,
  makeLoanParams,
  makeElectorateParams,
};
