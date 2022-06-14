import React, { useState } from 'react';

import { makeStyles, withStyles } from '@material-ui/core/styles';
import InputBase from '@material-ui/core/InputBase';
import TextField from '@material-ui/core/TextField';
import MenuItem from '@material-ui/core/MenuItem';
import FormControl from '@material-ui/core/FormControl';
import Select from '@material-ui/core/Select';
import InputAdornment from '@material-ui/core/InputAdornment';
import ToggleButton from '@material-ui/lab/ToggleButton';
import { parseAsValue, stringifyValue } from '@agoric/ui-components';
import { AssetKind } from '@agoric/ertp';
import { getInfoForBrand } from '../helpers';

const useStyles = makeStyles(_theme => ({
  root: {
    margin: 'auto',
  },
  maxButton: {
    border: 'none',
    height: 36,
  },
  infoTop: {
    fontSize: 14,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    color: 'rgb(112, 112, 112)',
    padding: '0 4px',
  },
  icon: {
    height: 42,
    width: 42,
  },
  input: {
    width: '100%',
  },
}));

const StyledSelect = withStyles(theme => ({
  input: {
    borderRadius: 4,
    border: 'none',
    color: 'rgb(112, 112, 112)',
    fontSize: 14,
    padding: '4px 0',
    transition: theme.transitions.create(['border-color', 'box-shadow']),
    '&:focus': {
      backgroundColor: 'inherit',
    },
  },
}))(InputBase);

const NatPurseAmountInput = ({
  purses,
  selectedPurse,
  onPurseChange,
  onAmountChange,
  brandToFilter,
  brandToInfo,
  iconSrc,
  onUseMaxChange,
  useMax = false,
  showPurseSelector = true,
  amount = null,
}) => {
  const classes = useStyles();

  const decimalPlaces = getInfoForBrand(brandToInfo, brandToFilter)
    .decimalPlaces;

  const amountString = stringifyValue(amount, AssetKind.NAT, decimalPlaces);
  const [fieldString, setFieldString] = useState(
    amount === null ? '0' : amountString,
  );

  const handlePurseChange = event => {
    const newPurse = purses.find(p => p.pursePetname === event.target.value);
    onPurseChange(newPurse);
  };

  const handleAmountChange = ev => {
    const str = ev.target.value.replace('-', ''); // Show the user exactly what they are typing
    setFieldString(str);
    const parsed = parseAsValue(str, AssetKind.NAT, decimalPlaces);
    onAmountChange(parsed);
  };

  const displayString =
    amount === parseAsValue(fieldString, AssetKind.NAT, decimalPlaces)
      ? fieldString
      : amountString;

  const purseBalance =
    selectedPurse &&
    stringifyValue(selectedPurse?.value ?? 0n, AssetKind.NAT, decimalPlaces);

  return (
    <div className={classes.root}>
      {showPurseSelector && (
        <div className={classes.infoTop}>
          <div className={classes.purseSelector}>
            <FormControl>
              <Select
                value={selectedPurse?.pursePetname}
                onChange={handlePurseChange}
                input={<StyledSelect />}
              >
                {purses.map(p => (
                  <MenuItem key={p?.pursePetname} value={p?.pursePetname}>
                    {p?.pursePetname}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
          <div className={classes.purseBalance}>
            Balance:{' '}
            {`${purseBalance ?? '0'} ${selectedPurse?.brandPetname ?? ''}`}
          </div>
        </div>
      )}
      <TextField
        value={displayString}
        type="number"
        inputMode="decimal"
        onChange={handleAmountChange}
        onKeyDown={() => {
          onUseMaxChange(false);
        }}
        variant="outlined"
        className={classes.input}
        placeholder="Amount"
        InputProps={{
          'aria-label': 'Amount',
          inputProps: {
            min: 0,
          },
          startAdornment: (
            <InputAdornment position="start">
              {iconSrc && <img className={classes.icon} src={iconSrc} />}
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end">
              <ToggleButton
                color="primary"
                value="max"
                className={classes.maxButton}
                selected={useMax}
                onChange={() => {
                  onUseMaxChange(!useMax);
                }}
              >
                Max
              </ToggleButton>
            </InputAdornment>
          ),
        }}
      />
    </div>
  );
};

export default NatPurseAmountInput;
