// @ts-check

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

// The vaultFactory owns a number of VaultManagers and a mint for RUN.
//
// addVaultType is a closely held method that adds a brand new collateral type.
// It specifies the initial exchange rate for that type. It depends on a
// separately specified AMM to provide the ability to liquidate loans that are
// in arrears. We could check that the AMM has sufficient liquidity, but for the
// moment leave that to those participating in the governance process for adding
// new collateral type to ascertain.

// This contract wants to be managed by a contractGovernor, but it isn't
// compatible with contractGovernor, since it has a separate paramManager for
// each Vault. This requires it to manually replicate the API of contractHelper
// to satisfy contractGovernor. It needs to return a creatorFacet with
// { getParamMgrRetriever, getInvitation, getLimitedCreatorFacet }.

import { E } from '@agoric/eventual-send';
import '@agoric/governance/src/exported';
import { AmountMath, AssetKind } from '@agoric/ertp';

import { makeScalarMap, keyEQ } from '@agoric/store';
import {
  assertProposalShape,
  getAmountOut,
  getAmountIn,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makeRatioFromAmounts } from '@agoric/zoe/src/contractSupport/ratio.js';
import { Far } from '@endo/marshal';
import { CONTRACT_ELECTORATE } from '@agoric/governance';

import { makePoolManager } from './poolManager.js';
import { makeLiquidationStrategy } from './liquidateMinimum.js';
import { makeMakeCollectFeesInvitation } from './collectRewardFees.js';
import { makePoolParamManager, makeElectorateParamManager } from './params.js';
import { assert } from '@agoric/assert';

const { details: X } = assert;

const BASIS_POINTS = 10000n;

/**
 * @param {ContractFacet} zcf
 * @param {{feeMintAccess: FeeMintAccess, initialPoserInvitation: Invitation}} privateArgs
 */
export const start = async (zcf, privateArgs) => {
  const {
    ammPublicFacet,
    priceManager,
    timerService,
    liquidationInstall,
    electionManager,
    main: { [CONTRACT_ELECTORATE]: electorateParam },
    loanTimingParams,
    bootstrappedAssets: bootstrappedAssetIssuers,
    compareCurrencyBrand
  } = zcf.getTerms();

  console.log('[PRICE_MANAGER]', priceManager);
  console.log('[COMPARE_CURRENCY_BRAND]', compareCurrencyBrand);

  const poolTypes = makeScalarMap('brand');
  const poolParamManagers = makeScalarMap('brand');
  console.log('[LENDING_POOL]');

  const addPoolType = async (underlyingIssuer, underlyingKeyword, rates, priceAuthority) => { // TODO priceAuth as an argument
    await zcf.saveIssuer(underlyingIssuer, underlyingKeyword);
    const protocolMint = await zcf.makeZCFMint(`Ag${underlyingKeyword}`, AssetKind.NAT);
    const { brand: protocolBrand } = protocolMint.getIssuerRecord();
    const underlyingBrand = zcf.getBrandForIssuer(underlyingIssuer);
    // We create only one vault per collateralType.
    assert(
      !poolTypes.has(underlyingBrand),
      `Collateral brand ${underlyingBrand} has already been added`,
    );

    const initialExchangeRate = makeRatioFromAmounts(AmountMath.make(underlyingBrand, 200n),
      AmountMath.make(protocolBrand, BASIS_POINTS));
    const ratesUpdated = harden({
      ...rates,
      initialExchangeRate
    });
    /** a powerful object; can modify parameters */
    const poolParamManager = makePoolParamManager(ratesUpdated);
    poolParamManagers.init(underlyingBrand, poolParamManager);

    //TODO Create liquadition for dynamic underdlying assets
    // const { creatorFacet: liquidationFacet } = await E(zoe).startInstance(
    //   liquidationInstall,
    //   harden({ RUN: runIssuer, Collateral: underlyingIssuer }),
    //   harden({ amm: ammPublicFacet }),
    // );
    // const liquidationStrategy = makeLiquidationStrategy(liquidationFacet); ??/

    const startTimeStamp = await E(timerService).getCurrentTimestamp();
    const priceAuthNotifier = await E(priceManager).addNewWrappedPriceAuthority(underlyingBrand, priceAuthority, compareCurrencyBrand);

    const pm = makePoolManager(
      zcf,
      protocolMint,
      underlyingBrand,
      underlyingBrand,
      compareCurrencyBrand,
      underlyingKeyword,
      priceAuthority,
      priceAuthNotifier,
      priceManager,
      loanTimingParams,
      poolParamManager.getParams,
      // reallocateWithFee,
      timerService,
      // liquidationStrategy, TODO figure out what to with this later
      startTimeStamp,
    );
    poolTypes.init(underlyingBrand, pm);

    return pm;
  };

  const makeBorrowInvitation = () => {
    /** @param {ZCFSeat} borrowerSeat
     * @param {Object} offerArgs
     * */
    const borrowHook = async (borrowerSeat, offerArgs) => {
      assertProposalShape(borrowerSeat, {
        give: { Collateral: null },
        want: { Debt: null },
      });

      assert(typeof offerArgs == 'object');
      assert(offerArgs.hasOwnProperty('collateralUnderlyingBrand'));
      const collateralUnderlyingBrand = offerArgs.collateralUnderlyingBrand;
      assert(
        poolTypes.has(collateralUnderlyingBrand),
        X`Not a supported collateral type ${collateralUnderlyingBrand}`,
      );
      const collateralPool = poolTypes.get(collateralUnderlyingBrand);

      // This is the exchange between the collateral presented as protocolToken
      // and underlying asset corresponding to that protocol token
      const currentCollateralExchangeRate = await E(collateralPool).getExchangeRate();
      const {
        want: { Debt: { brand: borrowBrand } }
      } = borrowerSeat.getProposal();
      assert(
        poolTypes.has(borrowBrand),
        X`Not a supported collateral type ${borrowBrand}`,
      );
      const pool = poolTypes.get(borrowBrand);
      return pool.makeBorrowKit(borrowerSeat, currentCollateralExchangeRate);
    };

    return zcf.makeInvitation(borrowHook, 'Borrow');
  }

  const hasKeyword = keyword => {
    return zcf.assertUniqueKeyword(keyword);
  }

  const hasPool = brand => {
    const result = poolTypes.has(brand) && poolParamManagers.has(brand);
    return result;
  }

  const publicFacet = Far('lending pool public facet', {
    helloWorld: () => 'Hello World',
    hasPool,
    hasKeyword,
    getPool: (brand) => poolTypes.get(brand),
    makeBorrowInvitation
  });

  const getParamMgrRetriever = () =>
    Far('paramManagerRetriever', {
      get: paramDesc => {
        if (paramDesc.key === 'main') {
          return electorateParamManager;
        } else {
          return vaultParamManagers.get(paramDesc.collateralBrand);
        }
      },
    });

  /** @type {VaultFactory} */
  const lendingPool = Far('lendingPool machine', {
    helloFromCreator: () => 'Hello From the creator',
    addPoolType
  });

  const lendingPoolWrapper = Far('powerful lendingPool wrapper', {
    getParamMgrRetriever,
    getLimitedCreatorFacet: () => lendingPool,
  });

  return harden({
    creatorFacet: lendingPoolWrapper,
    publicFacet
  });
};
/** @typedef {Awaited<ReturnType<typeof start>>['publicFacet']} VaultFactoryPublicFacet */
