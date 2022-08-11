import { E } from '@endo/far';
import { parseAsNat } from '@agoric/ui-components/dist/display/natValue/parseAsNat';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults';

const closeLoan = async homeP => {
  const home = await homeP;
  const wallet = home.wallet;
  const scopedWb = await E(wallet).getBridge();

  const {
    AGPAN_ISSUER_BOARD_ID, VAN_ISSUER_BOARD_ID, LENDING_POOL_INSTANCE_BOARD_ID, LENDING_POOL_INSTALL_BOARD_ID
  } = lendingPoolDefaults

  const envConfig = {
    id: "1660120294040",
    debtValue: parseAsNat("100000000", ),
    collateralValue: parseAsNat("5000000000")
  };


  const offerConfig = {
    id: `${Date.now()}`,
    continuingInvitation: {
      priorOfferId: String(envConfig.id),
      description: 'CloseLoan',
    },
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      give: {
        Debt: {
          pursePetname: 'VAN Purse',
          value: envConfig.debtValue,
        }
      },
      want: {
        Collateral: {
          pursePetname: 'AgPAN Purse',
          value: envConfig.collateralValue,
        }
      },
    },

  };

  console.log(`Adding CloseLoan Offer: ${offerConfig}`)
  await E(scopedWb).addOffer(harden(offerConfig), {
    dappOrigin: 'http://localhost:3000'
  });
};

export default closeLoan;