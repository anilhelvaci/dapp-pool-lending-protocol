import React from 'react';
import { TableCell, Typography } from '@material-ui/core';
import { StyledTableRow } from './StyledTableComponents.js';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { makeDisplayFunctions } from '../helpers.js';
import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math.js';
import {
  floorMultiplyBy,
} from '@agoric/zoe/src/contractSupport/ratio.js';
import AppProgressBar from './AppProgressBar.js';

const LoanItem = ({ loan, handleOpen }) => {

  const {
    state: {
      brandToInfo,
      markets,
      prices
    }
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !markets || !prices) return (
    <AppProgressBar/>
  );

  const {
    displayAmount,
    displayPercent,
    displayBrandPetname,
    computeAmountInCompare,
    computeDebtToAllowedLimitRatio,
  } = makeDisplayFunctions(brandToInfo);

  const {
    locked,
    debtSnapshot,
    loanState,
    collateralUnderlyingBrand,
  } = loan;

  console.log('[LOAN_ITEM] LoanState', loanState);
  if (loanState !== 'active') return null;

  const debtBrand = debtSnapshot.debt.brand;
  const collateralBrand = locked.brand;

  const underlyingMarket = markets[debtBrand];
  const collateralUnderlyingMarket = markets[collateralUnderlyingBrand];
  const debtToCompareQuote = prices[debtBrand];
  const collateralToCompareQuote = prices[collateralUnderlyingBrand];

  const compareCurrencyPetname = displayBrandPetname(underlyingMarket.thirdCurrencyBrand);
  const debtPetname = displayBrandPetname(debtBrand);
  const collateralPetname = displayBrandPetname(collateralBrand);

  const collateralAmountInCompare = computeAmountInCompare(collateralToCompareQuote,
    floorMultiplyBy(locked, collateralUnderlyingMarket.exchangeRate));
  const currentDebt = calculateCurrentDebt(debtSnapshot.debt, debtSnapshot.interest, underlyingMarket.compoundedInterest);
  const debtAmountInCompare = computeAmountInCompare(debtToCompareQuote, currentDebt);

  const debtToCollateralRatioLimit = computeDebtToAllowedLimitRatio({
    debtAmount: debtSnapshot.debt,
    collateralAmount: locked,
    collateralExchangeRate: collateralUnderlyingMarket.exchangeRate,
    liquidationMargin: underlyingMarket.liquidationMargin,
    prices,
  });

  const loanMetadata = {
    loan,
    debtMarket: underlyingMarket,
    collateralUnderlyingMarket,
    debtToCollateralRatioLimit
  };

  return (
    <StyledTableRow key={debtPetname} hover={true} onClick={() => handleOpen(loanMetadata)}>
      {/* Debt Asset */}
      <TableCell>{debtPetname}</TableCell>
      {/*Collateral Locked*/}
      <TableCell align={'right'}>
        <Typography variant={'body2'}>
          {displayAmount(collateralAmountInCompare)} {compareCurrencyPetname}
        </Typography>
        <Typography variant={'caption'}>
          {displayAmount(locked)} {collateralPetname}
        </Typography>
      </TableCell>
      {/*Borrow Balance*/}
      <TableCell align={'right'}>
        <Typography variant={'body2'}>
          {displayAmount(debtAmountInCompare)} {compareCurrencyPetname}
        </Typography>
        <Typography variant={'caption'}>
          {displayAmount(currentDebt)} {debtPetname}
        </Typography>
      </TableCell>
      {/*State*/}
      <TableCell align={'right'}>{loanState}</TableCell>
      {/* % Of Limit */}
      <TableCell align={'right'}>%{displayPercent(debtToCollateralRatioLimit)}</TableCell>
    </StyledTableRow>
  )
};

export default LoanItem;