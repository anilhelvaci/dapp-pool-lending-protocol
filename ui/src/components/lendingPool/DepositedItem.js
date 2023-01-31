import React from 'react';
import { StyledTableRow } from './StyledTableComponents.js';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { TableCell, Typography } from '@material-ui/core';
import { filterPursesByBrand, makeDisplayFunctions } from '../helpers.js';
import { AmountMath } from '@agoric/ertp';
import { floorMultiplyBy } from '@agoric/zoe/src/contractSupport/ratio.js';

const getProtocolBalance = (purses, protocolBrand) => {
  let protocolValue = 0n;
  const protocolPurses = filterPursesByBrand(purses, protocolBrand);
  protocolPurses.forEach(purse => protocolValue += purse.currentAmount.value);
  return AmountMath.make(protocolBrand, protocolValue);
};

const DepositedItem = ({ market, priceQuote, handleOpen }) => {

  const {
    state: {
      brandToInfo,
      purses,
    }
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !purses || !priceQuote || !market) return null;

  const {
    displayBrandPetname,
    displayAmount,
    computeAmountInCompare,
  } = makeDisplayFunctions(brandToInfo);

  const underlyingPetname = displayBrandPetname(market.underlyingBrand);
  const protocolPetname = displayBrandPetname(market.protocolBrand);
  const compareCurrencyPetname = displayBrandPetname(market.thirdCurrencyBrand);

  const protocolBalanceAmount = getProtocolBalance(purses, market.protocolBrand);
  const underlyingAmount = floorMultiplyBy(protocolBalanceAmount, market.exchangeRate);
  const underlyingInCompareAmount = computeAmountInCompare(priceQuote, underlyingAmount);

  return (
    <StyledTableRow key={underlyingPetname} hover={true} onClick={() => handleOpen(market)}>
      <TableCell>{underlyingPetname}</TableCell>
      <TableCell align={'right'}>{displayAmount(protocolBalanceAmount)} {protocolPetname}</TableCell>
      <TableCell align={'right'}>
        <Typography variant={'body2'}>
          {displayAmount(underlyingInCompareAmount)} {compareCurrencyPetname}
        </Typography>
        <Typography variant={'caption'}>
          {displayAmount(underlyingAmount, 6 )} {underlyingPetname}
        </Typography>
      </TableCell>
    </StyledTableRow>
  )
};

export default DepositedItem;