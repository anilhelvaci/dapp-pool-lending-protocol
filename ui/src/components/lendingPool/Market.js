import React, { useEffect, useState } from 'react';
import { TableCell } from '@material-ui/core';
import { StyledTableRow } from './StyledTableComponents';
import { getTotalBalanceAmount } from '../helpers';
import { useApplicationContext } from '../../contexts/Application';
import { E } from '@endo/far';
import { getAmountOut, floorMultiplyBy, makeRatio } from '@agoric/zoe/src/contractSupport';
import { AmountMath } from '@agoric/ertp';
import { makeAsyncIterableFromNotifier as iterable } from '@agoric/notifier';

let count = 1;

const Market = ({ market, displayFunctions, handleClickOpen }) => {
  console.log('Count', count);
  count++;
  const {
    displayPercent,
    displayBrandPetname,
    displayAmount,
  } = displayFunctions;

  const {
    state: {
      purses,
    },
  } = useApplicationContext();

  const notifier = market.notifier;

  const [valInThird, setValInThird] = useState('0');

  const underlyingAssetPetnameDisplay = displayBrandPetname(market.underlyingBrand);
  const protocolPetnameDisplay = displayBrandPetname(market.protocolBrand);
  const thirdCurrencyPetnameDisplay = displayBrandPetname(market.thirdCurrencyBrand);
  const totalProtocolAmount = getTotalBalanceAmount(purses, market.protocolBrand);
  const underlyingLockedAmount = floorMultiplyBy(totalProtocolAmount, market.exchangeRate);
  const balance = displayAmount(totalProtocolAmount);

  useEffect(() => {
    const fetchQuote = async () => {
      const quote = await E(market.underlyingToThirdPriceAuthority).quoteGiven(underlyingLockedAmount, market.thirdCurrencyBrand);
      const amountOut = getAmountOut(quote);
      const displayVal = displayAmount(amountOut);
      setValInThird(displayVal);
    };

    fetchQuote().catch(err => {
      console.log('PRICE', err);
      setValInThird('-1');
    });
  }, [purses]);

  return (
    <StyledTableRow key={underlyingAssetPetnameDisplay} hover={true} onClick={() => handleClickOpen(market)}>
      <TableCell>{underlyingAssetPetnameDisplay}</TableCell>
      <TableCell align='right'>{displayPercent(market.latestInterestRate, 4)}%</TableCell>
      <TableCell align='right'>{displayPercent(market.exchangeRate, 8)}%</TableCell>
      <TableCell
        align='right'>{balance} {protocolPetnameDisplay} / {valInThird} {thirdCurrencyPetnameDisplay}</TableCell>
    </StyledTableRow>
  );
};

export default Market;