import React, { useEffect, useState } from 'react';
import { Paper } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { useApplicationContext } from '../../contexts/Application';
import { getTotalBalanceAmount, makeDisplayFunctions } from '../helpers';
import { E } from '@endo/far';
import Typography from '@material-ui/core/Typography';
import { floorMultiplyBy, getAmountOut } from '@agoric/zoe/src/contractSupport';
import { AmountMath } from '@agoric/ertp';

const useStyles = makeStyles(() => ({
  test: {
    textAlign: 'center',
  },
}));

const Profile = () => {
  const classes = useStyles();

  const {
    state: {
      purses,
      brandToInfo,
      markets,
    },
  } = useApplicationContext();
  let usdAmount = 0n;

  const [totalPrice, setTotalPrice] = useState('0');

  useEffect(() => {
    const check = async () => {
      for (const market of Object.values(markets)) {
        const totalProtocolAmount = getTotalBalanceAmount(purses, market.protocolBrand);
        const underlyingLocked = floorMultiplyBy(totalProtocolAmount, market.exchangeRate);
        const quote = await E(market.underlyingToThirdWrappedPriceAuthority.priceAuthority).quoteGiven(underlyingLocked, market.thirdCurrencyBrand);
        const amountOut = getAmountOut(quote);
        usdAmount += amountOut.value;
      }
      console.log('TOTAL USD', usdAmount);
      setTotalPrice(displayAmount(AmountMath.make(Object.values(markets)[0].thirdCurrencyBrand, usdAmount)));
    };

    if (markets && purses) {
      check().catch(err => {
        console.log('PRICE_PROFILE', err);
        setTotalPrice('-1');
      });
    }
  }, [purses, markets]);

  if (!(brandToInfo.length > 0 )) return (
    <>
      <Typography>
        Loading...
    </Typography>
      </>
  );

  const {
    displayAmount
  } = makeDisplayFunctions(brandToInfo);

  return (
    <Paper className={classes.test} elevation={4}>
      <h1>This is the profile</h1>
      <h3>Total Value Locked</h3>
      <Typography>${totalPrice}</Typography>
    </Paper>
  );
};

export default Profile;