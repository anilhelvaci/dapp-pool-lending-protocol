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
import { AssetKind } from '@agoric/ertp';

import { makeScalarMap, keyEQ } from '@agoric/store';
import {
  assertProposalShape,
  getAmountOut,
  getAmountIn,
} from '@agoric/zoe/src/contractSupport/index.js';
import { makeRatioFromAmounts } from '@agoric/zoe/src/contractSupport/ratio.js';
import { Far } from '@endo/marshal';
import { CONTRACT_ELECTORATE } from '@agoric/governance';

import { makeVaultManager } from './vaultManager.js';
import { makeLiquidationStrategy } from './liquidateMinimum.js';
import { makeMakeCollectFeesInvitation } from './collectRewardFees.js';
import { makeVaultParamManager, makeElectorateParamManager } from './params.js';

const { details: X } = assert;

/**
 * @param {ContractFacet} zcf
 * @param {{feeMintAccess: FeeMintAccess, initialPoserInvitation: Invitation}} privateArgs
 */
export const start = async (zcf, privateArgs) => {
  const {
    ammPublicFacet,
    priceAuthority,
    timerService,
    liquidationInstall,
    electionManager,
    main: { [CONTRACT_ELECTORATE]: electorateParam },
    loanTimingParams,
    bootstrappedAssets: bootstrappedAssetBrands
  } = zcf.getTerms();

  const protocolTokenMintsP = bootstrappedAssetBrands.map(async brand => {
    const protocolTokenName = `Ag${await E(brand).getAllegedName()}`;
    return await zcf.makeZCFMint(protocolTokenName, AssetKind.NAT);
  })

  const protocolTokenMints = await Promise.all(protocolTokenMintsP);

  const getProtocolTokenList = () => {
    return protocolTokenMints.map(mint => mint.getIssuerRecord().brand.getAllegedName());
  }

  const publicFacet = Far('lending pool public facet', {
    helloWorld: () => 'Hello World',
    getProtocolTokenList
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
  const vaultFactory = Far('vaultFactory machine', {
    helloFromCreator: () => 'Hello From the creator'
  });

  const lendingPoolWrapper = Far('powerful lendingPool wrapper', {
    getParamMgrRetriever,
    getLimitedCreatorFacet: () => vaultFactory,
  });

  return harden({
    creatorFacet: lendingPoolWrapper,
    publicFacet
  });
};
/** @typedef {Awaited<ReturnType<typeof start>>['publicFacet']} VaultFactoryPublicFacet */
