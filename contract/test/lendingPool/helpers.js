import { Nat } from '@agoric/nat';
import { E } from '@agoric/eventual-send';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import {
  makeRatio,
} from '@agoric/zoe/src/contractSupport/index.js';
import { resolve as importMetaResolve } from 'import-meta-resolve';
import { makeTracer } from '../../src/makeTracer.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';
import { floorDivideBy } from '@agoric/zoe/src/contractSupport/ratio.js';

const trace = makeTracer('Helper');
const BASIS_POINTS = 10000n;

/**
 * @param {ZoeService} zoe
 * @param {PoolManager} pm
 * @param {Mint} underlyingMint
 * @param {Amount} amountInUnit
 * @returns {Promise<{amount: Amount, payment: Payment}>}
 */
export const depositMoney = async (zoe, pm, underlyingMint, amountInUnit) => {
  const underlyingIssuer = underlyingMint.getIssuer();
  const underlyingBrand = underlyingIssuer.getBrand();
  const protocolBrand = await E(pm).getProtocolBrand();
  const protocolIssuer = await E(pm).getProtocolIssuer();
  console.log('[BRAND]:', protocolBrand);
  console.log('[ISSUER]:', protocolIssuer);
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
  const seat = await E(zoe).offer(
    invitation,
    proposal,
    paymentKeywordRecord,
  );

  const {
    Protocol: protocolReceived,
  } = await E(seat).getPayouts();

  const protocolAmount = await E(protocolIssuer).getAmountOf(protocolReceived);
  return { payment: protocolReceived, amount: protocolAmount };
};

export const borrow = async (zoe, lendingPoolPublicFacet, poolDepositedMoneyPayment, collateralUnderlyingPool, underlyingValue, debtBrand, debtValue) => {
  const [collateralUnderlyingBrand, protocolBrand, protocolIssuer] = await Promise.all([
    E(collateralUnderlyingPool).getUnderlyingBrand(),
    E(collateralUnderlyingPool).getProtocolBrand(),
    E(collateralUnderlyingPool).getProtocolIssuer(),
  ]);

  const [collateralPayment, depositedMoneyMinusLoan] =
    await E(protocolIssuer).split(poolDepositedMoneyPayment,
      floorDivideBy(AmountMath.make(collateralUnderlyingBrand, underlyingValue), await E(collateralUnderlyingPool).getExchangeRate()));

  // build the proppsal
  const debtProposal = {
    give: { Collateral: await E(protocolIssuer).getAmountOf(collateralPayment) },
    want: { Debt: AmountMath.make(debtBrand, debtValue) },
  };

  const debtPaymentKeywordRecord = {
    Collateral: collateralPayment,
  };

  // Get a loan for Alice
  const borrowSeat = await E(zoe).offer(
    E(lendingPoolPublicFacet).makeBorrowInvitation(),
    debtProposal,
    debtPaymentKeywordRecord,
    { collateralUnderlyingBrand: collateralUnderlyingBrand },
  );

  const borrowLoanKit = await E(borrowSeat).getOfferResult();

  return { moneyLeftInPool: depositedMoneyMinusLoan, loanKit: borrowLoanKit }
}

/**
 * Helper function to add a new pool to the protocol
 * @param zoe
 * @param rates
 * @param lendingPool
 * @param underlyingIssuer
 * @param underlyingKeyword
 * @param underlyingPriceAuthority
 * @returns {Promise<*>}
 */
export const addPool = async (zoe, rates, lendingPool, underlyingIssuer, underlyingKeyword, underlyingPriceAuthority) => {
  // const underlyingIssuer = underlyingMint.getIssuer();
  const pm = await E(lendingPool).addPoolType(underlyingIssuer, underlyingKeyword, rates, underlyingPriceAuthority);

  return pm;
};

export const makeRates = (underlyingBrand, compareBrand) => {
  return harden({
    // margin required to maintain a loan
    liquidationMargin: makeRatio(150n, compareBrand),
    // periodic interest rate (per charging period)
    interestRate: makeRatio(100n, underlyingBrand, BASIS_POINTS),
    // charge to create or increase loan balance
    loanFee: makeRatio(500n, underlyingBrand, BASIS_POINTS), // delete
    // base rate for dynamic borrowing rate
    baseRate: makeRatio(250n, underlyingBrand, BASIS_POINTS),
    // multipilier rate for utilizitaion rate
    multipilierRate: makeRatio(20n, underlyingBrand),
    // penalty rate for liquidation
    penaltyRate: makeRatio(10n, underlyingBrand),
  });
};

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

export const makeBundle = async (bundleSource, sourceRoot) => {
  const url = await importMetaResolve(sourceRoot, import.meta.url);
  const path = new URL(url).pathname;
  const contractBundle = await bundleSource(path);
  trace('makeBundle', sourceRoot);
  return contractBundle;
};

export const startFaucets = async (zoe, installation) => {

  const installations = await Collect.allValues({
    priceAuthorityFaucet: installation.priceAuthorityFaucet,
    lendingPoolFaucet: installation.lendingPoolFaucet,
  });

  // start priceAuthorityFaucet
  const {
    creatorFacet: priceAuthorityFaucetCreatorFacet,
    publicFacet: priceAuthorityFaucetPublicFacet,
    instance: priceAuthorityFaucetInstance,
  } = await E(zoe).startInstance(
    installations.priceAuthorityFaucet,
  );

  // start vanFaucet
  const {
    creatorFacet: vanFaucetCreatorFacet,
    publicFacet: vanFaucetPublicFacet,
    instance: vanFaucetInstance,
  } = await E(zoe).startInstance(
    installations.lendingPoolFaucet,
    undefined,
    {
      keyword: 'VAN',
      displayInfo: {
        decimalPlaces: 8,
      },
    },
  );

  // start panFaucet
  const {
    creatorFacet: panFaucetCreatorFacet,
    publicFacet: panFaucetPublicFacet,
    instance: panFaucetInstance,
  } = await E(zoe).startInstance(
    installations.lendingPoolFaucet,
    undefined,
    {
      keyword: 'PAN',
      displayInfo: {
        decimalPlaces: 8,
      },
    },
  );

  // start usdFaucet
  const {
    creatorFacet: usdFaucetCreatorFacet,
    publicFacet: usdFaucetPublicFacet,
    instance: usdFaucetInstance,
  } = await E(zoe).startInstance(
    installations.lendingPoolFaucet,
    undefined,
    {
      keyword: 'USD',
      displayInfo: {
        decimalPlaces: 6,
      },
    },
  );

  return {
    vanAsset: {
      creatorFacet: vanFaucetCreatorFacet,
      publicFacet: vanFaucetPublicFacet,
      instance: vanFaucetInstance,
    },
    panAsset: {
      creatorFacet: panFaucetCreatorFacet,
      publicFacet: panFaucetPublicFacet,
      instance: panFaucetInstance,
    },
    usdAsset: {
      creatorFacet: usdFaucetCreatorFacet,
      publicFacet: usdFaucetPublicFacet,
      instance: usdFaucetInstance,
    },
    priceAuthorityFaucet: {
      creatorFacet: priceAuthorityFaucetCreatorFacet,
      publicFacet: priceAuthorityFaucetPublicFacet,
      instance: priceAuthorityFaucetInstance,
    },
    installations,
  };
};

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