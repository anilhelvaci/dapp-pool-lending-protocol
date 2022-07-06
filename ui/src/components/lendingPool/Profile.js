import React, { useEffect, useState } from "react";
import { Paper } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { useApplicationContext } from "../../contexts/Application";
import { getTotalBalanceAmount } from "../helpers";
import { E } from '@endo/far';
import Typography from "@material-ui/core/Typography";
import { floorMultiplyBy, getAmountOut } from "@agoric/zoe/src/contractSupport";

const useStyles = makeStyles(() => ({
  test: {
    textAlign: "center",
  },
}));

const Profile = () => {
  const classes = useStyles();

  const {
    state: {
      lendingPool,
      purses,
      approved,
      brandToInfo,
      markets
    },
    dispatch,
    walletP,
  } = useApplicationContext();
  let usdAmount = 0n;

  const [totalPrice, setTotalPrice] = useState("0");

  useEffect(() => {
    const check = async () => {
      for (const market of markets) {
        const totalProtocolAmount = getTotalBalanceAmount(purses, market.protocolBrand);
        const underlyingLocked = floorMultiplyBy(totalProtocolAmount, market.exchangeRate);
        const quote = await E(market.underlyingToThirdPriceAuthority).quoteGiven(underlyingLocked, market.thirdCurrencyBrand);
        const amountOut = getAmountOut(quote);
        usdAmount += amountOut.value;
      }
      console.log("TOTAL USD", usdAmount);
      setTotalPrice(usdAmount.toString());
    }

    if (markets && purses) {
      check().catch(err => {
        console.log("PRICE_PROFILE", err);
        setTotalPrice("-1");
      });
    }
  }, [purses, markets]);

  return (
    <Paper className={classes.test} elevation={4}>
      <h1>This is the profile</h1>
      <h3>Total Value Locked</h3>
      <Typography>${totalPrice}</Typography>
    </Paper>
  );
};

export default Profile;