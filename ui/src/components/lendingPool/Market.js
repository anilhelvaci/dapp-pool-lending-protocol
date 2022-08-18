import React, { useEffect, useState } from 'react';
import { TableCell, Typography } from '@material-ui/core';
import { StyledTableRow } from './StyledTableComponents';
import {
  getAmountOut,
  ceilMultiplyBy,
  makeRatioFromAmounts,
} from '@agoric/zoe/src/contractSupport';
import { AmountMath } from '@agoric/ertp';
import { Nat } from '@endo/nat';
import { makeDisplayFunctions } from '../helpers.js';

let count = 1;

const Market = ({ market, brandToInfo, handleClickOpen, priceQuote }) => {
  console.log('Count', count);
  count++;
  const {
    displayPercent,
    displayBrandPetname,
    displayAmount,
    getDecimalPlaces,
  } = makeDisplayFunctions(brandToInfo);

  const underlyingAssetPetnameDisplay = displayBrandPetname(market.underlyingBrand);
  const compareAssetPetnameDisplay = displayBrandPetname(market.thirdCurrencyBrand);
  const protocolTokenPetnameDisplay = displayBrandPetname(market.protocolBrand);

  const underlyingAmountOut = priceQuote === undefined ? AmountMath.makeEmpty(market.thirdCurrencyBrand) : getAmountOut(priceQuote);
  const underlyingLiqInCompare = ceilMultiplyBy(
    market.underlyingLiquidity,
    makeRatioFromAmounts(underlyingAmountOut,
      AmountMath.make(market.underlyingBrand, 10n ** Nat(getDecimalPlaces(market.underlyingBrand))))
  );

  const totalDebtInCompare = ceilMultiplyBy(
    market.totalDebt,
    makeRatioFromAmounts(underlyingAmountOut,
      AmountMath.make(market.underlyingBrand, 10n ** Nat(getDecimalPlaces(market.underlyingBrand))))
  );

  return (
    <StyledTableRow key={underlyingAssetPetnameDisplay} hover={true} onClick={() => handleClickOpen(market)}>
      {/* Asset */}
      <TableCell  >{underlyingAssetPetnameDisplay} </TableCell>
      {/* Total Supply */}
      <TableCell align='right'>
        <Typography variant={'body2'}>
          {displayAmount(underlyingLiqInCompare)} {compareAssetPetnameDisplay}
        </Typography>
        <Typography variant={'caption'}>
          {displayAmount(market.underlyingLiquidity)} {underlyingAssetPetnameDisplay}
        </Typography>
      </TableCell>
      {/* Total Protocol Supply */}
      <TableCell align='right'>{displayAmount(market.protocolLiquidity)} {protocolTokenPetnameDisplay}</TableCell>
      {/* Total Borrow */}
      <TableCell align='right'>
        <Typography variant={'body2'}>
          {displayAmount(totalDebtInCompare)} {compareAssetPetnameDisplay}
        </Typography>
        <Typography variant={'caption'}>
          {displayAmount(market.totalDebt, 6)} {underlyingAssetPetnameDisplay}
        </Typography>
      </TableCell>
      {/* APY */}
      <TableCell align='right'>{displayPercent(market.latestInterestRate, 4)}%</TableCell>
      {/* Exchange Rate */}
      <TableCell align='right'>{displayPercent(market.exchangeRate, 8)}% </TableCell>
      {/* MMR */}
      <TableCell align='right'>{displayPercent(market.liquidationMargin)}% </TableCell>
    </StyledTableRow>
  );
};

export default Market;