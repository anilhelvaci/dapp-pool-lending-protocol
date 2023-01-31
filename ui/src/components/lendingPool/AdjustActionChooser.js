import React from 'react';
import {
  Radio,
  RadioGroup,
  Typography,
  FormControlLabel,
  FormControl } from '@material-ui/core';
import { makeStyles } from '@material-ui/styles';

const useStyles = makeStyles(() => ({
  formControlLabel: {
    "& .MuiFormControlLabel-label": {
      fontSize: "14px"
    }
  },
}));

const AdjustActionChooser = ({value, handleChange}) => {
  const classes = useStyles();

  return (
    <FormControl margin='dense' component='fieldset'>
      <RadioGroup row aria-label='gender' name='gender1' value={value} onChange={handleChange}>
        <FormControlLabel className={classes.formControlLabel} value='give' control={<Radio size='small'/>} label='Give' />
        <FormControlLabel className={classes.formControlLabel} value='want' control={<Radio size='small' />} label='Want' />
        <FormControlLabel className={classes.formControlLabel} value='no-action' control={<Radio size='small'/>} label='No Action' />
      </RadioGroup>
    </FormControl>
  );
};

export default AdjustActionChooser;