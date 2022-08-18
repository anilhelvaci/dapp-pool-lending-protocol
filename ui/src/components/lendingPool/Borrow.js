import React, { useState } from "react";
import { useApplicationContext } from "../../contexts/Application";
import { filterProtocolPurses, filterPursesByBrand, makeDisplayFunctions, sortPurses } from '../helpers';
import { makeNatAmountInput } from "@agoric/ui-components";
import { TextField } from "@material-ui/core";
import PurseSelector from "./PurseSelector";
import { AmountMath } from "@agoric/ertp";
import { makeStyles, withStyles } from '@material-ui/core/styles';
import Divider from "@material-ui/core/Divider";
import Grid from "@material-ui/core/Grid";
import { floorDivideBy, floorMultiplyBy, invertRatio } from "@agoric/zoe/src/contractSupport/ratio.js";
import Typography from "@material-ui/core/Typography";
import Button from "@material-ui/core/Button";
import BrandSelector from './BrandSelector.js';
import { Nat } from '@endo/nat';
import makeBorrowOffer from './offers/makeBorrowOffer.js';
import { createLoan, setSnackbarState } from '../../store.js';
import { LoanStatus, VaultStatus } from '../../constants.js';

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

const NatAmountInputSupply = makeNatAmountInput({ React, TextField });
const NatAmountInputProtocol = makeNatAmountInput({ React, TextField });

const PriceTextField = withStyles((theme) => ({
  root: {
    pointerEvents: 'none',
    '& label': {
      color: theme.palette.primary.main,
    },
    '& .MuiOutlinedInput-root': {
      '& fieldset': {
        borderColor: theme.palette.primary.main,

      }
    },
  },
}))(TextField);

const Borrow = ({ market, handleClose }) => {

  const {
    state: {
      brandToInfo,
      purses,
      prices,
      markets,
      lendingPool: {
        publicFacet: lendingPoolPublicFacet
      },
    },
    walletP,
    dispatch
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !market || !purses || !walletP || !lendingPoolPublicFacet || !prices || !markets || !dispatch) return null;

  const classes = useStyles();

  const toAmount = (brand, value) => {
    if (!brand) return undefined;
    return AmountMath.make(brand, Nat(value));
  };

  const fromCollateralUnderlying = collateralUnderlyingAmount => {
    const collateralUnderlyingMarket = markets[collateralUnderlyingAmount.brand];
    const collateralUnderlyingExchangeRate = collateralUnderlyingMarket.exchangeRate;
    return floorDivideBy(collateralUnderlyingAmount, collateralUnderlyingExchangeRate);
  };

  const debt = value => {
    return AmountMath.make(market.underlyingBrand, Nat(value));
  }

  const computeCollateralUnderlying = collateralAmount => {
    const collateralUnderlyingMarket = markets[collateralUnderlyingBrand];
    return floorMultiplyBy(collateralAmount, collateralUnderlyingMarket.exchangeRate);
  };

  const {
    displayBrandPetname,
    displayAmount,
    displayRatio,
    getDecimalPlaces,
    computeAmountInCompare,
    displayPrice,
  } = makeDisplayFunctions(brandToInfo);

  const underlyingPetname = displayBrandPetname(market.underlyingBrand);
  const protocolPetname = displayBrandPetname(market.protocolBrand);
  const comparePetname = displayBrandPetname(market.thirdCurrencyBrand);

  const debtPurses = filterPursesByBrand(purses, market.underlyingBrand);
  sortPurses(debtPurses);

  const protocolPurses = filterProtocolPurses(purses);
  sortPurses(protocolPurses);

  const getCollateralBrands = () => {
    const filtered = Object.values(markets).filter(iteratingMarket => iteratingMarket.brand !== market.underlyingBrand);
    return filtered.map(filteredMarket => filteredMarket.brand);
  }

  const [debtPurse, setDebtPurse] = useState(
    debtPurses.length ? debtPurses[0] : null,
  );

  const [collateralPurses, setCollateralPurses] = useState([]);
  const [collateralPurse, setCollateralPurse] = useState(
    protocolPurses.length ? protocolPurses[0] : null,
  );

  const [collateralUnderlyingBrand, setCollateralUnderlyingBrand] = useState(null);
  const [collateralBrand, setCollateralBrand] = useState(null,);
  const [debtValueInCompare, setDebtValueInCompare] = useState(AmountMath.makeEmpty(market.thirdCurrencyBrand));
  const [collateralValueInCompare, setCollateralValueInCompare] = useState(AmountMath.makeEmpty(market.thirdCurrencyBrand));
  const [debtAmount, setDebtAmount] = useState(AmountMath.makeEmpty(market.underlyingBrand));
  const [collateralValue, setCollateralValue] = useState(BigInt(0));
  const [collateralInputDisabled, setCollateralInputDisabled] = useState(true);
  const [collateralUnderlyingValue, setCollateralUnderlyingValue] = useState(BigInt(0));

  const onCollateralChange = collateralValue => {
    const collateralAmount = toAmount(collateralBrand, collateralValue);
    const collateralUnderlyingAmount = computeCollateralUnderlying(collateralAmount);
    setCollateralValue(collateralValue);
    setCollateralUnderlyingValue(collateralUnderlyingAmount.value);
    setMaxDebt(collateralUnderlyingAmount);
  };

  const onCollateralUnderlyingBrandChange = (brand) => {
    const collateralUnderlyingMarket = markets[brand];
    setCollateralUnderlyingBrand(brand);
    setCollateralInputDisabled(false);
    setCollateralBrand(collateralUnderlyingMarket.protocolBrand);
    const collateralPurses = filterPursesByBrand(purses, collateralUnderlyingMarket.protocolBrand);
    sortPurses(collateralPurses);
    setCollateralPurses(collateralPurses);
    setCollateralPurse(collateralPurses.length ? collateralPurses[0] : null);
  };

  const onCollateralUnderlyingChange = collateralUnderlyingValue => {
    const collateralUnderlyingAmount = toAmount(collateralUnderlyingBrand, collateralUnderlyingValue);
    const collateralAmount = fromCollateralUnderlying(collateralUnderlyingAmount)
    setCollateralValue(collateralAmount.value);
    setCollateralUnderlyingValue(collateralUnderlyingValue);
    setMaxDebt(collateralUnderlyingAmount);
  };

  const onDebtChange = debtValue => {
    const debtAmount = debt(debtValue);
    setDebtAmount(debtAmount);
    setRequestedDebt(debtAmount);
  };

  const setMaxDebt = amountIn => {
    const quote = prices[amountIn.brand];
    const amountInCompare = computeAmountInCompare(quote, amountIn)
    setCollateralValueInCompare(floorDivideBy(amountInCompare, market.liquidationMargin));
  };

  const setRequestedDebt = amountIn => {
    const quote = prices[amountIn.brand];
    setDebtValueInCompare(computeAmountInCompare(quote, amountIn));
  };

  const borrowConfig = {
    id: `${Date.now()}`,
    walletP,
    lendingPoolPublicFacet,
    collateralPurse,
    debtPurse,
    collateralAmount: collateralBrand ? AmountMath.make(collateralBrand, collateralValue) : undefined,
    debtAmount,
    collateralUnderlyingBrand : collateralUnderlyingBrand ? collateralUnderlyingBrand : undefined,
  };

  const handleSupplyAsset = () => {
    handleClose();
  };

  const handleBorrow = () => {
    makeBorrowOffer(borrowConfig);
    dispatch(createLoan({
      id: borrowConfig.id,
      loan: {
        principalDebt: borrowConfig.debtAmount,
        locked: borrowConfig.collateralAmount,
        liquidationRatio: market.liquidationRatio,
        loanState: LoanStatus.PENDING,
      },
    }));
    handleClose();
    dispatch(setSnackbarState({open: true, message: 'Please approve borrow offer from your wallet'}))
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
            value={collateralUnderlyingValue}
            onChange={onCollateralUnderlyingChange}
            placesToShow={3}
            decimalPlaces={collateralUnderlyingBrand ? getDecimalPlaces(collateralUnderlyingBrand) : 3}
            label="Collateral Underlying Amount" />
        </Grid>
        <Grid item xs={6}>
          <BrandSelector
            brand={collateralUnderlyingBrand}
            brands={getCollateralBrands()}
            setBrand={onCollateralUnderlyingBrandChange}
            label="Collateral Underlying Brand"
            displayBrandPetname={displayBrandPetname}/>
        </Grid>
        <Grid item xs={6}>
          <NatAmountInputSupply
            value={collateralValue}
            onChange={onCollateralChange}
            placesToShow={3}
            disabled={collateralInputDisabled}
            decimalPlaces={collateralBrand ? getDecimalPlaces(collateralBrand) : 8}
            label="Collateral Amount" />
        </Grid>
        <Grid item xs={3}>
          <PurseSelector
            purse={collateralPurse}
            purses={collateralPurses}
            setPurse={setCollateralPurse}
            isDisabled={collateralInputDisabled}
            label="From - Collateral Purse" />
        </Grid>
        <Grid item xs={3}>
          <PriceTextField
            id="outlined-basic"
            label="Max Debt Allowed"
            variant="outlined"
            fullWidth
            value={displayAmount(collateralValueInCompare)}
            disabled={collateralInputDisabled}
            InputProps={{
              readOnly: true,
            }} />
        </Grid>
        <Grid item xs={6}>
          <NatAmountInputProtocol
            value={debtAmount.value}
            onChange={onDebtChange}
            placesToShow={3}
            decimalPlaces={getDecimalPlaces(market.underlyingBrand)}
            label="Debt Amount" />
        </Grid>
        <Grid item xs={3}>
          <PurseSelector
            purse={debtPurse}
            purses={debtPurses}
            setPurse={setDebtPurse}
            label="To - Debt Purse" />

        </Grid>
        <Grid item xs={3}>
          <PriceTextField
            id="outlined-basic"
            label="Requested Debt Value"
            fullWidth
            variant="outlined"
            value={displayAmount(debtValueInCompare)}
            InputProps={{
              readOnly: true,
            }} />
        </Grid>
        <Grid item xs={12}>
          <Divider variant="fullWidth" />
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
            value={`1 ${underlyingPetname} = ${displayRatio(invertRatio(market.exchangeRate))} ${protocolPetname}`}
            InputProps={{
              readOnly: true,
            }} />
        </Grid>
        <Grid item xs={1}/>
        <Grid item xs={6}>
          <TextField id='outlined-basic' label={`${underlyingPetname} / ${comparePetname}`} variant='outlined' fullWidth
                     value={displayPrice(market.underlyingBrand, market.thirdCurrencyBrand, prices)} />
        </Grid>

        <Grid item xs={6}>
          <TextField id='outlined-basic' label={`Collateral / ${comparePetname}`} variant='outlined' fullWidth
                     value={displayPrice(collateralUnderlyingBrand, market.thirdCurrencyBrand, prices)} />
        </Grid>
        <Grid item xs={12}>
          <Divider variant="fullWidth" />
        </Grid>
        <Grid item xs={12}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={handleClose} color="primary" variant={"outlined"}>
              Cancel
            </Button>
            <Button onClick={handleBorrow} color="primary" variant={"contained"}
                    className={classes.marginLeftOne}>
              Borrow
            </Button>
          </div>
        </Grid>
      </Grid>
    </div>
  );
};

export default Borrow;