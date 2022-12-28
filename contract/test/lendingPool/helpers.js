import { Nat } from '@agoric/nat';
import { E } from '@endo/far';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import { floorMultiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { resolve as importMetaResolve } from 'import-meta-resolve';
import { makeTracer } from '@agoric/inter-protocol/src/makeTracer.js';
import * as Collect from '@agoric/inter-protocol/src/collect.js';
import { floorDivideBy } from '@agoric/zoe/src/contractSupport/ratio.js';
import { makeManualPriceAuthority } from '@agoric/zoe/tools/manualPriceAuthority.js';
import { eventLoopIteration } from '@agoric/zoe/tools/eventLoopIteration.js';
import { makeSubscription } from '@agoric/notifier';
import { makePromiseSpace } from '@agoric/vats/src/core/utils.js';

const trace = makeTracer('Helper');
const BASIS_POINTS = 10000n;

const { details: X } = assert;

/**
 * @param {ZoeService} zoe
 * @param {PoolManager} pm
 * @param {Mint} underlyingMint
 * @param {bigint} amountInUnit
 * @returns {Promise<{amount: Amount, payment: Payment}>}
 */
export const depositMoney = async (zoe, pm, underlyingMint, amountInUnit) => {
  const underlyingIssuer = underlyingMint.getIssuer();
  const underlyingBrand = underlyingIssuer.getBrand();
  const { protocolBrand, protocolIssuer } = await getPoolMetadata(pm);
  trace('DepositMoney Metadata', {
    protocolBrand,
    protocolIssuer,
  });
  const displayInfo = underlyingBrand.getDisplayInfo();
  const decimalPlaces = displayInfo?.decimalPlaces || 0n;
  const underlyingAmountIn = AmountMath.make(underlyingBrand, amountInUnit * 10n ** Nat(decimalPlaces));
  const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: underlyingMint.mintPayment(underlyingAmountIn),
  });

  const invitation = await E(pm).makeDepositInvitation();
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
  return { payment: protocolReceived, amount: protocolAmount, offerResult };
};

/**
 *
 * @param {ZoeService} zoe
 * @param {LendingPoolPublicFacet} lendingPoolPublicFacet
 * @param {Payment} poolDepositedMoneyPayment
 * @param {PoolManager} collateralUnderlyingPool
 * @param {Nat} underlyingValue
 * @param {Brand} debtBrand
 * @param {Nat} debtValue
 * @returns {Promise<{loanKit: LoanKit, moneyLeftInPool: Payment}>}
 */
export const borrow = async (zoe, lendingPoolPublicFacet, poolDepositedMoneyPayment, collateralUnderlyingPool, underlyingValue, debtBrand, debtValue) => {
  const { underlyingBrand: collateralUnderlyingBrand, protocolBrand, protocolIssuer, exchangeRate } = await getPoolMetadata(collateralUnderlyingPool);

  const {
    collateral: { payment: collateralPayment, amount: collateralAmount },
    remaining: { payment: depositedMoneyMinusLoan },
  } = await splitCollateral(collateralUnderlyingPool, poolDepositedMoneyPayment, underlyingValue);

  // build the proppsal
  const debtProposal = {
    give: { Collateral: collateralAmount },
    want: { Debt: AmountMath.make(debtBrand, debtValue) },
  };

  const debtPaymentKeywordRecord = {
    Collateral: collateralPayment,
  };

  // Get a loan for Alice
  /** @type UserSeat */
  const borrowSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: collateralUnderlyingBrand },
  );

  const borrowLoanKit = await E(borrowSeat).getOfferResult();

  return { moneyLeftInPool: depositedMoneyMinusLoan, loanKit: borrowLoanKit }
};

export const adjust = async (zoe, loan, collateralConfig = undefined, debtConfig = undefined, collateralUnderlyingBrand) => {

  const give = {};
  const want = {};
  const paymentRecords = {};

  if (collateralConfig && collateralConfig.type && collateralConfig.type === 'give') {
    give.Collateral = collateralConfig.amount;
    paymentRecords.Collateral = collateralConfig.payment;
  } else if (collateralConfig && collateralConfig.type && collateralConfig.type === 'want') {
    want.Collateral = collateralConfig.amount;
  }

  if (debtConfig && debtConfig.type && debtConfig.type === 'give') {
    give.Debt = debtConfig.amount;
    paymentRecords.Debt = debtConfig.payment;
  } else if (debtConfig && debtConfig.type && debtConfig.type === 'want') {
    want.Debt = debtConfig.amount;
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
 * @param {ZoeService} zoe
 * @param {WrappedLoan} loan
 * @param {{
 *   amount: Amount,
 *   payment: Payment,
 * }} debtConfig
 * @param {{
 *   collatelralUnderlyingAmount: Amount,
 * }} collateralConfig
 * @param {PoolManager} collateralUnderlyingPoolManager
 * @returns {Promise<void>}
 */
export const closeLoan = async (
  zoe, loan, debtConfig,
  collateralConfig,
  collateralUnderlyingPoolManager
) => {
  const { amount: debtAmount, payment: debtPayment } = debtConfig;
  const { collateralUnderlyingAmount } = collateralConfig;
  const { exchangeRate } = await getPoolMetadata(collateralUnderlyingPoolManager);

  const collateralAmount = calculateProtocolFromUnderlying(collateralUnderlyingAmount, exchangeRate);

  const proposal = harden({
    give: { Debt: debtAmount },
    want: { Collateral: collateralAmount },
  });

  const payment = harden({
    Debt: debtPayment,
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
 * Helper function to add a new pool to the protocol
 *
 * @param {ZoeService} zoe
 * @param {Rates} rates
 * @param {ERef<LendingPoolPublicFacet>} lendingPool
 * @param {Issuer} underlyingIssuer
 * @param {string} underlyingKeyword
 * @param {Ratio} price
 * @param {TimerService} timer
 * @returns {Promise<PoolManager>}
 */
export const addPool = async (zoe, rates, lendingPool, underlyingIssuer, underlyingKeyword, price, timer) => {
  const { numerator: { brand: compareBrand }, denominator: { brand: underlyingBrand } } = price;
  const underlyingPriceAuthority = makeManualPriceAuthority({
    actualBrandIn: underlyingBrand,
    actualBrandOut: compareBrand,
    initialPrice: price,
    timer,
  });
  return await E(lendingPool).addPoolType(underlyingIssuer, underlyingKeyword, rates, underlyingPriceAuthority);
};

/**
 * @param {PoolManager} poolManager
 * @returns {Promise<void>}
 */
export const getPoolMetadata = async poolManager => {
  const [protocolBrand, protocolIssuer, underlyingIssuer, underlyingBrand, exchangeRate, penaltyRate] = await Promise.all([
    E(poolManager).getProtocolBrand(),
    E(poolManager).getProtocolIssuer(),
    E(poolManager).getUnderlyingIssuer(),
    E(poolManager).getUnderlyingBrand(),
    E(poolManager).getExchangeRate(),
    E(poolManager).getPenaltyRate(),
  ]);

  const result = {
    protocolBrand,
    protocolIssuer,
    underlyingIssuer,
    underlyingBrand,
    exchangeRate,
    penaltyRate
  };

  trace('PoolMetadata', result);

  return result;
};

/**
 * Calculates the amount of protocol tokens corresponding to the given underlyingAmount
 *
 * @param {Amount<'nat'>} underlyingAmount
 * @param {Ratio} exchangeRate
 * @returns {Amount<'nat'>}
 */
export const calculateProtocolFromUnderlying = (underlyingAmount, exchangeRate) => {
  return floorDivideBy(
    underlyingAmount,
    exchangeRate,
  );
}

/**
 * Calculates the amount of underlying asset corresponding to the given protocolAmount
 *
 * @param {Amount<'nat'>} protocolAmount
 * @param {Ratio} exchangeRate
 * @return {Amount<'nat'>}
 */
export const calculateUnderlyingFromProtocol = (protocolAmount, exchangeRate) => {
  return floorMultiplyBy(
    protocolAmount,
    exchangeRate,
  );
}

/**
 *
 * @param {PoolManager} poolManager
 * @param {Payment} totalPayment
 * @param {BigInt} collateralUnderlyingValue
 * @returns {Promise<{collateral, remaining}>}
 */
export const splitCollateral = async (poolManager, totalPayment, collateralUnderlyingValue) => {
  const { protocolIssuer, exchangeRate, underlyingBrand } = await getPoolMetadata(poolManager);

  const [collateralPayment, remainingPayment] =
    await E(protocolIssuer).split(totalPayment,
      calculateProtocolFromUnderlying(
        AmountMath.make(underlyingBrand, collateralUnderlyingValue),
        exchangeRate
      ),
    );

  const [collateral, remaining] = await Promise.all([
    extractAmountFromPayment(protocolIssuer, collateralPayment),
    extractAmountFromPayment(protocolIssuer, remainingPayment),
  ])

  return { collateral, remaining };
};

/**
 *
 * @param {PoolManager} poolManager
 * @param {Payment} totalPayment
 * @param {BigInt} collateralValue
 * @returns {Promise<{collateral, remaining}>}
 */
export const splitCollateralByProtocol = async (poolManager, totalPayment, collateralValue) => {


  const { /** @type Issuer */ protocolIssuer, protocolBrand } = await getPoolMetadata(poolManager);

  const [collateralPayment, remainingPayment] =
    await E(protocolIssuer).split(totalPayment,
      AmountMath.make(protocolBrand, collateralValue * 10n ** 6n),
    );

  const [collateral, remaining] = await Promise.all([
    extractAmountFromPayment(protocolIssuer, collateralPayment),
    extractAmountFromPayment(protocolIssuer, remainingPayment),
  ])

  return { collateral, remaining };
};

/**
 *
 * @param {Issuer} issuer
 * @param {Payment} payment
 * @return {Promise<{amount: *, payment}>}
 */
const extractAmountFromPayment = async (issuer, payment) => {
  const amount = await E(issuer).getAmountOf(payment);
  return { payment, amount }
};


export const makeRates = (underlyingBrand, compareBrand) => {
  return harden({
    // margin required to maintain a loan
    liquidationMargin: makeRatio(150n, compareBrand),
    // base rate for dynamic borrowing rate
    baseRate: makeRatio(250n, underlyingBrand, BASIS_POINTS),
    // multipilier rate for utilizitaion rate
    multipilierRate: makeRatio(20n, underlyingBrand),
    // penalty rate for liquidation
    penaltyRate: makeRatio(10n, underlyingBrand),
  });
};

/**
 * Setup test assets for lending pool
 * @returns {*}
 */
export const setupAssets = () => {
  // setup collateral assets
  const vanKit = makeIssuerKit('VAN', AssetKind.NAT, harden({ decimalPlaces: 8 }));
  const sowKit = makeIssuerKit('SOW');
  const panKit = makeIssuerKit('PAN', AssetKind.NAT, harden({ decimalPlaces: 8 }));
  const usdKit = makeIssuerKit('USD', AssetKind.NAT, harden({ decimalPlaces: 6 }));
  const agVanKit = makeIssuerKit('AgVan', AssetKind.NAT, harden({ decimalPlaces: 6 }));
  const agPanKit = makeIssuerKit('AgPan', AssetKind.NAT, harden({ decimalPlaces: 6 }));

  return harden({
    vanKit,
    sowKit,
    panKit,
    usdKit,
    agVanKit,
    agPanKit,
  });
};

/**
 * Bundle source code
 *
 * @param bundleSource
 * @param sourceRoot
 * @returns {Promise<*>}
 */
export const makeBundle = async (bundleSource, sourceRoot) => {
  const url = await importMetaResolve(sourceRoot, import.meta.url);
  const path = new URL(url).pathname;
  const contractBundle = await bundleSource(path);
  trace('makeBundle', sourceRoot);
  return contractBundle;
};

/**
 * Start faucets necessary for testing
 *
 * @param {ZoeService} zoe
 * @param {Installation} installation
 * @returns {Promise<any>}
 */
export const startFaucets = async (zoe, installation) => {

  const installations = await Collect.allValues({
    priceAuthorityFaucet: installation.priceAuthorityFaucet,
    lendingPoolFaucet: installation.lendingPoolFaucet,
    manualTimerFaucet: installation.manualTimerFaucet
  });

  const priceAuthorityFaucetP = E(zoe).startInstance(
    installations.priceAuthorityFaucet,
  );

  const manualTimerFaucetP = E(zoe).startInstance(
    installations.manualTimerFaucet,
  );

  const vanFaucetP = E(zoe).startInstance(
    installations.lendingPoolFaucet,
    undefined,
    {
      keyword: 'VAN',
      displayInfo: {
        decimalPlaces: 8,
      },
    },
  );

  const panFaucetP = E(zoe).startInstance(
    installations.lendingPoolFaucet,
    undefined,
    {
      keyword: 'PAN',
      displayInfo: {
        decimalPlaces: 8,
      },
    },
  );

  const usdFaucetP = E(zoe).startInstance(
    installations.lendingPoolFaucet,
    undefined,
    {
      keyword: 'USD',
      displayInfo: {
        decimalPlaces: 6,
      },
    },
  );

  const [priceAuthorityFaucet,
    manualTimerFaucet,
    vanFaucet,
    panFaucet,
    usdFaucet] = await Promise.all([
    priceAuthorityFaucetP,
    manualTimerFaucetP,
    vanFaucetP,
    panFaucetP,
    usdFaucetP,
  ]);

  return {
    vanAsset: {
      ...vanFaucet
    },
    panAsset: {
      ...panFaucet
    },
    usdAsset: {
      ...usdFaucet
    },
    priceAuthorityFaucet: {
      ...priceAuthorityFaucet
    },
    manualTimerFaucet: {
      ...manualTimerFaucet
    },
    installations,
  };
};

/**
 * We need the priceManager to be alive inside a vat. To do that we turn priceManager into a contract.
 * Here we start that contract.
 *
 * @param {ZoeService} zoe
 * @param {Installation} priceManInstallation
 * @returns {Promise<{priceAuthorityManagerPublicFacet: PriceManager, priceAuthorityManagerInstance: Instance}>}
 */
export const startPriceManager = async (zoe, priceManInstallation) => {

  const {
    creatorFacet: priceAuthorityManagerCreatorFacet,
    publicFacet: priceAuthorityManagerPublicFacet,
    instance: priceAuthorityManagerInstance,
  } = await E(zoe).startInstance(
    priceManInstallation,
  );

  return {
    priceAuthorityManagerPublicFacet,
    priceAuthorityManagerInstance,
  };
};

/**
 * A utility function that makes it easier to receive money from a specified
 * faucet.
 *
 * @param {ZoeService} zoe
 * @param {Invitation} invitation
 * @param {number} unit
 * @param {Brand} brand
 * @param {string} keyword
 * @returns {Promise<Payment>}
 */
export const getLiquidityFromFaucet = async (zoe, invitation, unit, brand, keyword) => {
  const displayInfo = await E(brand).getDisplayInfo();
  const proposalAmountKeywordRecord = {};
  proposalAmountKeywordRecord[keyword] = AmountMath.make(brand, unit * 10n ** BigInt(displayInfo.decimalPlaces));
  const liquidityProposal = {
    give: {},
    want: proposalAmountKeywordRecord,
  };

  const faucetSeat = E(zoe).offer(
    invitation,
    harden(liquidityProposal),
    harden({}),
  );

  return await E(faucetSeat).getPayout(keyword);
};

/**
 *
 * @param t
 * @param {PoolManager} poolManager
 */
export const makeMarketStateChecker = async (t, poolManager) => {

  const poolAssetStateNotifier = await E(poolManager).getNotifier();

  const checkMarketStateInSync = async () => {
    const [{ value: /** @type AssetState */ latestPoolNotification },
      underlyingLiquidity,
      protocolLiquidity,
      borrowingRate,
      totalDebt,
      exchangeRate] = await Promise.all([
      E(poolAssetStateNotifier).getUpdateSince(),
      E(poolManager).getUnderlyingLiquidity(),
      E(poolManager).getProtocolLiquidity(),
      E(poolManager).getCurrentBorrowingRate(),
      E(poolManager).getTotalDebt(),
      E(poolManager).getExchangeRate(),
    ]);

    trace('STATE_SYNC_CHECK', {
      borrowingRate,
      stateLatestInterestRate : latestPoolNotification.latestInterestRate,
      totalDebt,
      stateTotalDebt: latestPoolNotification.totalDebt,
      exchangeRate,
      stateExchangeRate: latestPoolNotification.exchangeRate
    });

    t.deepEqual(underlyingLiquidity, latestPoolNotification.underlyingLiquidity);
    t.deepEqual(protocolLiquidity, latestPoolNotification.protocolLiquidity);
    t.deepEqual(borrowingRate, latestPoolNotification.latestInterestRate);
    t.deepEqual(totalDebt, latestPoolNotification.totalDebt);
    t.deepEqual(exchangeRate, latestPoolNotification.exchangeRate);

  };

  return harden({
    checkMarketStateInSync
  });

}

export const getLatestUpdateFromSubscriber = async (subscriber, updateCount) => {
  const localSubscription = makeSubscription(E(subscriber).getSharableSubscriptionInternals());

  let state;
  let count = 0;
  for await (const val of localSubscription) {
    state = val.current;
    count++;

    if (count === updateCount) break;
  }
  return state;
};

export const makeProtocolAmount = async (poolManager, value) => {
  const { protocolBrand } = await getPoolMetadata(poolManager);
  return AmountMath.make(protocolBrand, value);
};

export const makeAmmPoolInitializer = async ({ homeP }) => {
  const IST_PURSE_NAME = 'Agoric stable local currency';

  const {
    getBrandAndIssuerFromBoard,
    getPublicFacetFromInstance,
    getAmm,
    getIstBrandAndIssuer,
    getPurseFromWallet,
    home
  } = await makeSoloHelpers(homeP);

  const [{ ammPublicFacet }, istRecord, { purse: istPurse }] = await Promise.all([
    getAmm(),
    getIstBrandAndIssuer(),
    getPurseFromWallet(IST_PURSE_NAME),
  ]);

  const initAmmPool = async ({ issuerId, assetId, ammConfig: { centralValue, secondaryValue }, keyword }) => {
    console.log(`Initializing ${keyword}/IST pool in the AMM...`);
    const [{ brand, issuer }, { publicFacet: faucetPF }] = await Promise.all([
      getBrandAndIssuerFromBoard(issuerId),
      getPublicFacetFromInstance(assetId),
    ]);

    const centralAmount = AmountMath.make(istRecord.istBrand, centralValue * 10n ** 6n);
    const secondaryAmount = AmountMath.make(brand,  secondaryValue * 10n ** 8n);

    /** @type Issuer */
    const lpTokenIssuer = await E(ammPublicFacet).addIssuer(
      issuer,
      keyword,
    );
    const lpTokenBrand = await E(lpTokenIssuer).getBrand();
    // const centralPayment = E(istPurseP).withdraw(centralAmount);
    const [centralPayment, secondaryPayment] = await Promise.all([
      E(istPurse).withdraw(centralAmount),
      getLiquidityFromFaucet(home.zoe, E(faucetPF).makeFaucetInvitation(), secondaryValue, brand, keyword),
    ]);

    const proposal = harden({
      give: {
        Secondary: secondaryAmount,
        Central: centralAmount,
      },
      want: { Liquidity: AmountMath.make(lpTokenBrand, 1000n) },
    });
    const payments = {
      Secondary: secondaryPayment,
      Central: centralPayment,
    };

    /** @type UserSeat */
    const addLiquiditySeat = await E(home.zoe).offer(
      E(ammPublicFacet).addPoolInvitation(),
      proposal,
      payments,
    );

    const offetResult = await E(addLiquiditySeat).getOfferResult();
    console.log(`${keyword}/IST Pool Offer Result: ${offetResult}`);
  };

  return harden({
    initAmmPool
  });
}

export const makeSoloHelpers = async homeP => {
  const home = await homeP;
  const { zoe, board, agoricNames, wallet, scratch } = home;

  const getBrandAndIssuerFromBoard = async (issuerBoardId) => {
    const issuer = await E(board).getValue(issuerBoardId);
    const brand = await E(issuer).getBrand();

    return harden({ issuer, brand });
  };

  const getPublicFacetFromInstance = async (instanceId) => {
    const instanceP = E(board).getValue(instanceId);
    const publicFacet = await E(zoe).getPublicFacet(instanceP);

    return harden({ publicFacet });
  };

  const getAmm = async () => {
    const ammInstance = await E(agoricNames).lookup('instance', 'amm');
    const ammPublicFacet = await E(zoe).getPublicFacet(ammInstance);

    return harden({ ammPublicFacet, ammInstance });
  };

  const getIstBrandAndIssuer = async () => {
    const istIssuerP = E(zoe).getFeeIssuer();
    const [istIssuer, istBrand] = await Promise.all([
      istIssuerP,
      E(istIssuerP).getBrand(),
    ]);

    return harden({ istIssuer, istBrand });
  };

  const getInvitationBrandAndIssuer = async () => {
    const invitationIssuerP = E(zoe).getInvitationIssuer();
    const [zoeInvitationIssuer, zoeInvitationBrand] = await Promise.all([
      invitationIssuerP,
      E(invitationIssuerP).getBrand(),
    ]);

    return harden({ zoeInvitationIssuer, zoeInvitationBrand });
  };

  const getPurseFromWallet = async petName => {
    const purse = await E(wallet).getPurse(petName);

    return harden({ purse });
  };

  const getValueFromScracth = async id => {
    const value = await E(scratch).get(id);

    return harden({ value });
  };

  const getValueFromBoard = async id => {
    const value = await E(board).getValue(id);

    return harden({ value });
  }

  return harden({
    getBrandAndIssuerFromBoard,
    getPublicFacetFromInstance,
    getAmm,
    getIstBrandAndIssuer,
    getInvitationBrandAndIssuer,
    getPurseFromWallet,
    getValueFromScracth,
    getValueFromBoard,
    home,
  });
};

export const getSpaces = () => {
  const { produce, consume } = (makePromiseSpace());
  const installation = (makePromiseSpace());
  const instance = (makePromiseSpace());
  const brand = (makePromiseSpace());

  return { produce, consume, installation, instance, brand };
};

export const startFaucetIfCustom = async (home, config, installation) => {
  console.log('Start faucet if custom...');
  if (!config.issuerId || !config.assetId) {
    const faucet = await E(home.zoe).startInstance(installation, undefined, {
      keyword: config.keyword,
      displayInfo: config.displayInfo,
    });

    const issuer = await E(faucet.publicFacet).getIssuer();

    const [
      ISSUER_BOARD_ID,
      INSTANCE_BOARD_ID,
    ] = await Promise.all([
      E(home.board).getId(issuer),
      E(home.board).getId(faucet.instance),
    ]);

    const NEW_ASSET_ISSUER_BOARD_ID = `${config.keyword}_ISSUER_BOARD_ID`;
    const NEW_ASSET_INSTANCE_BOARD_ID = `${config.keyword}_INSTANCE_BOARD_ID`;

    config.issuerId = ISSUER_BOARD_ID;
    config.assetId = INSTANCE_BOARD_ID;
    config.constants = {
      [NEW_ASSET_ISSUER_BOARD_ID]: ISSUER_BOARD_ID,
      [NEW_ASSET_INSTANCE_BOARD_ID]: INSTANCE_BOARD_ID
    };
    console.log('Config', config);
  }
};

export const makeWithdrawInvitationHelper = async ({ soloHelpers, instanceId, govDescription }) => {

  const {
    getInvitationBrandAndIssuer,
    getPurseFromWallet,
    getValueFromBoard,
  } = soloHelpers;

  const [{ purse: invitePurse }, { value: lendingPoolInstance }, {
    zoeInvitationBrand,
  }] = await Promise.all([
    getPurseFromWallet('Default Zoe invite purse'),
    getValueFromBoard(instanceId),
    getInvitationBrandAndIssuer(),
  ]);

  const findCorrectInvitation = async (currentAmount) => {
    const invitationValues = AmountMath.getValue(zoeInvitationBrand, currentAmount);

    return invitationValues.find(invitationValue => {
      const { description, instance } = invitationValue;
      console.log({ description, instance });
      return govDescription === description && instance === lendingPoolInstance;
    });
  };

  const withdraw = async () => {
    const currentAmount = await E(invitePurse).getCurrentAmount();
    const invitationValue = await findCorrectInvitation(currentAmount);
    assert(invitationValue, X`Could not find the correct invitation.`);

    const invitationAmount = AmountMath.make(zoeInvitationBrand, harden([invitationValue]));
    return E(invitePurse).withdraw(invitationAmount);
  };

  return harden({
    withdraw,
  });
};