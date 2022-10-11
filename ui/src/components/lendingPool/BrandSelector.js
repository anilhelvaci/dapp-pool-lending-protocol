import React from 'react';
import { TextField, MenuItem } from '@material-ui/core';

const BrandSelector = ({ brands, setBrand, label, displayBrandPetname, brand }) => (
  <TextField
    variant="outlined"
    required
    value={brand ? displayBrandPetname(brand) : ''}
    label={label}
    select
    fullWidth
  >
    {brands.map(brand => (
      <MenuItem
        key={displayBrandPetname(brand)}
        value={displayBrandPetname(brand)}
        onClick={() => setBrand(brand)} // needs to set as purse and not petname
      >
        {displayBrandPetname(brand)}
      </MenuItem>
    ))}
  </TextField>
);
export default BrandSelector;