import React, { useState } from 'react';
import { DialogContent, DialogTitle, useStyles } from './Dialog.js';
import { Dialog } from '@material-ui/core';
import LoanManagementTabLayout from './LoanManagementTabLayout.js';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { makeDisplayFunctions } from '../helpers.js';

const LoanManagementDialog = ({ open, handleClose, loanMetadata }) => {
  const classes = useStyles();

  const {
    state: {
      brandToInfo,
    }
  } = useApplicationContext();

  const {
    loan,
    debtMarket,
    collateralUnderlyingMarket,
    debtToCollateralRatioLimit,
  } = loanMetadata;

  if (!loan || !debtMarket || !collateralUnderlyingMarket || !debtToCollateralRatioLimit) return null;

  const {
    displayBrandPetname,
  } = makeDisplayFunctions(brandToInfo);

  const getTitle = () => {
    const { debtSnapshot } = loan;
    if (!debtSnapshot) return 'Adjust Your Loan';
    const petname = displayBrandPetname(debtSnapshot.debt.brand);
    return `Adjust Your ${petname} Loan`;
  };

  return (
    <div>
      <Dialog className={classes.container} onClose={handleClose} aria-labelledby='customized-dialog-title' open={open}>
        <DialogTitle id='customized-dialog-title' onClose={handleClose}>
          {getTitle()}
        </DialogTitle>
        <DialogContent dividers>
          <LoanManagementTabLayout className={classes.marginTop} loanMetadata={loanMetadata} handleClose={handleClose}/>
        </DialogContent>
      </Dialog>
    </div>
  )
};

export default LoanManagementDialog;