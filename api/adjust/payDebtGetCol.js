import { makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';
import lendingPoolDefaults from '../../ui/src/generated/lendingPoolDefaults.js';
import { E } from '@endo/far';
import { parseAsNat } from '@agoric/ui-components/dist/display/natValue/parseAsNat.js';

const { details: X } = assert;

const payDebtGetCol = async homeP => {
  assert(process.env.LOAN_ID && process.env.DEBT_VAL && process.env.COL_VAL
    , X`Please set all three of LOAN_ID, DEBT_VAL and COL_VAL env variables.`);

  const { home, getBrandAndIssuerFromBoard } = await makeSoloHelpers(homeP);
  const { LENDING_POOL_INSTALL_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID, VAN_ISSUER_BOARD_ID } = lendingPoolDefaults;

  const [
    { brand: collateralUnderlyingBrand }
  ] = await Promise.all([
    getBrandAndIssuerFromBoard(VAN_ISSUER_BOARD_ID)
  ]);

  const walletBridgeP = E(home.wallet).getBridge();

  const envConfig = {
    id: process.env.LOAN_ID,
    debtValue: parseAsNat(process.env.DEBT_VAL),
    collateralValue: parseAsNat(process.env.COL_VAL)
  };

  const offerConfig = {
    id: `${Date.now()}`,
    continuingInvitation: {
      priorOfferId: envConfig.id,
      description: 'AdjustBalances',
    },
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        Debt: {
          pursePetname: 'PAN Purse',
          value: envConfig.debtValue,
        }
      },
      want: {
        Collateral: {
          pursePetname: 'AgVAN Purse',
          value: envConfig.collateralValue,
        }
      },
      arguments: {
        collateralUnderlyingBrand,
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.')
};

export default harden(payDebtGetCol);