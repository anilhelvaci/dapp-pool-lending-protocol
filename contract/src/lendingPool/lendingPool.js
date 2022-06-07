// @ts-check

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

import { E } from '@agoric/eventual-send';
import '@agoric/governance/src/exported.js';
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
import { LARGE_DENOMINATOR } from '../interest.js';
import { makePoolManager } from './poolManager.js';
import { makePoolParamManager, makeElectorateParamManager } from './params.js';
import { assert } from '@agoric/assert';

const { details: X } = assert;

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
    governedParams: { [CONTRACT_ELECTORATE]: electorateParam },
    loanTimingParams,
    bootstrappedAssets: bootstrappedAssetIssuers,
    compareCurrencyBrand
  } = zcf.getTerms();
  const { initialPoserInvitation } = privateArgs;
  const electorateParamManager = await makeElectorateParamManager(E(zcf).getZoeService(), initialPoserInvitation);

  console.log('[PRICE_MANAGER]', priceManager);
  console.log('[COMPARE_CURRENCY_BRAND]', compareCurrencyBrand);
  console.log('[LIQUIDATION_INSTALL]', liquidationInstall);

  const poolTypes = makeScalarMap('brand');
  const poolParamManagers = makeScalarMap('brand');
  console.log('[LENDING_POOL]');

  const addPoolType = async (underlyingIssuer, underlyingKeyword, rates, priceAuthority) => { // TODO priceAuth as an argument
    await zcf.saveIssuer(underlyingIssuer, underlyingKeyword);
    const protocolMint = await zcf.makeZCFMint(`Ag${underlyingKeyword}`, AssetKind.NAT);
    const { brand: protocolBrand } = protocolMint.getIssuerRecord();
    const underlyingBrand = zcf.getBrandForIssuer(underlyingIssuer);
    // We create only one loan per collateralType.
    assert(
      !poolTypes.has(underlyingBrand),
      `Collateral brand ${underlyingBrand} has already been added`,
    );

    const initialExchangeRate = makeRatioFromAmounts(AmountMath.make(underlyingBrand, 2000000n),
      AmountMath.make(protocolBrand, BigInt(LARGE_DENOMINATOR)));
    const ratesUpdated = harden({
      ...rates,
      initialExchangeRate
    });
    /** a powerful object; can modify parameters */
    const poolParamManager = makePoolParamManager(ratesUpdated);
    poolParamManagers.init(underlyingBrand, poolParamManager);

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
      timerService,
      startTimeStamp,
      getExchangeRateForPool,
      makeRedeemInvitation,
      liquidationInstall,
      ammPublicFacet
    );
    poolTypes.init(underlyingBrand, pm);

    return pm;
  };

  const getExchangeRateForPool = brand => {
    console.log("getExchangeRateForPool: brand", brand);
    assert(
      poolTypes.has(brand),
      X`Not a supported collateral type ${brand}`,
    );
    const collateralPool = poolTypes.get(brand);

    // This is the exchange between the collateral presented as protocolToken
    // and underlying asset corresponding to that protocol token
    return collateralPool.getExchangeRate();
  }

  const makeBorrowInvitation = () => {
    /** @param {ZCFSeat} borrowerSeat
     * @param {Object} offerArgs
     * */
    const borrowHook = async (borrowerSeat, offerArgs) => {
      assertProposalShape(borrowerSeat, {
        give: { Collateral: null },
        want: { Debt: null },
      });

      console.log("*[OFFER_ARGS]*", offerArgs);
      assert(typeof offerArgs == 'object', "[NO_OFFER_ARGS]");
      assert(offerArgs.hasOwnProperty('collateralUnderlyingBrand'), "[NO_OFFER_ARGS]");
      const collateralUnderlyingBrand = offerArgs.collateralUnderlyingBrand;
      console.log("*[collateralUnderlyingBrand]*", collateralUnderlyingBrand);
      const currentCollateralExchangeRate = getExchangeRateForPool(collateralUnderlyingBrand);

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

  const makeRedeemInvitation = (underlyingBrand) => {
    assert(
      poolTypes.has(underlyingBrand),
      X`Not a supported pool type ${underlyingBrand}`,
    );

    const pm = poolTypes.get(underlyingBrand);

    return zcf.makeInvitation(pm.redeemHook, 'Redeem');
  };

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
    makeBorrowInvitation,
    makeRedeemInvitation,
    getAmountKeywordRecord: (keyword, brand, value) => { // This is for repl testing, might remove later
      const amountKeywordRecord = {};
      amountKeywordRecord[keyword] = AmountMath.make(brand, value);
      return amountKeywordRecord;
    }
  });

  const getParamMgrRetriever = () =>
    Far('paramManagerRetriever', {
      get: paramDesc => {
        if (paramDesc.key === 'governedParams') {
          return electorateParamManager;
        } else {
          return poolParamManagers.get(paramDesc.collateralBrand);
        }
      },
    });

  /** @type {LoanFactory} */
  const lendingPool = Far('lendingPool machine', {
    helloFromCreator: () => 'Hello From the creator',
    addPoolType
  });

  const lendingPoolWrapper = Far('powerful lendingPool wrapper', {
    getParamMgrRetriever,
    getLimitedCreatorFacet: () => lendingPool,
    getGovernedApis: () => harden({}),
    getGovernedApiNames: () => harden({}),
  });

  return harden({
    creatorFacet: lendingPoolWrapper,
    publicFacet
  });
};
/** @typedef {Awaited<ReturnType<typeof start>>['publicFacet']} LoanFactoryPublicFacet */
