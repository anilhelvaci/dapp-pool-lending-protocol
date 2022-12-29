import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { POOL_CONFIG } from './poolConfigurations.js';
import newPoolConfig from './newPoolConfig.js';
import {
  makeAmmPoolInitializer,
  makeRates,
  makeSoloHelpers,
  startFaucetIfCustom,
} from 'contract/test/lendingPool/helpers.js';
import { E } from '@endo/far';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import fs from 'fs';

const addNewPool = async (homeP, { pathResolve }) => {
  const {
    LENDING_POOL_CREATOR_FACET_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
    TIMER_ID,
    LENDING_POOL_FAUCET_INSTALL_BOARD_ID,
  } = lendingPoolDefaults;

  const config = process.env.POOL_KWD ? POOL_CONFIG[process.env.POOL_KWD] : newPoolConfig;

  const {
    getValueFromScracth,
    getValueFromBoard,
    getIstBrandAndIssuer,
    getBrandAndIssuerFromBoard,
    suggestIssuer,
    home,
  } = await makeSoloHelpers(homeP);

  console.log('Getting stuff from ag-solo...');
  const [{ value: lendingPoolCF }, { value: priceAuthFacetCF }, { value: timer }, { value: faucetInstalltion }] = await Promise.all([
    getValueFromScracth(LENDING_POOL_CREATOR_FACET_ID),
    getValueFromScracth(PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID),
    getValueFromBoard(TIMER_ID),
    getValueFromBoard(LENDING_POOL_FAUCET_INSTALL_BOARD_ID),
  ]);

  await startFaucetIfCustom(home, config, faucetInstalltion);

  const [
    { istBrand },
    { brand: underlyingBrand, issuer: underlyingIssuer },
  ] = await Promise.all([
    getIstBrandAndIssuer(),
    getBrandAndIssuerFromBoard(config.issuerId),
  ]);

  const rates = makeRates(underlyingBrand, istBrand);
  const priceAuth = await E(priceAuthFacetCF).makeManualPriceAuthority({
        actualBrandIn: underlyingBrand,
        actualBrandOut: istBrand,
        initialPrice: makeRatio(config.priceOutInUnits * 10n ** 6n, istBrand,
          10n ** BigInt(config.displayInfo.decimalPlaces), underlyingBrand),
        timer
      });

  console.log('Adding pool...');
  console.log('Arguments', {
    underlyingIssuer,
    underlyingKeyword: config.keyword,
    params: { rates, riskControls: config.riskControls },
    priceAuth,
  });
  const poolMan = await E(lendingPoolCF).addPoolType(underlyingIssuer, config.keyword, { rates, riskControls: config.riskControls }, priceAuth);
  const protocolIssuer = await E(poolMan).getProtocolIssuer();

  const POOL_MAN_BOARD_ID = `${config.keyword}_POOL_MANAGER_BOARD_ID`;
  const PRICE_AUTH_ID_KEY = `${config.keyword}_IST_PRICE_AUTH_ID`;
  const PROTOCOL_ISSUER_BOARD_ID = `Ag${config.keyword}_ISSUER_BOARD_ID`;
  const PROTOCOL_PURSE_PET_NAME = `Ag${config.keyword} Purse`;

  const PRICE_AUTH_ID_VALUE = `${config.keyword.toLowerCase()}_ist_price_auth_id`;
  const [poolManBoardId, _, protocolIssuerBoardId] = await Promise.all([
    E(home.board).getId(poolMan),
    E(home.scratch).set(PRICE_AUTH_ID_VALUE, priceAuth),
    E(home.board).getId(protocolIssuer),
  ]);

  console.log('Suggesting protocol issuer...');
  await suggestIssuer(PROTOCOL_PURSE_PET_NAME, protocolIssuerBoardId);

  const dappConstants = {
    ...lendingPoolDefaults,
    ...config?.constants,
    [POOL_MAN_BOARD_ID]: poolManBoardId,
    [PRICE_AUTH_ID_KEY]: PRICE_AUTH_ID_VALUE,
    [PROTOCOL_ISSUER_BOARD_ID]: protocolIssuerBoardId,
  };

  const defaultsFile = pathResolve(`../ui/src/generated/lendingPoolDefaults.js`);
  console.log('writing', dappConstants);
  const defaultsContents = `\
// GENERATED FROM ${pathResolve('./addNewPool.js')}
export default ${JSON.stringify(dappConstants, undefined, 2)};
`;

  await fs.promises.writeFile(defaultsFile, defaultsContents);
};
harden(addNewPool);

export default addNewPool;