import React from 'react';
import { makeStyles, withStyles } from "@material-ui/core/styles";
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import MuiDialogContent from '@material-ui/core/DialogContent';
import MuiDialogActions from '@material-ui/core/DialogActions';
import MuiDialog from '@material-ui/core/Dialog'
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/Close';
import Typography from '@material-ui/core/Typography';
import PoolTabsLayout from './PoolTabLayout';

const styles = (theme) => ({
  root: {
    margin: 0,
    padding: theme.spacing(2),
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.grey[500],
  }
});

export const useStyles = makeStyles((theme) => ({
  container: {
    '& .MuiDialog-container': {
      '& .MuiDialog-paperWidthSm': {
        maxWidth: 'none',
        width: '60%',
      }
    }
  },
  marginTop: {
    marginTop: theme.spacing(2),
  }
}));

export const DialogTitle = withStyles(styles)((props) => {
  const { children, classes, onClose, ...other } = props;
  return (
    <MuiDialogTitle disableTypography className={classes.root} {...other}>
      <Typography variant='h6'>{children}</Typography>
      {onClose ? (
        <IconButton aria-label='close' className={classes.closeButton} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      ) : null}
    </MuiDialogTitle>
  );
});

export const DialogContent = withStyles((theme) => ({
  root: {
    padding: theme.spacing(2),
  },
}))(MuiDialogContent);

const PoolDialog = ({ open, handleClose, name, market, displayFunctions }) => {
  console.log('name', name);
  const classes = useStyles();
  if (!market) {
    return null;
  }

  const {
    displayBrandPetname,
  } = displayFunctions;

  return (
    <div>
      <Dialog className={classes.container} onClose={handleClose} aria-labelledby='customized-dialog-title' open={open}>
        <DialogTitle id='customized-dialog-title' onClose={handleClose}>
          {displayBrandPetname(market.underlyingBrand)}
        </DialogTitle>
        <DialogContent dividers>
          <PoolTabsLayout market={market} handleClose={handleClose}/>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PoolDialog;