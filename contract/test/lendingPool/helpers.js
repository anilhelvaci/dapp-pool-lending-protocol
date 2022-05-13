import { Nat } from '@agoric/nat';
import { E } from '@agoric/eventual-send';
import { AmountMath, AssetKind, makeIssuerKit } from '@agoric/ertp';
import {
  makeRatio,
} from '@agoric/zoe/src/contractSupport/index.js';
import { resolve as importMetaResolve } from 'import-meta-resolve';
import bundleSource from '@endo/bundle-source';
import { makeTracer } from '../../src/makeTracer.js';
import { makeGovernedTerms } from '../../src/lendingPool/params.js';
import * as Collect from '@agoric/run-protocol/src/collect.js';

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
    paymentKeywordRecord
  );

  const {
    Protocol: protocolReceived
  } = await E(seat).getPayouts();

  const protocolAmount = await E(protocolIssuer).getAmountOf(protocolReceived);
  return { payment: protocolReceived, amount: protocolAmount };
};

/**
 * Helper function to add a new pool to the protocol
 * @param zoe
 * @param rates
 * @param lendingPool
 * @param underlyingMint
 * @param underlyingKeyword
 * @param underlyingPriceAuthority
 * @returns {Promise<*>}
 */
export const addPool = async (zoe, rates, lendingPool, underlyingMint, underlyingKeyword, underlyingPriceAuthority) => {
  const underlyingIssuer = underlyingMint.getIssuer();
  const pm = await E(lendingPool).addPoolType(underlyingIssuer, underlyingKeyword, rates, underlyingPriceAuthority);

  return pm;
}

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
  });
}

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
    agPanKit
  });
}

export const makeBundle = async (bundleSource, sourceRoot) => {
  const url = await importMetaResolve(sourceRoot, import.meta.url);
  const path = new URL(url).pathname;
  const contractBundle = await bundleSource(path);
  trace('makeBundle', sourceRoot);
  return contractBundle;
}

export const startLendingPool = async (
  {
    consume: {
      vaultBundles,
      chainTimerService,
      priceManager,
      zoe,
      feeMintAccess: feeMintAccessP, // ISSUE: why doeszn't Zoe await this?
      economicCommitteeCreatorFacet: electorateCreatorFacet,
      bootstrappedAssets,
      compareCurrencyBrand
    },
    produce, // {  vaultFactoryCreator }
    brand: {
      consume: { RUN: centralBrandP },
    },
    instance,
    installation,
  },
  { loanParams } = {
    loanParams: {
      chargingPeriod: SECONDS_PER_HOUR,
      recordingPeriod: SECONDS_PER_DAY,
    },
  },
) => {
  const bundles = await vaultBundles;
  const installations = await Collect.allValues({
    LendingPool: E(zoe).install(bundles.LendingPool),
    liquidate: E(zoe).install(bundles.liquidate),
  });

  const poserInvitationP = E(electorateCreatorFacet).getPoserInvitation();
  const [initialPoserInvitation, invitationAmount] = await Promise.all([
    poserInvitationP,
    E(E(zoe).getInvitationIssuer()).getAmountOf(poserInvitationP),
  ]);

  const centralBrand = await centralBrandP;

  // declare governed params for the vaultFactory; addVaultType() sets actual rates
  const rates = {
    liquidationMargin: makeRatio(105n, centralBrand),
    interestRate: makeRatio(250n, centralBrand, BASIS_POINTS),
    loanFee: makeRatio(200n, centralBrand, BASIS_POINTS),
  };

  const [ammInstance, electorateInstance, contractGovernorInstall] =
    await Promise.all([
      instance.consume.amm,
      instance.consume.economicCommittee,
      installation.consume.contractGovernor,
    ]);
  const ammPublicFacet = await E(zoe).getPublicFacet(ammInstance);

  const lendingPoolTerms = makeGovernedTerms(
    await priceManager,
    loanParams,
    installations.liquidate,
    chainTimerService,
    invitationAmount,
    rates,
    ammPublicFacet,
    await bootstrappedAssets,
    undefined,
    await compareCurrencyBrand
  );
  // const governorTerms = harden({
  //   timer: chainTimerService,
  //   electorateInstance,
  //   governedContractInstallation: installations.VaultFactory,
  //   governed: {
  //     terms: vaultFactoryTerms,
  //     issuerKeywordRecord: {},
  //     privateArgs: harden({ feeMintAccess, initialPoserInvitation }),
  //   },
  // });

  const {
    creatorFacet: lendingPoolCreatorFacet,
    publicFacet: lendingPoolPublicFacet,
    instance: lendingPoolInstance,
  } = await E(zoe).startInstance(
    installations.LendingPool,
    undefined,
    lendingPoolTerms,
    harden({ initialPoserInvitation }),
  );

  // const [vaultFactoryInstance, vaultFactoryCreator] = await Promise.all([
  //   E(governorCreatorFacet).getInstance(),
  //   E(governorCreatorFacet).getCreatorFacet(),
  // ]);
  // const voteCreator = Far('vaultFactory vote creator', {
  //   voteOnParamChange: E(governorCreatorFacet).voteOnParamChange,
  // });
  // produce.vaultFactoryCreator.resolve(vaultFactoryCreator);
  // produce.vaultFactoryGovernorCreator.resolve(governorCreatorFacet);
  // produce.vaultFactoryVoteCreator.resolve(voteCreator);
  // // Advertise the installations, instances in agoricNames.
  // instance.produce.VaultFactory.resolve(vaultFactoryInstance);
  // instance.produce.Treasury.resolve(vaultFactoryInstance);
  // instance.produce.VaultFactoryGovernor.resolve(governorInstance);
  // entries(installations).forEach(([name, install]) =>
  //   installation.produce[name].resolve(install),
  // );
  console.log('PUBLIC_FACET', lendingPoolPublicFacet);
  return harden({
    lendingPoolCreatorFacet,
    lendingPoolPublicFacet,
    lendingPoolInstance
  })

};