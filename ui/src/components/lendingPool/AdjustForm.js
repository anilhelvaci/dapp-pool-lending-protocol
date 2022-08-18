import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import PurseSelector from './PurseSelector.js';
import Divider from '@material-ui/core/Divider';
import { TextField } from '@material-ui/core';
import { getAmountOut, invertRatio, makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import Button from '@material-ui/core/Button';
import { makeNatAmountInput } from '@agoric/ui-components';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { filterPursesByBrand, getTotalBalanceAmount, makeDisplayFunctions, sortPurses } from '../helpers.js';
import { AmountMath } from '@agoric/ertp';
import { assert } from '@agoric/assert';
import { floorDivideBy, floorMultiplyBy } from '@agoric/zoe/src/contractSupport/ratio.js';
import { parseAsNat } from '@agoric/ui-components/dist/display/natValue/parseAsNat.js';
import makeRedeemOffer from './offers/makeRedeemOffer.js';
import AdjustActionChooser from './AdjustActionChooser.js';
import ArrowRightAltSharpIcon from '@material-ui/icons/ArrowRightAltSharp';
import ArrowForwardRoundedIcon from '@material-ui/icons/ArrowForwardRounded';
import TrendingFlatRoundedIcon from '@material-ui/icons/TrendingFlatRounded';
import { AdjustActions } from '../../constants.js';
import makeAdjustOffer from './offers/makeAdjustOffer.js';

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
  },
  paper: {
    padding: theme.spacing(2),
    textAlign: 'center',
    color: theme.palette.text.secondary,
  },
  paddingTopZero: {
    paddingTop: theme.spacing(0),
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
  limitStatus: {
    marginBottom: theme.spacing(1),
  },
  divider: {
    backgroundColor: theme.palette.primary.main,
    opacity: 0.5,
  },
  arrowIcon: {
    '& .MuiSvgIcon-root': {
      preserveAspectRatio: 'none',
    },
    width: '100%',
  },
}));

const NatAmountInputRedeemUnderlying = makeNatAmountInput({ React, TextField });
const NatAmountInputProtocol = makeNatAmountInput({ React, TextField });

const AdjustForm = ({ loan, handleClose, debtMarket, collateralUnderlyingMarket, debtToCollateralRatioLimit }) => {

  const classes = useStyles();

  const {
    state: {
      brandToInfo,
      purses,
      lendingPool: {
        publicFacet: lendingPoolPublicFacet,
      },
      prices,
    },
    walletP,
  } = useApplicationContext();

  const [collateralAction, setCollateralAction] = useState(AdjustActions.NO_ACTION);
  const [debtAction, setDebtAction] = useState(AdjustActions.NO_ACTION);

  const [collateralDisabled, setCollateralDisabled] = useState(true);
  const [debtDisabled, setDebtDisabled] = useState(true);

  const [debtAmount, setDebtAmount] = useState(AmountMath.makeEmpty(debtMarket.underlyingBrand));
  const [collateralAmount, setCollateralAmount] = useState(AmountMath.makeEmpty(collateralUnderlyingMarket.protocolBrand));
  const [collateralUnderlyingAmount, setCollateralUnderlyingAmount] = useState(AmountMath.makeEmpty(collateralUnderlyingMarket.underlyingBrand));
  const [newDebtToAllowedLimitRatio, setNewDebtToAllowedLimitRatio] = useState(debtToCollateralRatioLimit);

  useEffect(() => {
    updateLimit();
  }, [collateralAmount, debtAmount, debtAction, collateralAction]);

  if (brandToInfo.length === 0 || !purses || !walletP || !lendingPoolPublicFacet || !prices) return null;

  const debtPurses = filterPursesByBrand(purses, debtMarket.underlyingBrand);
  sortPurses(debtPurses);

  const collateralPurses = filterPursesByBrand(purses, collateralUnderlyingMarket.protocolBrand);
  sortPurses(collateralPurses);

  const [debtPurse, setDebtPurse] = useState(
    debtPurses.length ? debtPurses[0] : null,
  );
  const [collateralPurse, setCollateralPurse] = useState(
    collateralPurses.length ? collateralPurses[0] : null,
  );


  const {
    displayBrandPetname,
    displayPercent,
    displayRatio,
    displayPrice,
    getDecimalPlaces,
    computeDebtToAllowedLimitRatio,
  } = makeDisplayFunctions(brandToInfo);

  const {
    debtSnapshot: { debt: currentDebt },
    locked,
  } = loan;

  const debt = value => AmountMath.make(debtMarket.underlyingBrand, value);

  const collateral = value => AmountMath.make(collateralUnderlyingMarket.protocolBrand, value);

  const collateralUnderlying = value => AmountMath.make(collateralUnderlyingMarket.underlyingBrand, value);

  const computeCollateralFromUnderlying = underlyingAmount => {
    return floorDivideBy(underlyingAmount, collateralUnderlyingMarket.exchangeRate);
  };

  const computeUnderlyingFromCollateral = collateralAmount => {
    return floorMultiplyBy(collateralAmount, collateralUnderlyingMarket.exchangeRate);
  };

  const handleActionChange = (value, setAction, setVisibility) => {
    setAction(value);
    upadteVisibility(value, setVisibility);
  };

  const upadteVisibility = (value, setVisibility) => {
    switch (value) {
      case AdjustActions.GIVE:
      case AdjustActions.WANT:
        setVisibility(false);
        break;
      case AdjustActions.NO_ACTION:
        setVisibility(true);
        break;
    }
  };

  const handleCollateralChange = value => {
    const collateralAmount = collateral(value);
    const collateralUnderlyingAmount = computeUnderlyingFromCollateral(collateralAmount);
    setCollateralAmount(collateralAmount);
    setCollateralUnderlyingAmount(collateralUnderlyingAmount);
  };

  const handleCollateralUnderlyingChange = value => {
    const collateralUnderlyingAmount = collateralUnderlying(value);
    const collateralAmount = computeCollateralFromUnderlying(collateralUnderlyingAmount);
    setCollateralUnderlyingAmount(collateralUnderlyingAmount);
    setCollateralAmount(collateralAmount);
  };

  const handleDebtChange = value => {
    setDebtAmount(debt(value));
  };

  const computeCollateralAfterTransaction = () => {
    assert(locked.brand === collateralAmount.brand, 'Amounts should be the same');

    // TODO: Should handle when proposed amount is greater than the current amount
    if (collateralAction === AdjustActions.NO_ACTION) return locked;
    if (collateralAction === AdjustActions.GIVE) return AmountMath.add(locked, collateralAmount);

    return AmountMath.subtract(locked, collateralAmount);
  };

  const computeDebtAfterTransaction = () => {
    assert(currentDebt.brand === debtAmount.brand, 'Amounts should be the same');

    // TODO: Should handle when proposed amount is greater than the current amount
    if (debtAction === AdjustActions.NO_ACTION) return currentDebt;
    if (debtAction === AdjustActions.GIVE) return AmountMath.subtract(currentDebt, debtAmount);

    return AmountMath.add(currentDebt, debtAmount);
  };

  const updateLimit = () => {
    const newLimitRatio = computeDebtToAllowedLimitRatio({
      debtAmount: computeDebtAfterTransaction(),
      collateralAmount: computeCollateralAfterTransaction(),
      collateralExchangeRate: collateralUnderlyingMarket.exchangeRate,
      liquidationMargin: debtMarket.liquidationMargin,
      prices,
    });
    setNewDebtToAllowedLimitRatio(newLimitRatio);
  };

  const handleAdjustLoanClick = () => {
    const adjustConfig = harden(
      {
        debt: {
          action: debtAction,
          purse: debtPurse,
          amount: debtAmount,
        },
        collateral: {
          action: collateralAction,
          purse: collateralPurse,
          amount: collateralAmount,
        },
        collateralUnderlyingBrand: collateralUnderlyingMarket.underlyingBrand,
        walletP,
        loanId: loan.id,
      }
    );

    makeAdjustOffer(adjustConfig).catch(err => console.log('Error makeAdjustOffer', err));
    handleClose();
  };

  return (
    <div className={classes.root}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
            <Typography variant='h5' noWrap className={classes.paddingTopOne}>
              Collateral
            </Typography>
            <AdjustActionChooser
              value={collateralAction}
              handleChange={(ev) => handleActionChange(ev.target.value, setCollateralAction, setCollateralDisabled)} />
          </div>
          <Divider className={classes.divider} />
        </Grid>
        <Grid item xs={4}>
          <NatAmountInputProtocol
            label='Collateral Amount'
            value={collateralAmount.value}
            onChange={handleCollateralChange}
            placesToShow={5}
            decimalPlaces={getDecimalPlaces(collateralUnderlyingMarket.protocolBrand)}
            disabled={collateralDisabled}
          />
        </Grid>
        <Grid item xs={4}>
          <NatAmountInputProtocol
            label='Collateral Underlying Amount'
            value={collateralUnderlyingAmount.value}
            onChange={handleCollateralUnderlyingChange}
            placesToShow={5}
            decimalPlaces={getDecimalPlaces(collateralUnderlyingMarket.underlyingBrand)}
            disabled={collateralDisabled}
          />
        </Grid>
        <Grid item xs={4}>
          <PurseSelector
            purse={collateralPurse}
            purses={collateralPurses}
            setPurse={setCollateralPurse}
            label='Collateral Purse'
            isDisabled={collateralDisabled}
          />
        </Grid>
        <Grid item xs={12}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexDirection: 'row' }}>
            <Typography variant='h5' noWrap className={classes.paddingTopOne}>
              Debt
            </Typography>
            <AdjustActionChooser value={debtAction} handleChange={(ev) => handleActionChange(ev.target.value, setDebtAction, setDebtDisabled)}/>
          </div>
          <Divider className={classes.divider} />
        </Grid>
        <Grid item xs={4}>
          <NatAmountInputProtocol
            label='Debt Amount'
            value={debtAmount.value}
            onChange={handleDebtChange}
            placesToShow={5}
            decimalPlaces={getDecimalPlaces(debtAmount.brand)}
            disabled={debtDisabled}
          />
        </Grid>
        <Grid item xs={4} />
        <Grid item xs={4}>
          <PurseSelector
            purse={debtPurse}
            purses={debtPurses}
            setPurse={setDebtPurse}
            label='Debt Purse'
            isDisabled={debtDisabled}
          />
        </Grid>
        <Grid item xs={12}>
          <Typography variant='h6' noWrap className={classes.limitStatus}>
            Limit Status
          </Typography>
          <Divider />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='From - %Of Limit' variant='outlined' value={`${displayPercent(debtToCollateralRatioLimit)}%`} />
        </Grid>
        <Grid item xs={4}>
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='To - %Of Limit' variant='outlined' value={`${displayPercent(newDebtToAllowedLimitRatio)}%`} />
        </Grid>
        <Grid item xs={12}>
          <Typography variant='h6' noWrap className={classes.limitStatus}>
            Parameters
          </Typography>
          <Divider />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='Exchange Rate' variant='outlined'
                     value={`1 ${displayBrandPetname(debtMarket.underlyingBrand)} = ${displayRatio(invertRatio(debtMarket.exchangeRate))} ${displayBrandPetname(debtMarket.protocolBrand)}`} />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='Price - Debt/USD' variant='outlined'
                     value={displayPrice(debtMarket.underlyingBrand, debtMarket.thirdCurrencyBrand, prices)} />
        </Grid>
        <Grid item xs={4}>
          <TextField id='outlined-basic' fullWidth label='Price - Collateral/USD' variant='outlined'
                     value={displayPrice(collateralUnderlyingMarket.underlyingBrand, collateralUnderlyingMarket.thirdCurrencyBrand, prices)} />
        </Grid>
        <Grid item xs={12}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={handleClose} color="primary" variant={"outlined"}>
              Cancel
            </Button>
            <Button onClick={handleAdjustLoanClick} color="primary" variant={"contained"}
                    className={classes.marginLeftOne} disabled={collateralDisabled && debtDisabled}>
              Adjust Loan
            </Button>
          </div>
        </Grid>
      </Grid>
    </div>
  );
};

export default AdjustForm;