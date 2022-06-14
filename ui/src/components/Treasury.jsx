import React, { useState } from 'react';

import { Redirect } from 'react-router-dom';

import { makeStyles } from '@material-ui/core/styles';

import Paper from '@material-ui/core/Paper';
import Card from '@material-ui/core/Card';
import CardActions from '@material-ui/core/CardActions';
import CardContent from '@material-ui/core/CardContent';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import Alert from '@material-ui/lab/Alert';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import FormGroup from '@material-ui/core/FormGroup';
import Checkbox from '@material-ui/core/Checkbox';

import { CircularProgress, Typography } from '@material-ui/core';
import { useApplicationContext } from '../contexts/Application';

import { VaultSummary } from './VaultSummary';
import ErrorBoundary from './ErrorBoundary';

import { setVaultToManageId, setLoadTreasuryError } from '../store';
import { VaultStatus } from '../constants';

const cardWidth = 360;
const cardPadding = 16;
const cardHeight = 464;

const useStyles = makeStyles(theme => {
  return {
    root: {
      width: 'fit-content',
      margin: 'auto',
    },
    content: {
      marginTop: 16,
    },
    paper: {
      marginTop: theme.spacing(3),
      marginBottom: theme.spacing(3),
      padding: theme.spacing(2),
      [theme.breakpoints.up(600 + theme.spacing(3) * 2)]: {
        marginTop: theme.spacing(6),
        marginBottom: theme.spacing(6),
        padding: theme.spacing(3),
      },
    },
    gridCard: {
      paddingLeft: cardPadding,
      marginBottom: cardPadding,
    },
    card: {
      width: cardWidth,
      minHeight: cardHeight,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      borderRadius: '16px',
      boxShadow: '0 1px 3px 0 rgb(0 0 0 / 20%)',
    },
    loading: {
      padding: theme.spacing(3),
      marginTop: theme.spacing(2),
    },
    grid: {
      margin: 'auto',
      marginTop: theme.spacing(2),
      maxWidth: cardWidth + cardPadding,
      justifyContent: 'flex-start',
      '@media (min-width: 1025px)': {
        maxWidth: 2 * (cardWidth + cardPadding),
        '&__contents-1': {
          maxWidth: cardWidth + cardPadding,
        },
      },
      '@media (min-width: 1401px)': {
        maxWidth: 3 * (cardWidth + cardPadding),
        '&__contents-1': {
          maxWidth: 1 * (cardWidth + cardPadding),
        },
        '&__contents-2': {
          maxWidth: 2 * (cardWidth + cardPadding),
        },
      },
      '@media (min-width: 1777px)': {
        maxWidth: 4 * (cardWidth + cardPadding),
        '&__contents-1': {
          maxWidth: 1 * (cardWidth + cardPadding),
        },
        '&__contents-2': {
          maxWidth: 2 * (cardWidth + cardPadding),
        },
        '&__contents-3': {
          maxWidth: 3 * (cardWidth + cardPadding),
        },
      },
    },
    button: {
      marginRight: theme.spacing(1),
      marginBottom: theme.spacing(1),
    },
    showClosedToggle: {
      paddingLeft: theme.spacing(4),
      width: 'fit-content',
    },
  };
});

function VaultList() {
  const classes = useStyles();
  const {
    state: { approved, vaults, brandToInfo, loadTreasuryError, treasury },
    dispatch,
    retrySetup,
  } = useApplicationContext();

  const vaultsList = Object.entries(vaults ?? {});

  const showShowClosedToggle =
    (vaultsList?.find(entry =>
      [VaultStatus.CLOSED, VaultStatus.ERROR].includes(entry[1].status),
    )?.length ?? 0) > 0;

  const [showClosed, setShowClosed] = useState(false);

  const vaultsToRender = vaultsList.filter(([_key, { status }]) =>
    showClosed
      ? [VaultStatus.CLOSED, VaultStatus.ERROR].includes(status)
      : ![VaultStatus.CLOSED, VaultStatus.ERROR, VaultStatus.DECLINED].includes(
          status,
        ),
  );

  const [redirect, setRedirect] = useState(false);

  const handleOnClick = key => {
    dispatch(setVaultToManageId(key));
    setRedirect('/manageVault');
  };

  const onRetryClicked = () => {
    dispatch(setLoadTreasuryError(null));
    retrySetup();
  };

  const onShowClosedToggled = e => {
    const value = e.target.checked;
    setShowClosed(value);
  };

  const loadTreasuryErrorAlert = (
    <div className={classes.root}>
      <Paper className={classes.paper}>
        <Alert
          action={
            <Button onClick={onRetryClicked} color="inherit" size="small">
              Retry
            </Button>
          }
          severity="error"
        >
          A problem occured while loading your vaults — make sure you have RUN
          in your Zoe fees purse.
        </Alert>
      </Paper>
    </div>
  );

  if (redirect) {
    return <Redirect to={redirect} />;
  }

  if (!approved) {
    return (
      <div className={classes.root}>
        <Paper className={classes.paper}>
          <div>
            To continue, please approve the VaultFactory Dapp in your wallet.
          </div>
        </Paper>
      </div>
    );
  }

  if (loadTreasuryError) {
    return loadTreasuryErrorAlert;
  }

  if (vaults === null || !treasury) {
    return (
      <div className={classes.root}>
        <CircularProgress style={{ marginTop: 48 }} />
      </div>
    );
  }

  const showClosedToggle = (
    <FormGroup className={classes.showClosedToggle}>
      <FormControlLabel
        control={
          <Checkbox
            color="primary"
            onChange={onShowClosedToggled}
            checked={showClosed}
          />
        }
        label="Show closed vaults"
      />
    </FormGroup>
  );

  if (vaultsToRender.length === 0) {
    return (
      <div className={classes.content}>
        {showShowClosedToggle && showClosedToggle}
        <div className={classes.root}>
          <Paper className={classes.loading}>
            <Typography>No vaults available yet</Typography>
          </Paper>
        </div>
      </div>
    );
  }

  return (
    <div className={classes.content}>
      {showShowClosedToggle && showClosedToggle}
      <ErrorBoundary>
        <Grid
          container
          className={`${classes.grid} ${classes.grid}__contents-${vaultsToRender?.length}`}
          alignItems="stretch"
        >
          {vaultsToRender.map(([key, v]) => {
            const canManage = v.status === 'Loan Initiated';
            return (
              <Grid item key={key} className={classes.gridCard}>
                <Card key={key} className={classes.card}>
                  <CardContent>
                    <VaultSummary
                      vault={v}
                      id={key}
                      brandToInfo={brandToInfo}
                    ></VaultSummary>
                  </CardContent>
                  <CardActions>
                    <Grid container justify="flex-end">
                      <Grid item className={classes.button}>
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => handleOnClick(key)}
                          disabled={!canManage}
                        >
                          Manage Vault
                        </Button>
                      </Grid>
                    </Grid>
                  </CardActions>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      </ErrorBoundary>
    </div>
  );
}

export default VaultList;
