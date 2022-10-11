import React from 'react';

import { TextField, MenuItem } from '@material-ui/core';

import { displayPetname } from '../helpers';

const PurseSelector = ({ purses, purse, setPurse, label, isDisabled }) => (
  <TextField
    variant="outlined"
    required
    label={label}
    select
    fullWidth
    disabled={isDisabled}
    value={purse ? JSON.stringify(purse.pursePetname) : ''}
  >
    {purses.map(purse => (
      <MenuItem
        key={JSON.stringify(purse.pursePetname)}
        value={JSON.stringify(purse.pursePetname)}
        onClick={() => setPurse(purse)} // needs to set as purse and not petname
      >
        {displayPetname(purse.pursePetname)}
      </MenuItem>
    ))}
  </TextField>
);
export default PurseSelector;