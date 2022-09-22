import Dialog from '@material-ui/core/Dialog';
import React from 'react';
import { DialogContent, DialogTitle, useStyles } from './Dialog.js';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { makeDisplayFunctions } from '../helpers.js';
import { Typography } from '@material-ui/core';
import RedeemForm from './RedeemForm.js';

const RedeemDialog = ({ open, handleClose, market }) => {

  const classes = useStyles();

  const {
    state: {
      brandToInfo
    }
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !market) return null;

  const {
    displayBrandPetname,
  } = makeDisplayFunctions(brandToInfo);

  return (
    <div>
      <Dialog className={classes.container} onClose={handleClose} aria-labelledby='customized-dialog-title' open={open}>
        <DialogTitle id='customized-dialog-title' onClose={handleClose}>
          Redeem Your {displayBrandPetname(market.underlyingBrand)}
        </DialogTitle>
        <DialogContent dividers>
          <RedeemForm market={market} handleClose={handleClose}/>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RedeemDialog;