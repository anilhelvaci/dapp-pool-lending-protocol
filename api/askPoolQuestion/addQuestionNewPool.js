import lendingPoolDefaults from '../../ui/src/generated/lendingPoolDefaults.js';
import { makeRates, makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import { TimeMath } from '@agoric/swingset-vat/src/vats/timer/timeMath.js';
import { POOL_PROPOSAL_CONFIG } from './config.js';
import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { E } from '@endo/far';

const addQuestionNewPool = async homeP => {
  const {
    home,
    getPublicFacetFromInstance,
    getBrandAndIssuerFromBoard,
    getIstBrandAndIssuer,
    suggestIssuer,
    getValueFromBoard,
  } = await makeSoloHelpers(homeP);

  const {
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    PRICE_MANAGER_PUBLIC_FACET_BOARD_ID,
    TIMER_ID,
    COUNTER_INSTALLATION,
    POP_ISSUER_BOARD_ID,
  } = lendingPoolDefaults;

  const { underlyingIssuerId, keyword, riskControls } = POOL_PROPOSAL_CONFIG;

  console.log('Fetching data from ag-solo...');
  const [
    walletBridge,
    { publicFacet: governorPF },
    {
      brand: underlyingBrand,
      issuer: underlyingIssuer,
    },
    { istBrand },
    { value: priceManPF },
    { value: timer },
    { value: counterInstallation }
  ] = await Promise.all([
    E(home.wallet).getBridge(),
    getPublicFacetFromInstance(LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID),
    getBrandAndIssuerFromBoard(underlyingIssuerId),
    getIstBrandAndIssuer(),
    getValueFromBoard(PRICE_MANAGER_PUBLIC_FACET_BOARD_ID),
    getValueFromBoard(TIMER_ID),
    getValueFromBoard(COUNTER_INSTALLATION),
    suggestIssuer('POP Purse', POP_ISSUER_BOARD_ID),
  ]);

  console.log('Make rates...');
  const rates = makeRates(underlyingBrand, istBrand);

  console.log('Get priceAuth...');
  const { priceAuthority: underlyingPriceAuthority } = await E(priceManPF).getWrappedPriceAuthority(underlyingBrand);
  console.log({ underlyingPriceAuthority });

  console.log('Get current timestamp...');
  const currentTimeStamp = await E(timer).getCurrentTimestamp();

  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(governorPF).makePoseQuestionsInvitation(),
    installationHandleBoardId: LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        POP: {
          pursePetname: 'POP Purse',
          value: [],
        },
      },
      give: {
        LPT: {
          pursePetname: 'LPT Purse',
          value: POOL_PROPOSAL_CONFIG.lockValueInUnits * 10n ** 6n,
        },
      },
      arguments: {
        apiMethodName: 'addPoolType',
        methodArgs: [underlyingIssuer, keyword, { rates, riskControls }, underlyingPriceAuthority],
        voteCounterInstallation: counterInstallation,
        deadline: TimeMath.addAbsRel(currentTimeStamp, POOL_PROPOSAL_CONFIG.deadline),
        vote: POOL_PROPOSAL_CONFIG.vote,
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridge).addOffer(offerConfig);
  console.log('Done.');
};

export default harden(addQuestionNewPool);