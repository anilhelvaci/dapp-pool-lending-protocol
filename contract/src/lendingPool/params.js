// @ts-check

import './types.js';

import {
  makeGovernedNat,
  makeGovernedInvitation,
  makeGovernedRatio,
  makeParamManagerBuilder,
  CONTRACT_ELECTORATE,
} from '@agoric/governance';

export const CHARGING_PERIOD_KEY = 'ChargingPeriod';
export const RECORDING_PERIOD_KEY = 'RecordingPeriod';

export const LIQUIDATION_MARGIN_KEY = 'LiquidationMargin';
export const INTEREST_RATE_KEY = 'InterestRate';
export const LOAN_FEE_KEY = 'LoanFee';
export const INITIAL_EXCHANGE_RATE_KEY = 'InitialExchangeRateFee';

/**
 * @param {Amount} electorateInvitationAmount
 */
const makeElectorateParams = electorateInvitationAmount => {
  return harden({
    [CONTRACT_ELECTORATE]: makeGovernedInvitation(electorateInvitationAmount),
  });
};

/**
 * @param {LoanTiming} loanTiming
 * @param {Rates} rates
 */
const makeLoanParams = (loanTiming, rates) => {
  return harden({
    [CHARGING_PERIOD_KEY]: makeGovernedNat(loanTiming.chargingPeriod),
    [RECORDING_PERIOD_KEY]: makeGovernedNat(loanTiming.recordingPeriod),
    [LIQUIDATION_MARGIN_KEY]: makeGovernedRatio(rates.liquidationMargin),
    [INTEREST_RATE_KEY]: makeGovernedRatio(rates.interestRate),
    [LOAN_FEE_KEY]: makeGovernedRatio(rates.loanFee),
  });
};

/**
 * @param {LoanTiming} initialValues
 * @returns {ParamManagerFull & {
 *   updateChargingPeriod: (period: bigint) => void,
 *   updateRecordingPeriod: (period: bigint) => void,
 * }}
 */
const makeLoanTimingManager = initialValues => {
  // @ts-expect-error until makeParamManagerBuilder can be generic */
  return makeParamManagerBuilder()
    .addNat(CHARGING_PERIOD_KEY, initialValues.chargingPeriod)
    .addNat(RECORDING_PERIOD_KEY, initialValues.recordingPeriod)
    .build();
};

/**
 * @param {Rates} rates
 * @returns {VaultParamManager}
 */
const makeVaultParamManager = rates => {
  // @ts-expect-error until makeParamManagerBuilder can be generic */
  return makeParamManagerBuilder()
    .addBrandedRatio(LIQUIDATION_MARGIN_KEY, rates.liquidationMargin)
    .addBrandedRatio(INTEREST_RATE_KEY, rates.interestRate)
    .addBrandedRatio(LOAN_FEE_KEY, rates.loanFee)
    .build();
};

/**
 * @param {Rates} rates
 * @returns {VaultParamManager}
 */
const makePoolParamManager = rates => {
  // @ts-expect-error until makeParamManagerBuilder can be generic */
  return makeParamManagerBuilder()
    .addBrandedRatio(LIQUIDATION_MARGIN_KEY, rates.liquidationMargin)
    .addBrandedRatio(INTEREST_RATE_KEY, rates.interestRate)
    .addBrandedRatio(LOAN_FEE_KEY, rates.loanFee)
    .addBrandedRatio(INITIAL_EXCHANGE_RATE_KEY, rates.initialExchangeRate)
    .build();
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
  // @ts-expect-error casting to ElectorateParamManager
  return makeParamManagerBuilder(zoe)
    .addInvitation(CONTRACT_ELECTORATE, electorateInvitation)
    .then(builder => builder.build());
};

/**
 * @param {ERef<PriceManager>} priceManager
 * @param {LoanTiming} loanTiming
 * @param {Installation} liquidationInstall
 * @param {ERef<TimerService>} timerService
 * @param {Amount} invitationAmount
 * @param {Rates} rates
 * @param {XYKAMMPublicFacet} ammPublicFacet
 * @param {[]} bootstrappedAssets
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
  bootstrappedAssets,
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
    main: makeElectorateParams(invitationAmount),
    bootstrapPaymentValue,
    bootstrappedAssets,
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
