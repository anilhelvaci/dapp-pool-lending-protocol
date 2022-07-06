// @ts-check
import React, { useState } from 'react';
import { Redirect } from 'react-router-dom';

import { makeStyles } from '@material-ui/core/styles';

import { Paper, Typography } from '@material-ui/core';
import { E } from '@endo/captp';
import VaultSteps from './VaultSteps';

import { useApplicationContext } from '../../contexts/Application';
import VaultCollateral from './VaultCollateral';
import VaultConfigure from './VaultConfigure/VaultConfigure';
import VaultCreate from './VaultCreate';
import ErrorBoundary from '../ErrorBoundary';
import { resetVault } from '../../store';

const useStyles = makeStyles(theme => ({
  paper: {
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(3),
    padding: theme.spacing(2),
    [theme.breakpoints.up(600 + theme.spacing(3) * 2)]: {
      marginTop: theme.spacing(6),
      marginBottom: theme.spacing(6),
      padding: theme.spacing(3),
    },
    width: 'fit-content',
    margin: 'auto',
  },
  grid: {
    padding: theme.spacing(2),
  },
  message: {
    marginTop: theme.spacing(2),
    minHeight: theme.spacing(2),
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  button: {
    marginTop: theme.spacing(3),
  },
}));

export default function NewVault() {
  const classes = useStyles();

  const {
    state: {
      vaultCollateral,
      treasury,
      lendingPool,
      collaterals,
      purses,
      vaultConfiguration,
      approved,
      brandToInfo,
    },
    dispatch,
    walletP,
  } = useApplicationContext();

  const [redirect, setRedirect] = useState(
    /** @type { string | false } */ (false),
  );

  if (redirect) {
    return <Redirect to={redirect} />;
  }

  const handleOfferMade = () => {
    dispatch(resetVault());
    setRedirect('/vaults');
  };

  if (!approved) {
    return (
      <Paper className={classes.paper}>
        <div>
          To continue, please approve the VaultFactory Dapp in your wallet.
        </div>
      </Paper>
    );
  }

  const getCurrentVaultCreationStep = () => {

    if (lendingPool) {
      E(lendingPool.publicFacet).helloWorld().then(msg => console.log(msg, 'from LendingPool'));
    }

    if (!vaultCollateral) {
      // User needs to choose which collateral brand to use in their loan
      return (
        <VaultCollateral
          dispatch={dispatch}
          collaterals={collaterals}
          purses={purses}
          brandToInfo={brandToInfo}
        />
      );
    }
    if (!vaultConfiguration) {
      // User needs to configure their vault and choose the amount of
      // debt
      return (
        <VaultConfigure
          dispatch={dispatch}
          vaultCollateral={vaultCollateral}
          purses={purses}
          runBrand={treasury?.runBrand ?? null}
          brandToInfo={brandToInfo}
        />
      );
    }
    // User needs to confirm the vault configuration
    return (
      <VaultCreate
        dispatch={dispatch}
        vaultConfiguration={vaultConfiguration}
        walletP={walletP}
        brandToInfo={brandToInfo}
        onOfferMade={handleOfferMade}
      />
    );
  };

  return (
    <Paper className={classes.paper}>
      <Typography component="h1" variant="h4" align="center">
        Borrow RUN
      </Typography>
      <ErrorBoundary>
        <VaultSteps
          vaultCollateral={vaultCollateral}
          vaultConfiguration={vaultConfiguration}
        />
        {getCurrentVaultCreationStep()}
      </ErrorBoundary>
    </Paper>
  );
}
