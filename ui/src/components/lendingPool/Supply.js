import React, { useState } from "react";
import { useApplicationContext } from "../../contexts/Application";
import { filterPursesByBrand, makeDisplayFunctions, sortPurses } from "../helpers";
import { makeNatAmountInput } from "@agoric/ui-components";
import { TextField } from "@material-ui/core";
import PurseSelector from "./PurseSelector";
import { AmountMath } from "@agoric/ertp";
import { makeStyles } from "@material-ui/core/styles";
import Divider from "@material-ui/core/Divider";
import Grid from "@material-ui/core/Grid";
import { floorDivideBy, floorMultiplyBy, invertRatio } from "@agoric/zoe/src/contractSupport/ratio.js";
import Typography from "@material-ui/core/Typography";
import { makeRatio } from "@agoric/zoe/src/contractSupport/ratio";
import { parseAsNat } from "@agoric/ui-components/dist/display/natValue/parseAsNat";
import Button from "@material-ui/core/Button";
import makeDepositOffer from "./offers/makeDepositOffer";

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

const Supply = ({ market, handleClose }) => {

  const {
    state: {
      brandToInfo,
      purses,
      lendingPool: {
        publicFacet: lendingPoolPublicFacet
      }
    },
    walletP
  } = useApplicationContext();

  if (brandToInfo.length === 0 || !market || !purses || !walletP || !lendingPoolPublicFacet) return null;

  const classes = useStyles();

  const underlying = value => {
    return AmountMath.make(market.underlyingBrand, value);
  };

  const protocol = value => {
    return AmountMath.make(market.protocolBrand, value);
  };

  const computeProtocol = underlyingAmount => {
    return floorDivideBy(underlyingAmount, market.exchangeRate);
  };

  const computeUnderlying = protocolAmount => {
    return floorMultiplyBy(protocolAmount, market.exchangeRate);
  };

  const {
    displayBrandPetname,
    displayAmount,
    displayRatio,
    displayPercent,
    getDecimalPlaces,
  } = makeDisplayFunctions(brandToInfo);

  const underlyingPetname = displayBrandPetname(market.underlyingBrand);
  const protocolPetname = displayBrandPetname(market.protocolBrand);

  const supplyPurses = filterPursesByBrand(purses, market.underlyingBrand);
  sortPurses(supplyPurses);

  const protocolPurses = filterPursesByBrand(purses, market.protocolBrand);
  sortPurses(protocolPurses);

  const [supplyPurse, setSupplyPurse] = useState(
    supplyPurses.length ? supplyPurses[0] : null,
  );
  const [protocolPurse, setProtocolPurse] = useState(
    protocolPurses.length ? protocolPurses[0] : null,
  );

  const [supplyAmount, setSupplyAmount] = useState(AmountMath.makeEmpty(market.underlyingBrand));

  const onSupplyChange = supplyValue => {
    const underlyingAmount = underlying(supplyValue);
    setSupplyAmount(underlyingAmount);
    setProtocolAmount(computeProtocol(underlyingAmount));
  };

  const [protocolAmount, setProtocolAmount] = useState(AmountMath.makeEmpty(market.protocolBrand));

  const onProtocolChange = protocolValue => {
    const protocolAmount = protocol(protocolValue);
    setProtocolAmount(protocolAmount);
    setSupplyAmount(computeUnderlying(protocolAmount));
  };

  // Slippage is 0 at first
  const [slippageRatio, setSlippageRatio] = useState(
    makeRatio(
      0n,
      market.protocolBrand,
    ),
  );

  const handleOnSlippageChange = ev => {
    let str = ev.target.value;
    str = str.replace("%", "");
    const numeratorValue = parseAsNat(str);
    setSlippageRatio(makeRatio(numeratorValue, market.protocolBrand));
  };

  const supplyConfig = {
    walletP,
    lendingPoolPublicFacet,
    supplyPurse,
    supplyAmount,
    protocolPurse,
    protocolAmount,
    slippageRatio
  };

  const handleSupplyAsset = () => {
    makeDepositOffer(supplyConfig);
    handleClose();
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
          <NatAmountInputSupply
            value={supplyAmount.value}
            onChange={onSupplyChange}
            placesToShow={3}
            decimalPlaces={getDecimalPlaces(market.underlyingBrand)}
            label="Supply Amount" />
        </Grid>
        <Grid item xs={2} />
        <Grid item xs={4}>
          <PurseSelector
            purse={supplyPurse}
            purses={supplyPurses}
            setPurse={setSupplyPurse}
            label="From - Supply Purse" />
        </Grid>
        <Grid item xs={6}>
          <NatAmountInputProtocol
            value={protocolAmount.value}
            onChange={onProtocolChange}
            placesToShow={3}
            decimalPlaces={getDecimalPlaces(market.protocolBrand)}
            label="Protocol Amount" />
        </Grid>
        <Grid item xs={2} />
        <Grid item xs={4}>
          <PurseSelector
            purse={protocolPurse}
            purses={protocolPurses}
            setPurse={setProtocolPurse}
            label="To - Protocol Purse" />

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
        <Grid item xs={3} />
        <Grid item xs={3}>
          <TextField id="outlined-basic" label="Slippage" variant="outlined" onChange={handleOnSlippageChange}
                     value={`${displayPercent(slippageRatio)}%`} />
        </Grid>
        <Grid item xs={12}>
          <Divider variant="fullWidth" />
        </Grid>
        <Grid item xs={12}>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button onClick={handleClose} color="primary" variant={"outlined"}>
              Cancel
            </Button>
            <Button onClick={handleSupplyAsset} color="primary" variant={"contained"}
                    className={classes.marginLeftOne}>
              Supply Assets
            </Button>
          </div>
        </Grid>
      </Grid>
    </div>
  );
};

export default Supply;