import React from 'react';
import { TableCell, Typography } from '@material-ui/core';
import { StyledTableRow } from './StyledTableComponents.js';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { makeDisplayFunctions } from '../helpers.js';
import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math.js';
import {
  floorDivideBy,
  floorMultiplyBy, makeRatio,
  makeRatioFromAmounts,
  quantize,
} from '@agoric/zoe/src/contractSupport/ratio.js';
import { AmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier } from '@agoric/notifier';

const LoanItem = ({ loan, handleOpen }) => {

  const {
    state: {
      brandToInfo,
      markets,
      prices
    }
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !markets || !prices) return null;

  const {
    displayAmount,
    displayPercent,
    displayRatio,
    displayBrandPetname,
    computeAmountInCompare,
    computeDebtToAllowedLimitRatio,
  } = makeDisplayFunctions(brandToInfo);

  const {
    principalDebt,
    locked,
    debtSnapshot,
    loanState,
    collateralUnderlyingBrand,
  } = loan;

  if (!debtSnapshot || !locked) return (
    <div>
      <Typography>
        We cannot help you when there is no debtSnaphot or locked collateral
      </Typography>
    </div>
  );

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
  const debtAmountInCompare = computeAmountInCompare(debtToCompareQuote, debtSnapshot.debt);

  const debtToCollateralRatioLimit = computeDebtToAllowedLimitRatio({
    debtAmount: debtSnapshot.debt,
    collateralAmount: locked,
    collateralExchangeRate: collateralUnderlyingMarket.exchangeRate,
    liquidationMargin: underlyingMarket.liquidationMargin,
    prices,
  });

  const currentDebt = calculateCurrentDebt(debtSnapshot.debt, debtSnapshot.interest, underlyingMarket.compoundedInterest);

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
          {displayAmount(debtSnapshot.debt)} {debtPetname}
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