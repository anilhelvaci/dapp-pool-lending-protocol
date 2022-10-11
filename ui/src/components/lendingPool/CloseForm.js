import React, { useState } from 'react';
import Typography from '@material-ui/core/Typography';
import Grid from '@material-ui/core/Grid';
import { DividerColorPrimary } from './CustomUIComponents';
import { TextField } from '@material-ui/core';
import PurseSelector from './PurseSelector.js';
import { makeStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { filterPursesByBrand, makeDisplayFunctions, sortPurses } from '../helpers.js';
import { floorMultiplyBy } from '@agoric/zoe/src/contractSupport/ratio.js';
import makeCloseOffer from './offers/makeCloseOffer.js';
import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math.js';
import { setSnackbarState } from '../../store.js';

const useStyles = makeStyles((theme) => ({
  paddingTopOne: {
    paddingTop: theme.spacing(1),
  },
  marginLeftOne: {
    marginLeft: theme.spacing(1),
  },
}));

const CloseForm = ({ loan, handleClose, debtMarket, collateralUnderlyingMarket, }) => {
  const classes = useStyles();

  const {
    state: {
      purses,
      brandToInfo,
    },
    walletP,
    dispatch,
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !purses || !walletP) return null;

  const {
    debtSnapshot,
    locked,
  } = loan;

  const {
    displayAmount,
  } = makeDisplayFunctions(brandToInfo);

  const debtPurses = filterPursesByBrand(purses, debtMarket.underlyingBrand);
  sortPurses(debtPurses);

  const collateralPurses = filterPursesByBrand(purses, collateralUnderlyingMarket.protocolBrand);
  sortPurses(collateralPurses);

  const [debtPurse, setDebtPurse] = useState(
    debtPurses.length ? debtPurses[0] : null,
  );
  const [collateralPurse, setCollateralPurse] = useState(
    collateralPurses.length ? collateralPurses[0] : null,
  );

  const collateralUnderlyingAmount = floorMultiplyBy(locked, collateralUnderlyingMarket.exchangeRate);
  const currentDebt = calculateCurrentDebt(debtSnapshot.debt, debtSnapshot.interest, debtMarket.compoundedInterest);

  const handleOnClose = () => {
    const closeConfig = harden({
      walletP,
      debtAmount: currentDebt,
      debtPurse,
      collateralAmount: locked,
      collateralPurse,
      loanId: loan.id,
    });

    makeCloseOffer(closeConfig).catch(err => console.log('Error when sending close loan transaction with the config', closeConfig, 'with the error', err));
    handleClose();
    dispatch(setSnackbarState({open: true, message: 'Please approve close loan offer from your wallet'}))
  };

  return (
    <div style={{ flexGrow: 1 }}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography variant='h5' noWrap className={classes.paddingTopOne}>
            Want Collateral
          </Typography>
          <DividerColorPrimary />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='Collateral Amount' variant='outlined'
                     value={displayAmount(locked, 4)} InputProps={{
            readOnly: true,
          }} />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='Collateral Underlying Amount' variant='outlined'
                     value={displayAmount(collateralUnderlyingAmount, 4)} InputProps={{
            readOnly: true,
          }} />
        </Grid>
        <Grid item xs={4}>
          <PurseSelector
            purse={collateralPurse}
            purses={collateralPurses}
            setPurse={setCollateralPurse}
            label='Collateral Purse'
          />
        </Grid>
        <Grid item xs={12}>
          <Typography variant='h5' noWrap className={classes.paddingTopOne}>
            Give Debt
          </Typography>
          <DividerColorPrimary />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='Debt Amount' variant='outlined'
                     value={displayAmount(currentDebt, 4)} InputProps={{
            readOnly: true,
          }} />
        </Grid>
        <Grid item xs={4}>
          <PurseSelector
            purse={debtPurse}
            purses={debtPurses}
            setPurse={setDebtPurse}
            label='Debt Purse'
          />
        </Grid>
        <Grid item xs={12}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={handleClose} color='primary' variant={'outlined'}>
              Cancel
            </Button>
            <Button onClick={handleOnClose} color='primary' variant={'contained'}
                    className={classes.marginLeftOne}>
              Close Loan
            </Button>
          </div>
        </Grid>
      </Grid>
    </div>
  );
};

export default CloseForm;