import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { AmountMath } from '@agoric/ertp';
import { E } from '@endo/eventual-send';

const addHopToPool = async homeP => {
  const {
    HOP_INSTANCE_BOARD_ID,
    HOP_ISSUER_BOARD_ID,
    LENDING_POOL_PUBLIC_FACET_BOARD_ID,
  } = lendingPoolDefaults;

  const {
    getPublicFacetFromInstance,
    getBrandAndIssuerFromBoard,
    getValueFromBoard,
    home
  } = await makeSoloHelpers(homeP);

  const [
    { publicFacet: hopFaucetPublicFacet },
    { brand: hopBrand },
    { value: lpPF },
  ] = await Promise.all([
    getPublicFacetFromInstance(HOP_INSTANCE_BOARD_ID),
    getBrandAndIssuerFromBoard(HOP_ISSUER_BOARD_ID),
    getValueFromBoard(LENDING_POOL_PUBLIC_FACET_BOARD_ID),
  ]);

  const hopAmount = AmountMath.make(hopBrand, 10n * 10n ** 8n);

  const proposal = {
    give: {},
    want: {
      HOP: hopAmount,
    }
  };

  console.log('Getting HOP from the faucet...');
  const [hopFaucetSeat, hopPoolMan] = await Promise.all([
    E(home.zoe).offer(
      E(hopFaucetPublicFacet).makeFaucetInvitation(),
      harden(proposal),
      harden({})
    ),
    E(lpPF).getPool(hopBrand)
  ]);

  console.log('Getting the payout...');
  const [hopLiquidity, protocolAmountOut, payouts, offerResult] = await Promise.all([
    E(hopFaucetSeat).getPayout("HOP"),
    E(hopPoolMan).getProtocolAmountOut(hopAmount),
    E(hopFaucetSeat).getPayouts(),
    E(hopFaucetSeat).getOfferResult(),
  ]);

  const depositProposal = {
    give: {
      Underlying: hopAmount
    },
    want: {
      Protocol: protocolAmountOut
    }
  };

  const paymentKeywordRecord = {
    Underlying: hopLiquidity
  };

  console.log('Depositing liquidity...');
  const depositOfferSeat = await E(home.zoe).offer(
    E(hopPoolMan).makeDepositInvitation(),
    harden(depositProposal),
    harden(paymentKeywordRecord)
  );

  console.log('Getting protocol payment...');
  const [protocolPayment, protocolPurse] = await Promise.all([
    E(depositOfferSeat).getPayout('Protocol'),
    E(home.wallet).getPurse(['LendingPool', 'AgHOP'])
  ]);

  console.log('Depositing protocol...')
  await E(protocolPurse).deposit(protocolPayment);

  console.log('Done...');
};

harden(addHopToPool);
export default addHopToPool;