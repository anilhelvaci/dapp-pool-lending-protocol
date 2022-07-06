import React, { createContext, useContext, useReducer } from 'react';

import { E } from '@endo/captp';
import { makeAsyncIterableFromNotifier as iterateNotifier } from '@agoric/notifier';

import { dappConfig, lendingPoolDappConfig, refreshConfigFromWallet } from '../utils/config';

import {
  initial,
  reducer,
  defaultState,
  setPurses,
  initVaults,
  updateVault,
  setCollaterals,
  setTreasury,
  setLendingPool,
  mergeBrandToInfo,
  setLoadTreasuryError,
  mergeRUNStakeHistory,
  setRUNStake,
  setLoan,
  setLoanAsset,
} from '../store';
import { updateBrandPetnames, storeAllBrandsFromTerms } from './storeBrandInfo';
import WalletConnection from '../components/WalletConnection';
import { LoanStatus, VaultStatus } from '../constants';

// eslint-disable-next-line import/no-mutable-exports
let walletP;
export { walletP };

export const ApplicationContext = createContext({
  state: initial,
  // TODO: type for dispatch
  dispatch: /** @type { any } */ (undefined),
  // TODO: type for walletP
  walletP: /** @type { any } */ (undefined),
  retrySetup: /** @type { any } */ (undefined),
});

export function useApplicationContext() {
  return useContext(ApplicationContext);
}

const setupLendingPool = async (dispatch, zoe, board, instanceID) => {
  /** @type { Instance } */
  const instance = await E(board).getValue(instanceID);
  /** @type { ERef<VaultFactory> } */
  const lendingPoolPublicFacet = await E(zoe).getPublicFacet(instance);

  dispatch(
    setLendingPool({publicFacet: lendingPoolPublicFacet, instance}),
  );
}

/* eslint-disable complexity, react/prop-types */
export default function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, defaultState);
  const { brandToInfo } = state;



  const setWalletP = async bridge => {
    walletP = bridge;
  };

  return (
    <ApplicationContext.Provider
      value={{ state, dispatch, walletP }}
    >
      {children}
      <WalletConnection setWalletP={setWalletP} dispatch={dispatch} />
    </ApplicationContext.Provider>
  );
}
