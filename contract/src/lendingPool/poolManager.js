// @ts-check
import { E } from '@endo/far';
import {
  assertProposalShape,
  ceilDivideBy,
  makeRatio,
} from '@agoric/zoe/src/contractSupport/index.js';
import { assert, details as X, q } from '@agoric/assert';
import { makeNotifierKit, observeNotifier } from '@agoric/notifier';
import { AmountMath } from '@agoric/ertp';
import { Far } from '@endo/marshal';

import { makeScalarMap } from '@agoric/store';
import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';
import {
  RECORDING_PERIOD_KEY,
  LIQUIDATION_MARGIN_KEY,
  INITIAL_EXCHANGE_RATE_KEY,
  CHARGING_PERIOD_KEY,
  MULTIPILIER_RATE_KEY,
  BASE_RATE_KEY, PENALTY_RATE_KEY,
} from './params.js';
import { chargeInterest } from '../interest.js';
import { calculateExchangeRate, calculateUtilizationRate, calculateBorrowingRate } from '../protocolMath.js';
import { makeDebtsPerCollateral } from './debtsPerCollateral.js';
import { ceilMultiplyBy, floorMultiplyBy } from '@agoric/zoe/src/contractSupport/ratio.js';
import { UPDATE_ASSET_STATE_OPERATION } from './constants.js';

const trace = makeTracer('PM');


/**
 * PoolManager is the place where operations related to one type of underlying
 * asset are gathered. There is one PoolManager for one underlyingAsset type.
 * One PoolManager can lend its underlyingAsset against multiple type of collaterals.
 * Important thing about the collaterals is that, they should be protocolTokens
 * received when a user provides another type of underlyingAsset to another pool.
 *
 * This is the place where the operations listed below happen;
 * - Deposit underlyingAsset and receive some collateral
 * - Borrow an underlyingAsset against some protocolToken used as collateral
 * - Redeem the underlyingAsset deposited earlier corresponding to the received protocolToken
 * - Charge interest on all loans
 * - Keep the variables like totalDebt, underlyingLiquidty, protocolLiquidty updated
 * - Calculate dynamic interest rates using the variables mentioned above
 *
 *
 * @param {ZCF} zcf
 * @param {ZCFMint} protocolMint
 * @param {Brand} collateralBrand
 * @param {Brand} underlyingBrand
 * @param {Brand} thirdCurrencyBrand
 * @param {string} underlyingKeyword
 * @param {ERef<PriceAuthority>} priceAuthority
 * @param {Promise<Notifier<PriceQuote>>} priceAuthNotifier
 * @param {ERef<PriceManager>} priceManager
 * @param {{
 *  ChargingPeriod: ParamRecord<'relativeTime'> & { value: RelativeTime },
 *  RecordingPeriod: ParamRecord<'relativeTime'> & { value: RelativeTime },
 * }} timingParams
 * @param {() => Object} getLoanParams
 * @param {ERef<TimerService>} timerService
 * @param {Timestamp} startTimeStamp
 * @param {(brand: Brand) => Ratio} getExchangeRateForPool
 * @param {(underlyingBrand: Brand) => Promise<Invitation>} makeRedeemInvitation
 * @param {Installation} liquidationInstall
 * @param {XYKAMMPublicFacet} ammPublicFacet
 * @returns {ERef<PoolManager>}
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
  timerService,
  startTimeStamp,
  getExchangeRateForPool,
  makeRedeemInvitation,
  liquidationInstall,
  ammPublicFacet,
) => {
  const { brand: protocolBrand, issuer: protocolIssuer } = protocolMint.getIssuerRecord();
  const { zcfSeat: underlyingAssetSeat } = zcf.makeEmptySeatKit();
  const { zcfSeat: protocolAssetSeat } = zcf.makeEmptySeatKit();
  let totalDebt = AmountMath.makeEmpty(underlyingBrand, 'nat');
  let totalProtocolSupply = AmountMath.makeEmpty(protocolBrand, 'nat');

  /** @type {ManagerShared} */
  const shared = {
    // loans below this margin may be liquidated
    getLiquidationMargin: () => getLoanParams()[LIQUIDATION_MARGIN_KEY].value,
    getCurrentBorrowingRate: () => getCurrentBorrowingRate(),
    getTotalDebt: () => totalDebt,
    getInitialExchangeRate: () => getLoanParams()[INITIAL_EXCHANGE_RATE_KEY].value,
    getExchangeRate: () => getExchangeRate(),
    getProtocolAmountOut: (depositAmount) => {
      const exchangeRate = getExchangeRate();
      return ceilDivideBy(depositAmount, exchangeRate);
    },
    getPriceAuthorityForBrand: brand => E(priceManager).getWrappedPriceAuthority(brand),
    getChargingPeriod: () => timingParams[CHARGING_PERIOD_KEY].value,
    getRecordingPeriod: () => timingParams[RECORDING_PERIOD_KEY].value,
    getProtocolBrand: () => protocolBrand,
    getProtocolIssuer: () => protocolIssuer,
    getProtocolLiquidity: () => totalProtocolSupply,
    getUnderlyingLiquidity: () => underlyingAssetSeat.getAmountAllocated('Underlying', underlyingBrand),
    getUnderlyingBrand: () => underlyingBrand,
    enoughLiquidityForProposedDebt: (proposedDebtAmount) => assertEnoughLiquidtyExists(proposedDebtAmount),
    getThirdCurrencyBrand: () => thirdCurrencyBrand,
    protocolToUnderlying: (brand, protocolAmount) => {
      const exchangeRate = getExchangeRateForPool(brand);
      return floorMultiplyBy(protocolAmount, exchangeRate);
    },
  };

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
   * Checks if there is enough liquidity for the hand out the proposed debt
   * and throws an error if the liquidity is not enough.
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
    console.log('assertEnoughLiquidtyExists: Enough!');
  };

  /**
   * Calculates the current exchange rate, if the pool has no liquidity just
   * returns the initial exchange rate.
   * @returns {Ratio}
   * */
  const getExchangeRate = () => {
    console.log('[TOTAL_PROTOCOL_SUPPLY_EMPTY]', AmountMath.isEmpty(totalProtocolSupply));
    return AmountMath.isEmpty(totalProtocolSupply) ? shared.getInitialExchangeRate()
      : calculateExchangeRate(underlyingAssetSeat.getCurrentAllocation().Underlying, totalDebt, totalProtocolSupply);
  };

  /**
   * Calculates the current borrowing rate.
   * @returns {Ratio}
   */
  const getCurrentBorrowingRate = () => {
    const cashPresent = underlyingAssetSeat.getAmountAllocated('Underlying', underlyingBrand);
    const utilizationRate = calculateUtilizationRate(cashPresent, totalDebt);
    console.log('[UTILICATION_RATIO]', utilizationRate);
    console.log('[TOTAL_DEBT]', totalDebt);
    return calculateBorrowingRate(getLoanParams()[MULTIPILIER_RATE_KEY].value, getLoanParams()[BASE_RATE_KEY].value, utilizationRate);
  };

  /** @type {AssetState} */
  const initialAssetState = {
    compoundedInterest,
    latestInterestRate: getCurrentBorrowingRate(),
    latestInterestUpdate,
    totalDebt,
    exchangeRate: getExchangeRate(),
    underlyingLiquidity: shared.getUnderlyingLiquidity(underlyingBrand),
    protocolLiquidity: shared.getProtocolLiquidity(),
  };

  const { updater: assetUpdater, notifier: assetNotifer } = makeNotifierKit(
    harden(initialAssetState),
  );

  const updateAssetState = (operationType) => {
    /** @type {AssetState} */
    const payload = harden({
      compoundedInterest,
      latestInterestRate: shared.getCurrentBorrowingRate(),
      latestInterestUpdate,
      totalDebt,
      exchangeRate: getExchangeRate(),
      underlyingLiquidity: shared.getUnderlyingLiquidity(underlyingBrand),
      protocolLiquidity: shared.getProtocolLiquidity(),
    });
    assetUpdater.updateState(payload);

    trace(`State updated after ${operationType} operation with the payload:`, payload);
  };

  /**
   * The main difference of LendingPool's chargeLoan logic
   * from the VaultFactory's chargeVault logic is that
   * we don't reschedule a new price check on after every recording
   * period. Also we use  an overrridden version of the 'chargeInterest' method
   * of VaultFactory's interest.js module since we don't mint any reward for
   * charging interest.
   *
   * @param {bigint} updateTime
   * @param {ZCFSeat} poolIncrementSeat
   */
  const chargeAllLoans = async (updateTime, poolIncrementSeat) => {
    trace('chargeAllLoans', { updateTime });
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

    updateAssetState(UPDATE_ASSET_STATE_OPERATION.CHARGE_INTEREST);
  };

  /**
   * Update total debt of this manager given the change in debt on a loan
   *
   * @param {Amount<'nat'>} oldDebtOnLoan
   * @param {Amount<'nat'>} newDebtOnLoan
   */
    // TODO https://github.com/Agoric/agoric-sdk/issues/4599
  const applyDebtDelta = (oldDebtOnLoan, newDebtOnLoan) => {
      const delta = newDebtOnLoan.value - oldDebtOnLoan.value;
      trace(`updating total debt ${totalDebt.value} by ${delta}`);
      if (delta === 0n) {
        // nothing to do
        return;
      }

      // totalDebt += delta (Amount type ensures natural value)
      totalDebt = AmountMath.make(underlyingBrand, totalDebt.value + delta);
      updateAssetState(UPDATE_ASSET_STATE_OPERATION.APPLY_DEBT_DELTA);
    };

  /**
   * Make requested transfer for. Requested transfer being either repaying a debt
   * of requesting more debt.
   * @param {ZCFSeat} seat
   * @param {Amount} currentDebt
   */
  const transferDebt = (seat, currentDebt) => {
    /** @type {Proposal}*/
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

  /**
   * Transfers the underlyingAsset received from the AMM after liquidation to the
   * pool.
   * @param {ZCFSeat} loanSeat
   */
  const transferLiquidatedFund = loanSeat => {
    const loanAllocations = loanSeat.getCurrentAllocation();
    assert(loanAllocations.Debt && loanAllocations.Debt !== undefined, 'The loan has no liquidated funds');
    const {
      Debt: liquidatedAmount,
    } = loanSeat.getCurrentAllocation();
    console.log('underlyingAssetSeatBefore', underlyingAssetSeat.getCurrentAllocation());
    loanSeat.decrementBy(harden({ Debt: liquidatedAmount }));
    underlyingAssetSeat.incrementBy(harden({ Underlying: liquidatedAmount }));
    zcf.reallocate(loanSeat, underlyingAssetSeat);
    console.log('underlyingAssetSeatAfter', underlyingAssetSeat.getCurrentAllocation());
    updateAssetState(UPDATE_ASSET_STATE_OPERATION.LIQUIDATED);
  };

  /**
   * Stage the underlying fund to the underlyingAssetSeat.
   * @param {Proposal} proposal
   */
  const stageUnderlyingAllocation = (proposal) => {
    if (proposal.give.Debt) {
      underlyingAssetSeat.incrementBy(harden({ Underlying: proposal.give.Debt }));
    } else if (proposal.want.Debt) {
      underlyingAssetSeat.decrementBy(harden({ Underlying: proposal.want.Debt }));
    }
  };

  /**
   * Reallocates the funds between loanSeat, clientSeat and underlyingSeat, checks
   * if there's a staged allocation in the seat first.
   * @param {ZCFSeat} loanSeat
   * @param {ZCFSeat} clientSeat
   */
  const reallocateBetweenSeats = (loanSeat, clientSeat) => {
    // TODO use Array.map() here
    const seatList = [];
    addIfHasStagedAllocation(seatList, loanSeat);
    addIfHasStagedAllocation(seatList, clientSeat);
    addIfHasStagedAllocation(seatList, underlyingAssetSeat);
    trace('seatList', seatList);
    // @ts-ignore
    zcf.reallocate(...seatList);
  };

  /**
   * Adds the seat to the list if there's a staged allocation.
   * @param {ZCFSeat[]} seatList
   * @param {ZCFSeat} seat
   */
  const addIfHasStagedAllocation = (seatList, seat) => {
    if (seat.hasStagedAllocation()) seatList.push(seat);
  };

  // Set up the notifier for interest period
  const periodNotifier = E(timerService).makeNotifier(
    0n,
    timingParams[RECORDING_PERIOD_KEY].value,
  );
  const { zcfSeat: poolIncrementSeat } = zcf.makeEmptySeatKit();

  const timeObserver = {
    updateState: updateTime => {
      console.log('[CHARGING_INTEREST]', updateTime);
      if (!AmountMath.isEmpty(totalDebt)) {
        chargeAllLoans(updateTime, poolIncrementSeat).catch(e =>
          console.error('🚨 loanManager failed to charge interest', e),
        );
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

  /** @type {ManagerFacet} */
  const managerFacet = harden({
    ...shared,
    applyDebtDelta,
    reallocateBetweenSeats,
    stageUnderlyingAllocation,
    transferDebt,
    getCollateralBrand: () => collateralBrand,
    getCompoundedInterest: () => compoundedInterest,
    getExchangeRateForPool,
    makeRedeemInvitation,
    getPenaltyRate: () => getLoanParams()[PENALTY_RATE_KEY].value, // Penalty rate to be enforced when there's a liquidation
    transferLiquidatedFund,
    debtPaid: originalDebt => totalDebt = AmountMath.subtract(totalDebt, originalDebt), // Update debt after payment
  });

  /**
   * Creates a loan object and organizes them by their
   * collateral type(One group for every protocol token).
   * @param {ZCFSeat} seat
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

    if (!debtsPerCollateralStore.has(collateralBrand)) {
      /** @type {WrappedPriceAuthority} */
      const wrappedCollateralPriceAuthority = await E(priceManager).getWrappedPriceAuthority(collateralBrand); // should change the method name
      debtsPerCollateralStore.init(collateralBrand, await makeDebtsPerCollateral(
        zcf,
        collateralBrand,
        underlyingBrand,
        assetNotifer,
        wrappedCollateralPriceAuthority,
        priceAuthority,
        priceAuthNotifier,
        managerFacet,
        timerService,
        timingParams,
      ));
    }

    const debtsPerCollateral = debtsPerCollateralStore.get(collateralBrand);
    console.log('debtsPerCollateral: ', debtsPerCollateral);
    const [loanKit] = await Promise.all([
      debtsPerCollateral.addNewLoan(seat, underlyingAssetSeat, exchangeRate),
      debtsPerCollateral.setupLiquidator(liquidationInstall, ammPublicFacet),
    ]);
    trace('LoanKit', loanKit);

    updateAssetState(UPDATE_ASSET_STATE_OPERATION.BORROW);
    return loanKit;
  };

  /**
   * @type {OfferHandler}
   *
   * Offer handler for redeeming assets.
   *
   * @param {ZCFSeat} seat
   * @returns {Promise<string>}
   */
  const redeemHook = async seat => {
    assertProposalShape(seat, {
      give: { Protocol: null },
      want: { Underlying: null },
    });

    const {
      give: { Protocol: redeemProtocolAmount },
      want: { Underlying: askedAmount },
    } = seat.getProposal();

    const underlyingAmountToRedeem = ceilMultiplyBy(redeemProtocolAmount, getExchangeRate());
    trace('RedeemAmounts', {
      redeemProtocolAmount,
      underlyingAmountToRedeem,
      askedAmount,
    });
    assertEnoughLiquidtyExists(underlyingAmountToRedeem);
    totalProtocolSupply = AmountMath.subtract(totalProtocolSupply, redeemProtocolAmount);
    seat.decrementBy(
      protocolAssetSeat.incrementBy(harden({ Protocol: redeemProtocolAmount })),
    );
    seat.incrementBy(
      underlyingAssetSeat.decrementBy(harden({ Underlying: underlyingAmountToRedeem })),
    );
    zcf.reallocate(seat, underlyingAssetSeat, protocolAssetSeat);
    seat.exit();
    protocolMint.burnLosses({ Protocol: redeemProtocolAmount }, protocolAssetSeat);

    updateAssetState(UPDATE_ASSET_STATE_OPERATION.REDEEM);

    return 'Success, thanks for doing business with us';
  };

  /**
   * Returns an invitation for the depositHook offer handler.
   * @returns {Promise<Invitation>}
   */
  const makeDepositInvitation = () => {
    /**
     * @type {OfferHandler}
     * @param {ZCFSeat} fundHolderSeat*/
    const depositHook = async fundHolderSeat => {
      console.log('[DEPSOSIT]: Icerdeyim');
      assertProposalShape(fundHolderSeat, {
        give: { Underlying: null },
        want: { Protocol: null },
      });

      const {
        give: { Underlying: fundAmount },
      } = fundHolderSeat.getProposal();

      const protocolAmountToMint = shared.getProtocolAmountOut(fundAmount);
      protocolMint.mintGains(harden({ Protocol: protocolAmountToMint }), protocolAssetSeat);
      totalProtocolSupply = AmountMath.add(totalProtocolSupply, protocolAmountToMint);
      fundHolderSeat.incrementBy(
        protocolAssetSeat.decrementBy(harden({ Protocol: protocolAmountToMint })),
      );

      underlyingAssetSeat.incrementBy(
        fundHolderSeat.decrementBy(harden({ Underlying: fundAmount })),
      );

      zcf.reallocate(fundHolderSeat, underlyingAssetSeat, protocolAssetSeat);
      fundHolderSeat.exit();

      updateAssetState(UPDATE_ASSET_STATE_OPERATION.DEPOSIT);

      return 'Finished';
    };

    return zcf.makeInvitation(depositHook, 'depositFund');
  };

  /** @type {ERef<PoolManager>} */
  return Far('pool manager', {
    ...shared,
    makeBorrowKit,
    redeemHook,
    makeDepositInvitation,
    getNotifier: () => assetNotifer,
  });
};
