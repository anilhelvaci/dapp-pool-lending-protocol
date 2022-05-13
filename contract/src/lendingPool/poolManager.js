// @ts-check
import '@agoric/zoe/exported.js';

import { E } from '@agoric/eventual-send';
import { Nat } from '@agoric/nat';
import {
  assertProposalShape,
  makeRatioFromAmounts,
  getAmountOut,
  getAmountIn,
  ceilMultiplyBy,
  ceilDivideBy,
  makeRatio,
} from '@agoric/zoe/src/contractSupport/index.js';
import { assert, details as X, q } from '@agoric/assert';
import { makeNotifierKit, observeNotifier } from '@agoric/notifier';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';

// import { makeScalarBigMapStore } from '@agoric/swingset-vat/src/storeModule';
import { makeScalarMap } from '@agoric/store';
import { makeInnerVault } from './vault.js';
// import { makePrioritizedVaults } from './prioritizedVaults.js';
import { liquidate } from './liquidation.js';
import { makeTracer } from '../makeTracer.js';
import {
  RECORDING_PERIOD_KEY,
  LIQUIDATION_MARGIN_KEY,
  INITIAL_EXCHANGE_RATE_KEY,
  LOAN_FEE_KEY,
  INTEREST_RATE_KEY,
  CHARGING_PERIOD_KEY,
  PRICE_CHECK_PERIOD_KEY,
  MULTIPILIER_RATE_KEY,
  BASE_RATE_KEY
} from './params.js';
import { chargeInterest } from '../interest.js';
import { calculateExchangeRate, calculateUtilizationRate, calculateBorrowingRate } from '../protocolMath.js';
import { makeDebtsPerCollateral } from './debtsPerCollateral.js';
import { makeQuoteManager } from './quoteManager.js';

const trace = makeTracer('VM');

/**
 * @typedef {{
 *  compoundedInterest: Ratio,
 *  interestRate: Ratio,
 *  latestInterestUpdate: bigint,
 *  totalDebt: Amount<NatValue>,
 * }} AssetState */

/**
 * Each VaultManager manages a single collateral type.
 *
 * It manages some number of outstanding loans, each called a Vault, for which
 * the collateral is provided in exchange for borrowed RUN.
 *
 * @param {ContractFacet} zcf
 * @param {ZCFMint} protocolMint
 * @param {Brand} collateralBrand
 * @param {Brand} underlyingBrand
 * @param {Brand} thirdCurrencyBrand
 * @param {string} underlyingKeyword
 * @param {ERef<PriceAuthority>} priceAuthority
 * @param {Notifier} priceAuthNotifier
 * @param {ERef<PriceManager>} priceManager
 * @param {{
 *  ChargingPeriod: ParamRecord<'relativeTime'> & { value: RelativeTime },
 *  RecordingPeriod: ParamRecord<'relativeTime'> & { value: RelativeTime },
 * }} timingParams
 * @param {GetGovernedVaultParams} getLoanParams
 * @param {ReallocateWithFee} reallocateWithFee
 * @param {ERef<TimerService>} timerService
 * @param {LiquidationStrategy} liquidationStrategy
 * @param {Timestamp} startTimeStamp
 * @param {GetExchangeRateForPool} getExchangeRateForPool
 * @returns {VaultManager}
 */
export const makePoolManager = (
  zcf,
  protocolMint,
  collateralBrand,
  underlyingBrand,
  thirdCurrencyBrand,
  underlyingKeyword,
  priceAuthority,
  priceAuthNotifier,
  priceManager,
  timingParams,
  getLoanParams,
  // reallocateWithFee = undefined,
  timerService,
  // liquidationStrategy,
  startTimeStamp,
  getExchangeRateForPool
) => {
  const { brand: protocolBrand, issuer: protocolIssuer } = protocolMint.getIssuerRecord();
  const { zcfSeat: underlyingAssetSeat } = zcf.makeEmptySeatKit();
  const { zcfSeat: protocolAssetSeat } = zcf.makeEmptySeatKit();
  let totalDebt = AmountMath.makeEmpty(underlyingBrand, 'nat');
  let totalProtocolSupply = AmountMath.makeEmpty(protocolBrand, 'nat');

  /** @type {GetVaultParams} */
  const shared = {
    // loans below this margin may be liquidated
    getLiquidationMargin: () => getLoanParams()[LIQUIDATION_MARGIN_KEY].value,
    // loans must initially have at least 1.2x collateralization
    getLoanFee: () => getLoanParams()[LOAN_FEE_KEY].value,
    getInterestRate: () => getLoanParams()[INTEREST_RATE_KEY].value,
    getCurrentBorrowingRate: () => getCurrentBorrowingRate(),
    getTotalDebt: () => totalDebt,
    getInitialExchangeRate: () => getLoanParams()[INITIAL_EXCHANGE_RATE_KEY].value,
    getExchangeRate: () => getExchangeRate(),
    getProtocolAmountOut: (depositAmount) => {
      const exchangeRate = getExchangeRate();
      return ceilDivideBy(depositAmount, exchangeRate);
    },
    getPriceAuthorityForBrand: brand => E(priceManager).getPriceAuthority(brand),
    getChargingPeriod: () => timingParams[CHARGING_PERIOD_KEY].value,
    getRecordingPeriod: () => timingParams[RECORDING_PERIOD_KEY].value,
    getProtocolBrand: () => protocolBrand,
    getProtocolIssuer: () => protocolIssuer,
    getProtocolLiquidity: () => totalProtocolSupply.value,
    getUnderlyingLiquidity: () => underlyingAssetSeat.getCurrentAllocation().Underlying.value,
    enoughLiquidityForProposedDebt: (proposedDebtAmount) => assertEnoughLiquidtyExists(proposedDebtAmount),
    getThirdCurrencyBrand: () => thirdCurrencyBrand,
    async getCollateralQuote() {
      // get a quote for one unit of the collateral
      const displayInfo = await E(collateralBrand).getDisplayInfo();
      const decimalPlaces = displayInfo?.decimalPlaces || 0n;
      return E(priceAuthority).quoteGiven(
        AmountMath.make(collateralBrand, 10n ** Nat(decimalPlaces)),
        debtBrand,
      );
    },
  };

  let vaultCounter = 0;

  /**
   * A store for vaultKits prioritized by their collaterization ratio.
   *
   * It should be set only once but it's a `let` because it can't be set until after the
   * definition of reschedulePriceCheck, which refers to sortedVaultKits
   *
   * @type {ReturnType<typeof makePrioritizedVaults>=}
   */
  // XXX misleading mutability and confusing flow control; could be refactored with a listener
  let prioritizedVaults;
  /**
   * @type {MapStore<Brand, DebtsPerCollateral>}
   */
  const debtsPerCollateralStore = makeScalarMap('debtsPerCollateralStore');

  /** @type {Ratio}} */
  let compoundedInterest = makeRatio(100n, underlyingBrand); // starts at 1.0, no interest

  /**
   * timestamp of most recent update to interest
   *
   * @type {bigint}
   */
  let latestInterestUpdate = startTimeStamp;

  /**
   * @param {Amount} proposedDebtAmount
   */
  const assertEnoughLiquidtyExists = (proposedDebtAmount) => {
    const totalLiquidity = underlyingAssetSeat.getAmountAllocated('Underlying', underlyingBrand);
    assert(
      AmountMath.isGTE(totalLiquidity,
        proposedDebtAmount,
        underlyingBrand),
      X`Requested ${q(proposedDebtAmount)} exceeds the total liquidity ${q(totalLiquidity)}`,
    );
  };

  const getExchangeRate = () => {
    console.log('[TOTAL_PROTOCOL_SUPPLY_EMPTY]', AmountMath.isEmpty(totalProtocolSupply));
    return AmountMath.isEmpty(totalProtocolSupply) ? shared.getInitialExchangeRate()
      : calculateExchangeRate(underlyingAssetSeat.getCurrentAllocation().Underlying, totalDebt, totalProtocolSupply);
  };

  /**
   * @returns {Ratio}
   */
  const getCurrentBorrowingRate = () => {
    const cashPresent = underlyingAssetSeat.getAmountAllocated('Underlying', underlyingBrand);
    const utilizationRate = calculateUtilizationRate(cashPresent, totalDebt);
    console.log("[UTILICATION_RATIO]", utilizationRate);
    console.log("[TOTAL_DEBT]", totalDebt);
    return calculateBorrowingRate(getLoanParams()[MULTIPILIER_RATE_KEY].value, getLoanParams()[BASE_RATE_KEY].value, utilizationRate);
  }

  const { updater: assetUpdater, notifier: assetNotifer } = makeNotifierKit(
    harden({
      compoundedInterest,
      interestRate: shared.getInterestRate(),
      latestInterestUpdate,
      totalDebt,
    }),
  );

  /**
   *
   * @param {bigint} updateTime
   * @param {ZCFSeat} poolIncrementSeat
   */
  const chargeAllVaults = async (updateTime, poolIncrementSeat) => {
    trace('chargeAllVaults', { updateTime });
    const interestRate = shared.getCurrentBorrowingRate();

    // Update local state with the results of charging interest
    ({ compoundedInterest, latestInterestUpdate, totalDebt } =
      await chargeInterest(
        {
          underlyingBrand,
          poolIncrementSeat,
        },
        {
          interestRate,
          chargingPeriod: shared.getChargingPeriod(),
          recordingPeriod: shared.getRecordingPeriod(),
        },
        { latestInterestUpdate, compoundedInterest, totalDebt },
        updateTime,
      ));

    /** @type {AssetState} */
    const payload = harden({
      compoundedInterest,
      interestRate,
      latestInterestUpdate,
      totalDebt,
    });
    assetUpdater.updateState(payload);

    trace('chargeAllVaults complete', payload);

  };

  /**
   * Update total debt of this manager given the change in debt on a vault
   *
   * @param {Amount<NatValue>} oldDebtOnVault
   * @param {Amount<NatValue>} newDebtOnVault
   */
  // TODO https://github.com/Agoric/agoric-sdk/issues/4599
  const applyDebtDelta = (oldDebtOnVault, newDebtOnVault) => {
    const delta = newDebtOnVault.value - oldDebtOnVault.value;
    trace(`updating total debt ${totalDebt} by ${delta}`);
    if (delta === 0n) {
      // nothing to do
      return;
    }

    // totalDebt += delta (Amount type ensures natural value)
    totalDebt = AmountMath.make(underlyingBrand, totalDebt.value + delta);
  };

  /**
   * Make requested transfer for. Requested transfer being either rapying a debt
   * of requesting more debt.
   * @param seat
   * @param currentDebt
   */
  const transferDebt = (seat, currentDebt) => {

    const proposal = seat.getProposal();
    if (proposal.want.Debt) {
      // decrease the requested amount of underlying asset from the underlyingSeat
      underlyingAssetSeat.decrementBy(harden({ Underlying: proposal.want.Debt }));
      seat.incrementBy(
        harden({ Debt: proposal.want.Debt }),
      );
    } else if (proposal.give.Debt) {
      // We don't allow debt to be negative, so we'll refund overpayments
      // const currentDebt = getCurrentDebt();
      const acceptedDebt = AmountMath.isGTE(proposal.give.Debt, currentDebt)
        ? currentDebt
        : proposal.give.Debt;

      seat.decrementBy(harden({ Debt: acceptedDebt }));
      underlyingAssetSeat.incrementBy(harden({ Underlying: acceptedDebt }));
    }
  };

  const reallocateBetweenSeats = (vaultSeat, clientSeat) => {
    console.log("reallocateBetweenSeats")
    zcf.reallocate(underlyingAssetSeat, vaultSeat, clientSeat);
  }

  const periodNotifier = E(timerService).makeNotifier(
    0n,
    timingParams[RECORDING_PERIOD_KEY].value,
  );
  const { zcfSeat: poolIncrementSeat } = zcf.makeEmptySeatKit();

  const timeObserver = {
    updateState: updateTime =>{
      console.log('[CHARGING_INTEREST]', updateTime);
      if (!AmountMath.isEmpty(totalDebt)) {
        chargeAllVaults(updateTime, poolIncrementSeat).catch(e =>
          console.error('🚨 vaultManager failed to charge interest', e),
        )
      }
    },
    fail: reason => {
      console.log('[FAIL]', reason.stack);
      zcf.shutdownWithFailure(
        assert.error(X`Unable to continue without a timer: ${reason}`),
      );
    },
    finish: done => {
      zcf.shutdownWithFailure(
        assert.error(X`Unable to continue without a timer: ${done}`),
      );
    },
  };

  observeNotifier(periodNotifier, timeObserver);

  const underlyingQuoteManager = makeQuoteManager();

  const priceCheckObserver = {
    updateState: newQuote => {
      console.log('[DEBT_QUOTE_UPDATED]', getAmountOut(newQuote), getAmountIn(newQuote));
      underlyingQuoteManager.updateLatestQuote(newQuote);
    },
    fail: reason => {
      console.log('[FAIL]', reason.stack);
      zcf.shutdownWithFailure(
        assert.error(X`Unable to continue without a timer: ${reason}`),
      );
    },
    finish: done => {
      zcf.shutdownWithFailure(
        assert.error(X`Unable to continue without a timer: ${done}`),
      );
    },
  }

  observeNotifier(priceAuthNotifier, priceCheckObserver);

  /** @type {Parameters<typeof makeInnerVault>[1]} */
  const managerFacet = harden({
    ...shared,
    applyDebtDelta,
    // reallocateWithFee,
    reallocateBetweenSeats,
    transferDebt,
    getCollateralBrand: () => collateralBrand,
    getUnderlyingBrand: () => underlyingBrand,
    getCompoundedInterest: () => compoundedInterest,
    getLatestUnderlyingQuote: () => underlyingQuoteManager.getLatestQuote(),
    getExchangeRateForPool
  });

  /** @param {ZCFSeat} seat */
  const makeVaultKit = async seat => {
    assertProposalShape(seat, {
      give: { Collateral: null },
      want: { RUN: null },
    });

    vaultCounter += 1;
    const vaultId = String(vaultCounter);

    const innerVault = makeInnerVault(
      zcf,
      managerFacet,
      assetNotifer,
      vaultId,
      protocolMint,
      priceAuthority,
    );

    // TODO Don't record the vault until it gets opened
    assert(prioritizedVaults);
    const addedVaultKey = prioritizedVaults.addVault(vaultId, innerVault);

    try {
      const vaultKit = await innerVault.initVaultKit(seat);
      seat.exit();
      return vaultKit;
    } catch (err) {
      // remove it from prioritizedVaults
      // XXX openLoan shouldn't assume it's already in the prioritizedVaults
      prioritizedVaults.removeVault(addedVaultKey);
      throw err;
    }
  };

  /** @param {ZCFSeat} seat
   * @param {Ratio} exchangeRate
   * */
  const makeBorrowKit = async (seat, exchangeRate) => {
    trace('Inside makeBorrowKit', seat, exchangeRate);
    assertProposalShape(seat, {
      give: { Collateral: null },
      want: { Debt: null },
    });

    const {
      want: { Debt: proposedDebtAmount },
    } = seat.getProposal();

    assertEnoughLiquidtyExists(proposedDebtAmount);

    const collateralBrand = exchangeRate.numerator.brand;
    const wrappedCollateralPriceAuthority = await E(priceManager).getPriceAuthority(collateralBrand); // should change the method name

    if (!debtsPerCollateralStore.has(collateralBrand)) {
      debtsPerCollateralStore.init(collateralBrand, makeDebtsPerCollateral(
        zcf,
        collateralBrand,
        underlyingBrand,
        assetNotifer,
        wrappedCollateralPriceAuthority,
        priceAuthority,
        managerFacet,
        timerService,
        timingParams
      ));
    }

    const debtsPerCollateral = debtsPerCollateralStore.get(collateralBrand);
    const vaultKit = await E(debtsPerCollateral).addNewVault(seat, underlyingAssetSeat, exchangeRate);
    trace('VaultKit', vaultKit);
    return vaultKit;
  };

  const makeDepositInvitation = () => {
    /** @param {ZCFSeat} fundHolderSeat*/
    const depositHook = async fundHolderSeat => {
      console.log('[DEPSOSIT]: Icerdeyim');
      assertProposalShape(fundHolderSeat, {
        give: { Underlying: null },
        want: { Protocol: null },
      });

      const {
        give: { Underlying: fundAmount },
        want: { Protocol: protocolAmount },
      } = fundHolderSeat.getProposal();
      assert(AmountMath.isEqual(protocolAmount, shared.getProtocolAmountOut(fundAmount)), X`The amounts should be equal`);
      protocolMint.mintGains(harden({ Protocol: protocolAmount }), protocolAssetSeat);
      totalProtocolSupply = AmountMath.add(totalProtocolSupply, protocolAmount);
      fundHolderSeat.incrementBy(
        protocolAssetSeat.decrementBy(harden({ Protocol: protocolAmount })),
      );

      underlyingAssetSeat.incrementBy(
        fundHolderSeat.decrementBy(harden({ Underlying: fundAmount })),
      )

      zcf.reallocate(fundHolderSeat, underlyingAssetSeat, protocolAssetSeat);
      fundHolderSeat.exit();

      return 'Finished';
    }

    return zcf.makeInvitation(depositHook, 'depositFund');
  }

  /** @type {VaultManager} */
  return Far('vault manager', {
    ...shared,
    makeVaultKit,
    makeBorrowKit,
    makeDepositInvitation,
  });
};
