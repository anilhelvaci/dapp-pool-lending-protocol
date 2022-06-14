import React from 'react';

import { Button, Typography, Grid } from '@material-ui/core';
import { makeRatio } from '@agoric/zoe/src/contractSupport';

import { resetVault, createVault } from '../../store';
import { useApplicationContext } from '../../contexts/Application';

import { makeLoanOffer } from '../../contexts/makeLoanOffer';
import VaultConfirmation from './VaultConfirmation';
import ErrorBoundary from '../ErrorBoundary';
import { VaultStatus } from '../../constants';

function VaultCreate({
  dispatch,
  vaultConfiguration,
  walletP,
  brandToInfo,
  onOfferMade,
}) {
  // TODO get brandToInfo, dispatch, walletP from state?
  const {
    state: {
      treasury: { treasuryAPI },
    },
  } = useApplicationContext();

  const handleCreate = () => {
    const {
      fundPurse,
      toLock,
      toBorrow,
      dstPurse,
      collateralPercent,
      interestRate,
      liquidationMargin,
      stabilityFee,
    } = vaultConfiguration;
    const id = `${Date.now()}`;

    makeLoanOffer({
      id,
      fundPurse,
      toLock,
      toBorrow,
      dstPurse,
      walletP,
      treasuryAPI,
    });
    const vault = {
      id,
      collateralPercent,
      debt: toBorrow,
      interestRate,
      liquidated: false,
      liquidationMargin,
      locked: toLock,
      stabilityFee,
      status: VaultStatus.PENDING,
      liquidationPenalty: makeRatio(3n, toBorrow.brand),
    };
    dispatch(createVault({ id, vault }));
    onOfferMade();
  };

  return (
    <div>
      <Typography variant="h6">
        Confirm details and create your vault
      </Typography>
      <ErrorBoundary>
        <VaultConfirmation
          vaultConfiguration={vaultConfiguration}
          brandToInfo={brandToInfo}
        ></VaultConfirmation>
        <Grid container justify="flex-end" style={{ marginTop: '16px' }}>
          <Button
            style={{ marginRight: '8px' }}
            onClick={() => dispatch(resetVault())}
          >
            Cancel
          </Button>
          <Button color="primary" variant="contained" onClick={handleCreate}>
            Create
          </Button>
        </Grid>
      </ErrorBoundary>
    </div>
  );
}

export default VaultCreate;
