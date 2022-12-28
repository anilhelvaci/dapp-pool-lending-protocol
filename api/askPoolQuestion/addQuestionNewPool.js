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
    getValueFromScracth,
    getValueFromBoard,
  } = await makeSoloHelpers(homeP);

  const {
    LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID,
    LENDING_POOL_ELECTION_MANAGER_INSTALLATION_BOARD_ID,
    PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID,
    TIMER_ID,
    COUNTER_INSTALLATION,
  } = lendingPoolDefaults;

  const { underlyingIssuerId, keyword, riskControls } = POOL_PROPOSAL_CONFIG;

  const [
    walletBridge,
    { publicFacet: governorPF },
    {
      brand: underlyingBrand,
      issuer: underlyingIssuer,
    },
    { istBrand },
    { value: priceAuthCF },
    { value: timer },
    { value: counterInstallation }
  ] = await Promise.all([
    E(home.wallet).getBridge(),
    getPublicFacetFromInstance(LENDING_POOL_GOVERNOR_INSTANCE_BOARD_ID),
    getBrandAndIssuerFromBoard(underlyingIssuerId),
    getIstBrandAndIssuer(),
    getValueFromScracth(PRICE_AUTHORITY_FAUCET_CREATOR_FACET_ID),
    getValueFromScracth(TIMER_ID),
    getValueFromBoard(COUNTER_INSTALLATION),
  ]);

  console.log('Make rates...');
  const rates = makeRates(underlyingBrand, istBrand);
  console.log('Make priceAuth...');
  const underlyingPriceAuthority = await E(priceAuthCF).makeManualPriceAuthority({
    actualBrandIn: underlyingBrand,
    actualBrandOut: istBrand,
    initialPrice: makeRatio(POOL_PROPOSAL_CONFIG.price.numeratorValue, istBrand, 10n ** BigInt(POOL_PROPOSAL_CONFIG.decimalPlaces), underlyingBrand),
    timer
  });

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
          value: 20_000n * 10n ** 6n, // 20k units
        },
      },
      arguments: {
        apiMethodName: 'addPoolType',
        methodArgs: [underlyingIssuer, keyword, { rates, riskControls }, underlyingPriceAuthority],
        voteCounterInstallation: counterInstallation,
        deadline: TimeMath.addAbsRel(timer.getCurrentTimestamp(), POOL_PROPOSAL_CONFIG.deadline),
        vote: POOL_PROPOSAL_CONFIG.vote,
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridge).addOffer(offerConfig);
  console.log('Done.');
};

export default harden(addQuestionNewPool);