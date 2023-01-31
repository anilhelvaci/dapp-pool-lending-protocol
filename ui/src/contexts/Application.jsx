import React, { createContext, useContext, useReducer } from 'react';

import { E } from '@endo/captp';
import { makeAsyncIterableFromNotifier as iterateNotifier } from '@agoric/notifier';

import lendingPoolDappConfig from '../generated/lendingPoolDefaults';

import {
  defaultState,
  initial,
  initLoans,
  mergeBrandToInfo,
  reducer,
  setLendingPool,
  setLoan,
  setLoanAsset,
  setMarkets,
  setPurses,
  createMarket,
  addPrice,
  updateMarket,
  updatePrice,
  updateLoan,
  hasMarket,
  initMarkets,
} from '../store';
import LendingPoolWalletConnection from '../components/lendingPool/LendingPoolWalletConnection';
import { LoanStatus, OperationType } from '../constants';

// eslint-disable-next-line import/no-mutable-exports
let walletP;
export { walletP };

export const ApplicationContext = createContext({
  state: initial,
  dispatch: /** @type { any } */ (undefined),
  walletP: /** @type { any } */ (undefined),
});

export function useApplicationContext() {
  return useContext(ApplicationContext);
}

/**
 * This method extract the loanNotifier from publicNotifiers of the offerResult returned.
 * Then turns that loanNotifer into a aysncIterable to watch the state updates coming from the loan.
 * Possible state updates:
 * - LoanStatus: [ACTIVE, CLOSED, LIQUIDATED...]
 * - Amount of debt
 * - Amount of collateral locked
 *
 * Also adds some additional states that do not exist inside the actual loan object
 * in order to improve UX by giving users better messages.
 *
 * @param {string} id
 * @param {any} dispatch
 * @param {string} offerStatus
 */
function watchLoan(id, dispatch, offerStatus) {
  console.log('vaultWatched', id);

  // There is no UINotifier for offers that haven't been accepted, but
  // we still want to show that the offer exists
  if (offerStatus !== 'accept') {
    dispatch(
      updateLoan({
        id,
        loan: { id, loanState: LoanStatus.PENDING },
      }),
    );
  } else {
    dispatch(
      updateLoan({
        id,
        loan: { id, loanState: LoanStatus.LOADING },
      }),
    );
  }

  // Listens for invidual loan state updates
  async function loanUpdater(loan) {
    for await (const state of iterateNotifier(loan)) {
      console.log('======== Loan', id, state);
      dispatch(
        updateLoan({
          id,
          loan: { ...state },
        }),
      );
    }
    // We get the final state when the noifier finishes
    const { value: lastState } = await E(loan).getUpdateSince();
    dispatch(updateLoan({ id, loan: { ...lastState } }));
    console.log("==== watched loan", lastState);
  }

  // Extracts the loanNotifier from the offerResult
  async function watch() {
    let loanNotifier;
    try {
      const notifiers = await E(walletP).getPublicNotifiers(id);
      ({ loanNotifier } = notifiers);
    } catch (err) {
      console.error('Could not get notifiers', id, err);
      dispatch(updateLoan({ id, loan: { loanState: LoanStatus.ERROR, err } }));
      return;
    }

    loanUpdater(loanNotifier).catch(err => {
      console.error('Loan watcher exception', id, err);
      dispatch(updateLoan({ id, loan: { loanState: LoanStatus.ERROR, err } }));
    });
  }

  watch();
}

/**
 * This is the main method for being notified about offers. We basically
 * get the offersNotifier from the walletBridge, make it an asyncIterable then
 * start listening for offers. The notification format is a list of all offers
 * like [offerOne, offerTwo...]. Thus, on every new offer we iterate all offers
 * made until that time. This helps us to keep track of the state in a consistant
 * way since the notifiers are lossy. // see https://docs.agoric.com/guides/js-programming/notifiers.html#distributed-asynchronous-iteration
 *
 * The method offersUpdater iterates over that list returned as the notification
 * and checks for a few things;
 * - OperationType: There's an 'operation' property injected to the requestContext in the offers that are made from this app,
 * indicating that whether the operation is 'deposit', 'borrow', 'close', 'adjust', 'redeem' or not. Currently we only care
 * about 'borrow' operation since we do not show users their full history of operations but need to keep track loans by
 * the offerResults returned from 'borrow' offers. We might reconsider that later.
 * - InstanceId: We check this to make sure the offer is made to the correct contract instance.
 * - ContinuingInvitaion: This is also checked to make sure the offer is not a 'close' or 'adjust' offer.
 *
 *
 * @param {any} dispatch
 * @param {string} INSTANCE_BOARD_ID
 */
const watchOffers= (dispatch, INSTANCE_BOARD_ID) => {
  const watchedLoans = new Set();

  const offersUpdater = async () => {
    const offerNotifier = E(walletP).getOffersNotifier();
    for await (const offers of iterateNotifier(offerNotifier)) {
      for (const offer of offers) {
        console.log('======== NEW_OFFER', offer);
        const { id, status, operation, continuingInvitation, instanceHandleBoardId } = offer;
        if (
          operation && operation === OperationType.BORROW &&
          instanceHandleBoardId === INSTANCE_BOARD_ID &&
          continuingInvitation === undefined // AdjustBalances and CloseVault offers use continuingInvitation
        ) {
          if (status === 'decline') {
            // We don't care about declined offers, still update the vault so
            // the UI can hide it if needed.
            dispatch(
              updateLoan({
                id,
                loan: { loanState: LoanStatus.DECLINED },
              }),
            );
          } else if (!watchedLoans.has(id)) {
            watchedLoans.add(id);
            watchLoan(id, dispatch, status);
          }
        }
      }
      if (!watchedLoans.size) {
        dispatch(initLoans());
      }
    }
    console.log('======== OFFERS', offers);
  }

  offersUpdater().catch(err => console.error('Offers watcher exception', err));
}

const setupLendingPool = async (dispatch, zoe, board, instanceID) => {
  /** @type { Instance } */
  const instance = await E(board).getValue(instanceID);
  const lendingPoolPublicFacetP = E(zoe).getPublicFacet(instance);
  /** @type { ERef<VaultFactory> } */
  const [lendingPoolPublicFacet, poolNotifier] = await Promise.all([
    lendingPoolPublicFacetP,
    E(lendingPoolPublicFacetP).getPoolNotifier(),
  ]);

  dispatch(
    setLendingPool({ publicFacet: lendingPoolPublicFacet, instance }),
  );

  dispatch(initMarkets());

  watchPools(poolNotifier, dispatch).catch(err => console.log('Error when watching the pool:', err));
};

const toBrandToInfoItem = (brand, brandDisplayInfo) => {
  const decimalPlaces = brandDisplayInfo.displayInfo.decimalPlaces;
  return [
    brand,
    {
      assetKind: brandDisplayInfo.assetKind,
      decimalPlaces,
      petname: brandDisplayInfo.petName,
      brand,
    },
  ];
};

const watchMarket = async (brand, assetNotifier, dispatch) => {
  for await (const value of iterateNotifier(assetNotifier)) {
    dispatch(updateMarket({ id: brand, market: { ...value } }));
  }
};

const watchPrices = async (brandIn, priceNotifier, dispatch) => {
  for await (const value of iterateNotifier(priceNotifier)) {
    dispatch(updatePrice({ id: brandIn, quote: { ...value } }));
  }
};

const watchPools = async (poolNotifier, dispatch) => {
  let count = 1;
  for await (const markets of iterateNotifier(poolNotifier)) {
    for (const market of markets) {
      console.log('[COUNT]', count);
      count++;
      if(!market) continue; // Control hasMarket

      const [underlyingToThirdWrappedPriceAuthority, marketDisplayInfo] =  await Promise.all([
        market.underlyingToThirdWrappedPriceAuthorityP,
        buildDisplayInfoForMarket(market),
      ]);
      buildBrandToInfo(marketDisplayInfo, dispatch, market);
      createPurseForPoolTokens(market, marketDisplayInfo)
        .catch(err => console.log('[ERROR] Error when creating purses:', err));
      watchMarket(market.underlyingBrand, market.notifier, dispatch)
        .catch(err => console.log('[ERROR] Error when wathing market', err));
      watchPrices(market.underlyingBrand, underlyingToThirdWrappedPriceAuthority.notifier, dispatch)
        .catch(err => console.log('[ERROR] Error when wathing prices', err));
      dispatch(createMarket({ id: market.underlyingBrand, market }));
    }
  }
};

const createPurseForPoolTokens = async (market, displayInfo) => {
  const { underlyingIssuerBoardId, protocolIssuerBoardId } = await getBoardIDsForMarket(market);
  await Promise.all([
    E(walletP).suggestIssuer(displayInfo.underlying.petName, underlyingIssuerBoardId),
    E(walletP).suggestIssuer(displayInfo.protocol.petName, protocolIssuerBoardId),
  ]);
};

const getBoardIDsForMarket = async market => {
  const [underlyingIssuerBoardId, protocolIssuerBoardId] = await Promise.all([
    getBoardIDForIssuer(market.underlyingIssuer),
    getBoardIDForIssuer(market.protocolIssuer),
  ]);

  return harden({
    underlyingIssuerBoardId,
    protocolIssuerBoardId
  });
}

const getBoardIDForIssuer = issuer => {
  return E(E(walletP).getBoard()).getId(issuer);
};

const buildDisplayInfoForMarket = async market => {
  const [underlyingDisplayInfo, underlyingAllegedName, protocolDisplayInfo,
    protocolAllegedName, thirdCurrencyDisplayInfo, thirdCurrencyAllegedName] =
    await Promise.all([
      E(market.underlyingBrand).getDisplayInfo(),
      E(market.underlyingBrand).getAllegedName(),
      E(market.protocolBrand).getDisplayInfo(),
      E(market.protocolBrand).getAllegedName(),
      E(market.thirdCurrencyBrand).getDisplayInfo(),
      E(market.thirdCurrencyBrand).getAllegedName(),
    ]);
  return {
    underlying: { displayInfo: underlyingDisplayInfo, petName: underlyingAllegedName },
    protocol: { displayInfo: protocolDisplayInfo, petName: protocolAllegedName },
    thirdCurrency: { displayInfo: thirdCurrencyDisplayInfo, petName: thirdCurrencyAllegedName },
  };
};

const buildBrandToInfo = (displayInfo, dispatch, market) => {
  const underlyingBrandDisplayInfo = displayInfo.underlying;

  const protocolBrandDisplayInfo = displayInfo.protocol;

  const thirdCurrencyBrandDisplayInfo = displayInfo.thirdCurrency;

  const newBrandToInfo = Array.from([
    toBrandToInfoItem(market.underlyingBrand, underlyingBrandDisplayInfo),
    toBrandToInfoItem(market.protocolBrand, protocolBrandDisplayInfo),
    toBrandToInfoItem(market.thirdCurrencyBrand, thirdCurrencyBrandDisplayInfo),
  ]);

  console.log('NewBranToInfo', newBrandToInfo)

  dispatch(mergeBrandToInfo(newBrandToInfo));
};

/* eslint-disable complexity, react/prop-types */
export default function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, defaultState);
  const { brandToInfo } = state;

  const retrySetup = async () => {

    const zoe = E(walletP).getZoe();
    const board = E(walletP).getBoard();

    const {
      LENDING_POOL_INSTANCE_BOARD_ID,
    } = lendingPoolDappConfig;

    await setupLendingPool(dispatch, zoe, board, LENDING_POOL_INSTANCE_BOARD_ID);

    // The moral equivalent of walletGetPurses()
    async function watchPurses() {
      const pn = E(walletP).getPursesNotifier();
      for await (const purses of iterateNotifier(pn)) {
        dispatch(setPurses(purses));
      }
    }

    watchPurses().catch(err =>
      console.error('ERROR: got watchPurses err', err),
    );

    await Promise.all([
      E(walletP).suggestInstance('Instance', LENDING_POOL_INSTANCE_BOARD_ID),
    ]);

    watchOffers(dispatch, LENDING_POOL_INSTANCE_BOARD_ID);
  };

  const setWalletP = async bridge => {
    walletP = bridge;

    console.log('set walletP');
    await retrySetup();
  };

  return (
    <ApplicationContext.Provider
      value={{ state, dispatch, walletP, retrySetup }}
    >
      {children}
      {/*<WalletConnection setWalletP={setWalletP} dispatch={dispatch} />*/}
      <LendingPoolWalletConnection dispatch={dispatch} setWalletP={setWalletP}></LendingPoolWalletConnection>
    </ApplicationContext.Provider>
  );
}
