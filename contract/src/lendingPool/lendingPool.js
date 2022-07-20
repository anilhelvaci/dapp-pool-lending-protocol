// @ts-check

import '@agoric/zoe/exported.js';
import '@agoric/zoe/src/contracts/exported.js';

import { E } from '@endo/far';
import '@agoric/governance/src/exported.js';
import { AmountMath, AssetKind } from '@agoric/ertp';
import { makeTracer } from '@agoric/run-protocol/src/makeTracer.js';
import { makeScalarMap } from '@agoric/store';
import {
  assertProposalShape,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makeRatioFromAmounts } from '@agoric/zoe/src/contractSupport/ratio.js';
import { Far } from '@endo/marshal';
import { LARGE_DENOMINATOR } from '../interest.js';
import { makePoolManager } from './poolManager.js';
import { makePoolParamManager, makeElectorateParamManager } from './params.js';
import { assert } from '@agoric/assert';

const { details: X } = assert;

const trace = makeTracer('LendingPool')

/**
 * This is the entrypoint of the pool based lending protocol. The protocol's base
 * principals are very similar to the Compound Finance, where we have a numner of pools that
 * contain some underlyingAsset and accept multiple types of collaterals in order to
 * lend the underlyingAsset.
 *
 * The pools are funded by the liquidity providers who seek to protect the time value
 * of their money. The liquidty providers are handed a special type of token called 'protocolToken'
 * which is minted when an LP deposits money to a pool. There is an exchange rate between the underlyingAsset
 * and the protocolToken. This exchange rate is 200 Basis Points initially and increases as the interest
 * accrues to the lended underlyingAsset. The interest rate for the borrows is calculated dynamically using
 * a couple of pre-determined paramters and the variables inside a pool. The exact formulas can be found in
 * the Compund Finance White Paper and our implementation of those formulas are in the protocolMath.js module.
 *
 * Loans lended from this protocol are over-colleralized. Meaning that the value of the collateral should be
 * greater than the value of the debt being requested by pre-determined margin. This margin is called the
 * 'liquidationMargin'. When creating a new pool, liquidationMargin is passed as a variable. The values are
 * compared using third currency. For instance; if Alice wants to borrow some simoleans using the protocolTokens
 * she received form depositing some moola and the third currency to be used as compare currency is usd, this
 * means that the max amount of moola Alice can borrow is found with the formula of
 * collateralAmount / liquidationRate. If simolean's value goes up against the compare currency to the point
 * where collateralValueInCompate / debtValueInCompare > collateralAmount / liquidation that loan is liquidated.
 * In our protocol liquidations happen by selling the collateral in Agoric's native AMM. Only the amount of
 * collateral enough to cover the value of the debt is sold. Any remaining collateral will be there for borrower
 * to withdraw.
 *
 * Every pool is bootstrapped with a few parameters called 'Rates'. The content of Rates is as below,
 * - liquidationMargin: The ratio indicating the value of the collateral to the value of the debt.
 *   Loans below this margin get liquidated.
 * - baseRate: Base annual interest rate for the pool.
 * - multipilierRate: A varianle needed in the borrowing interest rate formula
 * - penaltyRate: Rate of the penalty to be paid during the liquidation
 *
 *
 * LendingPool is similar to the VaultFactory in a way that they both accept a collateral and lend money for that collateral.
 * The difference is that VaultFactory mints RUN and lends it whereas LendingPool uses its own liquidty to lend money.
 * Another important difference is that LendingPool lends multiple types of assets whereas VaultFactory only lends RUN.
 * But the logic for chargingInterest, keeping track of lended money, logic related to lifecycle of loan is inherited
 * from VaultFactory. This logic is contained in three main modules
 * - lendingPool.js: Central place for pools in the protocol and an entrypoint for the pools
 * - poolManager.js: Contains logic for a specific type of pool
 * - loan.js: Contains logic for an individual loan
 *
 * Right now only the creator can add new pools but we've kept VaultFactory's governance logic
 * since we might add a DAO later.
 *
 * @param {ZCF} zcf
 * @param {{initialPoserInvitation: Invitation}} privateArgs
 */
export const start = async (zcf, privateArgs) => {

  /** @type {LendingPoolTerms}*/
  const terms = zcf.getTerms();
  const {
    ammPublicFacet,
    priceManager,
    timerService,
    liquidationInstall,
    loanTimingParams,
    compareCurrencyBrand
  } = terms;
  const { initialPoserInvitation } = privateArgs;
  const electorateParamManager = await makeElectorateParamManager(E(zcf).getZoeService(), initialPoserInvitation);

  trace('Bootstrap', {
    priceManager,
    compareCurrencyBrand,
    liquidationInstall,
  });

  const poolTypes = makeScalarMap('brand');
  const poolParamManagers = makeScalarMap('brand');

  /**
   *
   * @param underlyingIssuer
   * @param underlyingKeyword
   * @param rates
   * @param priceAuthority
   * @returns ERef<PoolManager>
   */
  const addPoolType = async (underlyingIssuer, underlyingKeyword, rates, priceAuthority) => { // TODO priceAuth as an argument
    await zcf.saveIssuer(underlyingIssuer, underlyingKeyword);
    const protocolMint = await zcf.makeZCFMint(`Ag${underlyingKeyword}`, AssetKind.NAT, { decimalPlaces: 6 });
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
      initialExchangeRate,
    });
    /** a powerful object; can modify parameters */
    const poolParamManager = makePoolParamManager(ratesUpdated);
    poolParamManagers.init(underlyingBrand, poolParamManager);

    const [startTimeStamp, priceAuthNotifier] = await Promise.all([
      E(timerService).getCurrentTimestamp(),
      E(priceManager).addNewWrappedPriceAuthority(underlyingBrand, priceAuthority, compareCurrencyBrand),
    ]);

    /** @type {ERef<PoolManager>} */
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

  /**
   *
   * @param {Brand} brand
   * @returns {Ratio|*}
   */
  const getExchangeRateForPool = brand => {
    console.log('getExchangeRateForPool: brand', brand);
    assert(
      poolTypes.has(brand),
      X`Not a supported collateral type ${brand}`,
    );
    const collateralPool = poolTypes.get(brand);

    // This is the exchange between the collateral presented as protocolToken
    // and underlying asset corresponding to that protocol token
    return collateralPool.getExchangeRate();
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

      trace('borrowHook: OfferArgs', offerArgs);
      assert(typeof offerArgs == 'object', '[NO_OFFER_ARGS]');
      assert(offerArgs.hasOwnProperty('collateralUnderlyingBrand'), '[NO_OFFER_ARGS]');
      const collateralUnderlyingBrand = offerArgs.collateralUnderlyingBrand;
      trace('borrowHook: collateralUnderlyingBrand', collateralUnderlyingBrand);
      const currentCollateralExchangeRate = getExchangeRateForPool(collateralUnderlyingBrand);

      const {
        want: { Debt: { brand: borrowBrand } },
      } = borrowerSeat.getProposal();
      assert(
        poolTypes.has(borrowBrand),
        X`Not a supported collateral type ${borrowBrand}`,
      );
      const pool = poolTypes.get(borrowBrand);
      return pool.makeBorrowKit(borrowerSeat, currentCollateralExchangeRate);
    };

    return zcf.makeInvitation(borrowHook, 'Borrow');
  };

  /**
   *
   * @param {Brand} underlyingBrand
   * @returns {*|Promise<Invitation>}
   */
  const makeDepositInvitation = underlyingBrand => {
    assert(
      poolTypes.has(underlyingBrand),
      X`Not a supported pool type ${underlyingBrand}`,
    );

    const pm = poolTypes.get(underlyingBrand);

    return pm.makeDepositInvitation();
  }

  /**
   *
   * @param underlyingBrand
   * @returns {*}
   */
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
  };

  const hasPool = brand => {
    const result = poolTypes.has(brand) && poolParamManagers.has(brand);
    return result;
  };

  /**
   *
   * @returns {Promise<Array>}
   */
  const getMarkets = async () => {
    return harden(
      Promise.all(
        [...poolTypes.entries()].map(async ([brand, pm]) => {
          const underlyingWrappedPriceAuthority =  await pm.getPriceAuthorityForBrand(pm.getUnderlyingBrand());
          return {
            brand,
            latestInterestRate: pm.getCurrentBorrowingRate(),
            liquidationMargin: pm.getLiquidationMargin(),
            underlyingBrand: pm.getUnderlyingBrand(),
            protocolBrand: pm.getProtocolBrand(),
            thirdCurrencyBrand: pm.getThirdCurrencyBrand(),
            underlyingToThirdPriceAuthority: underlyingWrappedPriceAuthority.priceAuthority,
            exchangeRate: pm.getExchangeRate(),
            notifier: pm.getNotifier()
          }
        }),
      ),
    );
  };

  /** @type {LendingPoolPublicFacet}*/
  const publicFacet = Far('lending pool public facet', {
    helloWorld: () => 'Hello World',
    hasPool,
    hasKeyword,
    getPool: (brand) => poolTypes.get(brand),
    makeBorrowInvitation,
    makeRedeemInvitation,
    makeDepositInvitation,
    getAmountKeywordRecord: (keyword, brand, value) => { // This is for repl testing, might remove later
      const amountKeywordRecord = {};
      amountKeywordRecord[keyword] = AmountMath.make(brand, value);
      return amountKeywordRecord;
    },
    getMarkets
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

  /** @type {LendingPoolCreatorFacet} */
  const lendingPool = Far('lendingPool machine', {
    helloFromCreator: () => 'Hello From the creator',
    addPoolType,
  });

  const lendingPoolWrapper = Far('powerful lendingPool wrapper', {
    getParamMgrRetriever,
    getLimitedCreatorFacet: () => lendingPool,
    getGovernedApis: () => harden({}),
    getGovernedApiNames: () => harden({}),
  });

  return harden({
    creatorFacet: lendingPoolWrapper,
    publicFacet,
  });
};
