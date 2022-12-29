import { E } from '@endo/far';
import lendingPoolDefaults from '../ui/src/generated/lendingPoolDefaults.js';
import { getPoolMetadata, makeSoloHelpers } from 'contract/test/lendingPool/helpers.js';

const { details: X } = assert;

const depositVan = async homeP => {
  assert(process.env.VAN_UNIT,
    X`Please specify how much you want to deposit in units by setting VAN_UNIT env variable.`);

  const PROTOCOL_PURSE_NAME = 'AgVAN Purse';

  const {
    LENDING_POOL_INSTALL_BOARD_ID,
    LENDING_POOL_INSTANCE_BOARD_ID,
    LENDING_POOL_PUBLIC_FACET_BOARD_ID,
    VAN_ISSUER_BOARD_ID,
  } = lendingPoolDefaults;

  const { home, getValueFromBoard, getBrandAndIssuerFromBoard, suggestIssuer } = await makeSoloHelpers(homeP);
  const walletBridgeP = E(home.wallet).getBridge();

  const [
    { value: lendingPoolPublicFacet },
    { brand: vanBrand }
  ] = await Promise.all([
    getValueFromBoard(LENDING_POOL_PUBLIC_FACET_BOARD_ID),
    getBrandAndIssuerFromBoard(VAN_ISSUER_BOARD_ID),
  ]);

  const vanPoolMan = E(lendingPoolPublicFacet).getPool(vanBrand);
  const { protocolIssuer } = await getPoolMetadata(vanPoolMan);

  console.log('Putting protocolIssuer to board...');
  const protocolIssuerBoardId = await E(home.board).getId(protocolIssuer);

  console.log('Suggesting issuer...');
  await suggestIssuer(PROTOCOL_PURSE_NAME, protocolIssuerBoardId)

  const offerConfig = {
    id: `${Date.now()}`,
    invitation: E(lendingPoolPublicFacet).makeDepositInvitation(vanBrand),
    installationHandleBoardId: LENDING_POOL_INSTALL_BOARD_ID,
    instanceHandleBoardId: LENDING_POOL_INSTANCE_BOARD_ID,
    proposalTemplate: {
      want: {
        Protocol: {
          // The pursePetname identifies which purse we want to uselib
          pursePetname: 'AgVAN Purse',
          value: 0n,
        },
      },
      give: {
        Underlying: {
          // The pursePetname identifies which purse we want to use
          pursePetname: 'VAN Purse',
          value: BigInt(process.env.VAN_UNIT) * 10n ** 8n,
        },
      },
    },
  };

  console.log('Adding offer...');
  await E(walletBridgeP).addOffer(offerConfig);
  console.log('Done. Check your wallet dashboard to approve the offer.')
};

export default harden(depositVan);