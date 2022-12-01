import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { E } from '@endo/far';
import { assert, details as X, q } from '@agoric/assert';
import {
  calculateProtocolFromUnderlying,
  getPoolMetadata,
  splitCollateral,
  splitCollateralByProtocol,
} from './helpers.js';
import { AmountMath } from '@agoric/ertp';
import { Nat } from '@agoric/nat';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import { makeScalarMap } from '@agoric/store';
import { floorDivideBy, floorMultiplyBy, makeRatio, oneMinus } from '@agoric/zoe/src/contractSupport/index.js';

export const POOL_TYPES = {
  COLLATERAL: 'collateral',
  DEBT: 'debt',
};

export const ADJUST_PROPOSAL_TYPE = {
  GIVE: 'give',
  WANT: 'want',
}

/**
 *
 * @param {ZoeService} zoe
 * @param {{
 *   lendingPoolPublicFacet: LendingPoolPublicFacet,
 *   lendingPoolCreatorFacet: LendingPoolCreatorFacet,
 * }} lendingPoolFacets
 * @param {ManualTimer} timer
 * @param {Brand} compareBrand
 * @param {Mint} collateralUnderlyingMint
 * @param {Mint} debtMint
 */
export const makeLendingPoolScenarioHelpers = (
  zoe, lendingPoolFacets,
  timer, compareBrand,
  collateralUnderlyingMint, debtMint) => {

  const { lendingPoolCreatorFacet, lendingPoolPublicFacet } = lendingPoolFacets;
  /** @type Issuer */
  const collateralUnderlyingIssuer = collateralUnderlyingMint.getIssuer();
  /** @type Brand */
  const collateralUnderlyingBrand = collateralUnderlyingIssuer.getBrand();

  /** @type Issuer */
  const debtIssuer = debtMint.getIssuer();
  /** @type Brand */
  const debtBrand = debtIssuer.getBrand();

  /** @type PoolManager */
  let collateralPoolManager;
  /** @type PoolManager */
  let debtPoolManager;

  let collateralPoolProtocolFaucet;
  let debtPoolProtocolFaucet;

  const actorOperations = makeScalarMap('actorName');

  /**
   * @param rates
   * @param {Ratio} price
   * @param {String} underlyingKeyword
   * @param {String} type
   * @returns {Promise<*>}
   */
  const addPool = async (rates, price, underlyingKeyword, type) => {
    assertPriceCorrect(price, type);

    const { underlyingBrand, underlyingIssuer } = getPoolConfigFromType(type);

    const underlyingPriceAuthority = makeManualPriceAuthority({
      actualBrandIn: underlyingBrand,
      actualBrandOut: compareBrand,
      initialPrice: price,
      timer,
    });

    const pm = await E(lendingPoolCreatorFacet).addPoolType(underlyingIssuer, underlyingKeyword, rates, underlyingPriceAuthority);
    assignPoolManagerAccordingToType(pm, type);

    return { poolManager: pm, priceAuthority: underlyingPriceAuthority };
  };

  /**
   *
   * @param {String} poolType
   * @param {BigInt} amountInUnit
   * @returns {Promise<void>}
   */
  const depositMoney = async (poolType, amountInUnit) => {
    const { poolManager: pm, mint, underlyingBrand } = getPoolConfigFromType(poolType);

    const { /** @type Issuer */ protocolIssuer } = await getPoolMetadata(pm);
    const displayInfo = underlyingBrand.getDisplayInfo();
    const decimalPlaces = displayInfo?.decimalPlaces || 0n;
    const underlyingAmountIn = AmountMath.make(underlyingBrand, amountInUnit * 10n ** Nat(decimalPlaces));
    const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
    const proposal = harden({
      give: { Underlying: underlyingAmountIn },
      want: { Protocol: protocolAmountOut },
    });

    const paymentKeywordRecord = harden({
      Underlying: mint.mintPayment(underlyingAmountIn),
    });

    const invitation = E(pm).makeDepositInvitation();
    /** @type UserSeat */
    const seat = await E(zoe).offer(
      invitation,
      proposal,
      paymentKeywordRecord,
    );

    const {
      Protocol: protocolReceived,
    } = await E(seat).getPayouts();

    const [protocolAmount, offerResult] = await Promise.all([
      E(protocolIssuer).getAmountOf(protocolReceived),
      E(seat).getOfferResult(),
    ]);
    updateFaucet(poolType, protocolReceived);
    return { payment: protocolReceived, amount: protocolAmount, offerResult };
  };

  /**
   *
   * @param {BigInt} underlyingValue
   * @param {BigInt} debtValue
   */
  const borrow = async (underlyingValue, debtValue) => {
    await assertBorrowSetupReady();

    const {
      collateral: { payment: collateralPayment, amount: collateralAmount },
      remaining: { payment: depositedMoneyMinusLoan },
    } = await splitCollateral(collateralPoolManager, collateralPoolProtocolFaucet, underlyingValue);

    // build the proppsal
    const debtProposal = {
      give: { Collateral: collateralAmount },
      want: { Debt: AmountMath.make(debtBrand, debtValue) },
    };

    const debtPaymentKeywordRecord = {
      Collateral: collateralPayment,
    };

    /** @type UserSeat */
    const borrowSeat = await E(zoe).offer(
      E(lendingPoolPublicFacet).makeBorrowInvitation(),
      debtProposal,
      debtPaymentKeywordRecord,
      { collateralUnderlyingBrand: collateralUnderlyingBrand },
    );

    const borrowLoanKit = await E(borrowSeat).getOfferResult();
    updateFaucet(POOL_TYPES.COLLATERAL, depositedMoneyMinusLoan);

    return { moneyLeftInPool: depositedMoneyMinusLoan, loanKit: borrowLoanKit }
  };

  /**
   * @param {WrappedLoan} loan
   * @param {AdjustConfig} collateralConfig
   * @param {AdjustConfig} debtConfig
   */
  const adjust = async (loan, collateralConfig = undefined, debtConfig = undefined) => {
    const { exchangeRate } = await getPoolMetadata(collateralPoolManager);

    const debtAmount = debtConfig ? AmountMath.make(debtBrand, debtConfig.value)
      : undefined;

    const give = {};
    const want = {};
    const paymentRecords = {};

    if (collateralConfig && collateralConfig.type && collateralConfig.type === ADJUST_PROPOSAL_TYPE.GIVE) {
      const { payment, amount } = await getProtocolTokenFromFaucetByColUnderlying(POOL_TYPES.COLLATERAL, collateralConfig.value);
      give.Collateral = amount;
      paymentRecords.Collateral = payment;
    } else if (collateralConfig && collateralConfig.type && collateralConfig.type === ADJUST_PROPOSAL_TYPE.WANT) {
      want.Collateral = calculateProtocolFromUnderlying(AmountMath.make(collateralUnderlyingBrand, collateralConfig.value), exchangeRate);
    }

    if (debtConfig && debtConfig.type && debtConfig.type === ADJUST_PROPOSAL_TYPE.GIVE) {
      give.Debt = debtAmount;
      paymentRecords.Debt = debtMint.mintPayment(debtAmount);
    } else if (debtConfig && debtConfig.type && debtConfig.type === ADJUST_PROPOSAL_TYPE.WANT) {
      want.Debt = debtAmount;
    }

    const proposal = harden({
      give,
      want,
    });

    // Send the offer to adjust the loan
    const seat = await E(zoe).offer(
      E(loan).makeAdjustBalancesInvitation(),
      proposal,
      harden(paymentRecords),
      { collateralUnderlyingBrand },
    );

    await eventLoopIteration();

    return seat;
  };

  /**
   *
   * @param {WrappedLoan} loan
   * @param {{
   *   value: BigInt,
   * }} debtConfig
   */
  const closeLoan = async (
    loan, debtConfig,
  ) => {
    const { value: debtValue } = debtConfig;
    const debtAmount = AmountMath.make(debtBrand, debtValue);

    const collateralAmount = await E(loan).getCollateralAmount();

    const proposal = harden({
      give: { Debt: debtAmount },
      want: { Collateral: collateralAmount },
    });

    const payment = harden({
      Debt: debtMint.mintPayment(debtAmount),
    });

    const seat = await E(zoe).offer(
      E(loan).makeCloseInvitation(),
      proposal,
      payment,
    );
    await eventLoopIteration();

    return seat;
  };

  /**
   *
   * @param {String} poolType
   * @param {BigInt} protocolRedeemValue
   * @returns {Promise<UserSeat>}
   */
  const redeem = async (poolType, protocolRedeemValue) => {
    const { underlyingBrand, poolManager } = getPoolConfigFromType(poolType);
    const { protocolBrand, exchangeRate } = await getPoolMetadata(poolManager);

    const correspondingUnderlyingAmount = floorMultiplyBy(AmountMath.make(protocolBrand, protocolRedeemValue * 10n ** 6n), exchangeRate);
    const slippageRatio = makeRatio(2n, underlyingBrand);
    const underlyingMinusSlippage = floorMultiplyBy(correspondingUnderlyingAmount, oneMinus(slippageRatio));

    const { payment: redeemPayment, amount: redeemAmount } = await getProtocolTokenFromFaucet(poolType, protocolRedeemValue);

    const redeemProposal = {
      give: { Protocol: redeemAmount},
      want: { Underlying: underlyingMinusSlippage }
    };

    const redeemPaymentRecord = {
      Protocol: redeemPayment
    };

    /**
     * @type UserSeat
     */
    const redeemUserSeat = await E(zoe).offer(
      E(lendingPoolPublicFacet).makeRedeemInvitation(underlyingBrand),
      redeemProposal,
      redeemPaymentRecord
    );

    await eventLoopIteration();
    return redeemUserSeat
  };

  /**
   *
   * @param {Ratio} price
   * @param {String} type
   */
  const assertPriceCorrect = (price, type) => {
    const correctUnderlyingBrand = extractUnderlyingBrandFromType(type);
    const { numerator: { brand: compareBrandFromPrice }, denominator: { brand: underlyingBrandFromPrice } } = price;

    assert(correctUnderlyingBrand === underlyingBrandFromPrice,
      X`Brand ${correctUnderlyingBrand} and brand ${underlyingBrandFromPrice} should be the same`);

    assert(compareBrand === compareBrandFromPrice,
      X`Brand ${compareBrand} and brand ${compareBrandFromPrice} should be the same`);
  };

  /**
   * @param {string} type
   */
  const extractUnderlyingBrandFromType = type => {
    if (type === POOL_TYPES.COLLATERAL) return collateralUnderlyingBrand;
    else if (type === POOL_TYPES.DEBT) return debtBrand;
    else throw new Error('Type should be either debt or collateral');
  };

  /**
   *
   * @param {String} poolType
   * @returns {{
   *   poolManager: PoolManager,
   *   mint: Mint,
   *   underlyingBrand: Brand,
   *   underlyingIssuer: Issuer,
   *   protocolFaucet
   * }} poolConfig
   */
  const getPoolConfigFromType = poolType => {
    let poolConfig = {};

    if (poolType === POOL_TYPES.COLLATERAL) poolConfig = {
      poolManager: collateralPoolManager,
      mint: collateralUnderlyingMint,
      underlyingBrand: collateralUnderlyingBrand,
      underlyingIssuer: collateralUnderlyingIssuer,
      protocolFaucet: collateralPoolProtocolFaucet,
    };
    else if (poolType === POOL_TYPES.DEBT) poolConfig = {
      poolManager: debtPoolManager,
      mint: debtMint,
      underlyingBrand: debtBrand,
      underlyingIssuer: debtIssuer,
      protocolFaucet: debtPoolProtocolFaucet,
    };
    else throw new Error('Invalid PoolType');

    return poolConfig;
  };

  /**
   *
   * @param {PoolManager} poolManager
   * @param {String} type
   */
  const assignPoolManagerAccordingToType = (poolManager, type) => {
    if (type === POOL_TYPES.COLLATERAL) collateralPoolManager = poolManager;
    else if (type === POOL_TYPES.DEBT) debtPoolManager = poolManager;
  };

  const assertBorrowSetupReady = async () => {
    const [collateralPoolMetadata, debtPoolMetadata] = await Promise.all([
      getPoolMetadata(collateralPoolManager),
      getPoolMetadata(debtPoolManager),
    ]);

    const { underlyingBrand: underlyingBrandFromColPool } = collateralPoolMetadata;
    const { underlyingBrand: underlyingBrandFromDebtPool } = debtPoolMetadata;

    assert(collateralUnderlyingBrand === underlyingBrandFromColPool,
      X`Brand ${collateralUnderlyingBrand} and brand ${underlyingBrandFromColPool} should be the same`);
    assert(debtBrand === underlyingBrandFromDebtPool,
      X`Brand ${debtBrand} and brand ${underlyingBrandFromDebtPool} should be the same`);
  };

  /**
   *
   * @param {String} poolType
   * @param {BigInt} collateralValue
   */
  const getProtocolTokenFromFaucet = async (poolType, collateralValue) => {
    const { protocolFaucet, poolManager } = getPoolConfigFromType(poolType);
    const {
      remaining: { payment: remainingPayment },
      collateral: splittedProtocol,
    } = await splitCollateralByProtocol(poolManager, protocolFaucet, collateralValue);
    updateFaucet(poolType, remainingPayment);

    return splittedProtocol;
  };

  /**
   *
   * @param {String} poolType
   * @param {BigInt} collateralUnderlyingValue
   */
  const getProtocolTokenFromFaucetByColUnderlying = async (poolType, collateralUnderlyingValue) => {
    const { protocolFaucet, poolManager } = getPoolConfigFromType(poolType);
    const {
      remaining: { payment: remainingPayment },
      collateral: splittedProtocol,
    } = await splitCollateral(poolManager, protocolFaucet, collateralUnderlyingValue);
    updateFaucet(poolType, remainingPayment);

    return splittedProtocol;
  };

  /**
   *
   * @param {String} poolType
   * @param {Payment} newFaucet
   */
  const updateFaucet = (poolType, newFaucet) => {
    if (poolType === POOL_TYPES.COLLATERAL) collateralPoolProtocolFaucet = newFaucet;
    else if (poolType === POOL_TYPES.DEBT) debtPoolProtocolFaucet = newFaucet;
    else throw new Error('Invalid PoolType');
  }

  return harden({
    addPool,
    depositMoney,
    borrow,
    adjust,
    closeLoan,
    redeem,
  })
};