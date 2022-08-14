import React from 'react';
import Radio from '@material-ui/core/Radio';
import RadioGroup from '@material-ui/core/RadioGroup';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import FormControl from '@material-ui/core/FormControl';
import { makeStyles } from '@material-ui/core/styles';
import Typography from '@material-ui/core/Typography';

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