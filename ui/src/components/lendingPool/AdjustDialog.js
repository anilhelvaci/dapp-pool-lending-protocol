import React from 'react';
import Dialog from '@material-ui/core/Dialog';
import { DialogContent, DialogTitle, useStyles } from './Dialog.js';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { makeDisplayFunctions } from '../helpers.js';
import { Typography } from '@material-ui/core';
import AdjustForm from './AdjustForm.js';

const AdjustDialog = ({ open, handleClose, loan }) => {

  const classes = useStyles();

  const {
    state: {
      brandToInfo
    }
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !loan) return null;

  return (
    <div>
      <Dialog className={classes.container} onClose={handleClose} aria-labelledby='customized-dialog-title' open={open}>
        <DialogTitle id='customized-dialog-title' onClose={handleClose}>
          Ajust Loan
        </DialogTitle>
        <DialogContent dividers>
          <AdjustForm loan={loan} handleClose={handleClose}/>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdjustDialog;