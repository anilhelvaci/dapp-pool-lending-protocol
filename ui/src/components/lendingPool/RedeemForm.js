import React, { useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import PurseSelector from './PurseSelector.js';
import Divider from '@material-ui/core/Divider';
import { TextField } from '@material-ui/core';
import { invertRatio, makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import Button from '@material-ui/core/Button';
import { makeNatAmountInput } from '@agoric/ui-components';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { filterPursesByBrand, makeDisplayFunctions, sortPurses } from '../helpers.js';
import { AmountMath } from '@agoric/ertp';
import { floorDivideBy, floorMultiplyBy } from '@agoric/zoe/src/contractSupport/ratio.js';
import { parseAsNat } from '@agoric/ui-components/dist/display/natValue/parseAsNat.js';
import makeRedeemOffer from './offers/makeRedeemOffer.js';
import { setSnackbarState } from '../../store.js';
import { DividerColorPrimary } from './CustomUIComponents.js';

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
  },
  paper: {
    padding: theme.spacing(2),
    textAlign: "center",
    color: theme.palette.text.secondary,
  },
  paddingTopZero: {
    paddingTop: theme.spacing(0),
    // margin: theme.spacing(0),
  },
  paddingTopOne: {
    paddingTop: theme.spacing(1),
  },
  paddingTopTwo: {
    paddingTop: theme.spacing(2),
  },
  marginLeftOne: {
    marginLeft: theme.spacing(1),
  },
  amounts: {
    // backgroundColor: "orange"
  },
}));

const NatAmountInputRedeemUnderlying = makeNatAmountInput({ React, TextField });
const NatAmountInputProtocol = makeNatAmountInput({ React, TextField });

const RedeemForm = ({ market, handleClose }) => {

  const classes = useStyles();

  const {
    state: {
      brandToInfo,
      purses,
      lendingPool: {
        publicFacet: lendingPoolPublicFacet
      }
    },
    walletP,
    dispatch,
  } = useApplicationContext();

  const handleOnProtocolChange = protocolValue => {
    const protocolAmount = AmountMath.make(market.protocolBrand, protocolValue);
    const underlyingAmount = floorMultiplyBy(protocolAmount, market.exchangeRate);
    setProtocolAmount(protocolAmount);
    setUnderlyingAmount(underlyingAmount);
  };

  const handleOnUnderlyingChange = underlyingValue => {
    const underlyingAmount = AmountMath.make(market.underlyingBrand, underlyingValue);
    const protocolAmount = floorDivideBy(underlyingAmount, market.exchangeRate);
    setUnderlyingAmount(underlyingAmount);
    setProtocolAmount(protocolAmount);
  };

  const handleOnSlippageChange = ev => {
    let str = ev.target.value;
    str = str.replace("%", "");
    const numeratorValue = parseAsNat(str);
    setSlippageRatio(makeRatio(numeratorValue, market.underlyingBrand));
  };

  const handleRedeemUnderlying = redeemConfig => {
    makeRedeemOffer(redeemConfig);
    handleClose();
    dispatch(setSnackbarState({open: true, message: 'Please approve redeem offer from your wallet'}))
  };

  if (brandToInfo.length === 0 || !market || !purses || !walletP || !lendingPoolPublicFacet) return null;

  const underlyingPurses = filterPursesByBrand(purses, market.underlyingBrand);
  sortPurses(underlyingPurses);

  const protocolPurses = filterPursesByBrand(purses, market.protocolBrand);
  sortPurses(protocolPurses);

  const [underlyingPurse, setUnderlyingPurse] = useState(
    underlyingPurses.length ? underlyingPurses[0] : null,
  );
  const [protocolPurse, setProtocolPurse] = useState(
    protocolPurses.length ? protocolPurses[0] : null,
  );

  const [underlyingAmount, setUnderlyingAmount] = useState(AmountMath.makeEmpty(market.underlyingBrand));
  const [protocolAmount, setProtocolAmount] = useState(AmountMath.makeEmpty(market.protocolBrand));

  const [slippageRatio, setSlippageRatio] = useState(makeRatio(1n, market.underlyingBrand));

  const {
    getDecimalPlaces,
    displayPercent,
    displayBrandPetname,
    displayRatio
  } = makeDisplayFunctions(brandToInfo);

  const redeemConfig = {
    walletP,
    lendingPoolPublicFacet,
    underlyingPurse,
    protocolPurse,
    underlyingAmount,
    protocolAmount,
    slippageRatio,
  };

  return (
    <div className={classes.root}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography variant="h6" noWrap className={classes.paddingTopOne}>
            Amounts
          </Typography>
        </Grid>
        <Grid item xs={6}>
          <NatAmountInputProtocol
            value={protocolAmount.value}
            onChange={handleOnProtocolChange}
            placesToShow={5}
            decimalPlaces={getDecimalPlaces(market.protocolBrand)}
            label='Protocol Amount'
          />
        </Grid>
        <Grid item xs={2} />
        <Grid item xs={4}>
          <PurseSelector
            purse={protocolPurse}
            purses={protocolPurses}
            setPurse={setProtocolPurse}
            label="From - Protocol Purse"
          />
        </Grid>
        <Grid item xs={6}>
          <NatAmountInputRedeemUnderlying
            value={underlyingAmount.value}
            onChange={handleOnUnderlyingChange}
            placesToShow={5}
            decimalPlaces={getDecimalPlaces(market.underlyingBrand)}
            label='Underlying Amount'
          />
        </Grid>
        <Grid item xs={2} />
        <Grid item xs={4}>
          <PurseSelector
            purse={underlyingPurse}
            purses={underlyingPurses}
            setPurse={setUnderlyingPurse}
            label='To - Underlying Purse'
          />
        </Grid>
        <Grid item xs={12}>
          <DividerColorPrimary variant="fullWidth" />
          <Typography variant="h6" noWrap className={classes.paddingTopOne}>
            Parameters
          </Typography>
        </Grid>
        <Grid item xs={6}>
          <TextField
            id="outlined-basic"
            label="Exchange Rate"
            variant="outlined"
            fullWidth
            value={`1 ${displayBrandPetname(market.underlyingBrand)} = ${displayRatio(invertRatio(market.exchangeRate))} ${displayBrandPetname(market.protocolBrand)}`}
            InputProps={{
              readOnly: true,
            }} />
        </Grid>
        <Grid item xs={3} />
        <Grid item xs={3}>
          <TextField id="outlined-basic" label="Slippage" variant="outlined" onChange={handleOnSlippageChange}
                     value={`${displayPercent(slippageRatio)}%`} />
        </Grid>
        <Grid item xs={12}>
          <DividerColorPrimary variant="fullWidth" />
        </Grid>
        <Grid item xs={12}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={handleClose} color="primary" variant={"outlined"}>
              Cancel
            </Button>
            <Button onClick={() => handleRedeemUnderlying(redeemConfig)} color="primary" variant={"contained"}
                    className={classes.marginLeftOne}>
              Redeem
            </Button>
          </div>
        </Grid>
      </Grid>
    </div>
  )
};

export default RedeemForm;