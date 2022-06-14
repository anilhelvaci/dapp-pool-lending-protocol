// @ts-check
import React from 'react';

import {
  Button,
  CircularProgress,
  FormControl,
  FormLabel,
  Radio,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';

import { Alert } from '@material-ui/lab';

import '../../types/types';

import { setVaultCollateral, setLoadTreasuryError } from '../../store';
import { makeDisplayFunctions } from '../helpers';
import { useApplicationContext } from '../../contexts/Application';

const useStyles = makeStyles(theme => ({
  root: {
    marginBottom: theme.spacing(3),
  },
}));

/** @param { unknown } c */
const collateralAvailable = c => Array.isArray(c) && c.length > 0;
const standByForCollateralDiv = (
  <div>
    <CircularProgress style={{ margin: 'auto', display: 'block' }} />
  </div>
);
const noCollateralAvailableDiv = (
  <div>No assets are available to use as collateral.</div>
);

const headCells = [
  { id: 'petname', label: 'Asset' },
  { id: 'marketPrice', label: 'Market Price' },
  { id: 'liqMargin', label: 'Liquidation Ratio' },
  { id: 'interestRate', label: 'Interest Rate' },
];

const makeHeaderCell = data => (
  <TableCell key={data.id}>{data.label}</TableCell>
);

/**
 * @param {Object} info
 * @param {TreasuryDispatch} info.dispatch
 * @param {PursesJSONState[] | null} info.purses
 * @param {Collaterals | null} info.collaterals
 * @param {Iterable<[Brand, BrandInfo]>} info.brandToInfo
 */
function VaultCollateral({
  dispatch,
  purses,
  collaterals: collateralsRaw,
  brandToInfo,
}) {
  const classes = useStyles();
  const { state, retrySetup } = useApplicationContext();
  const { loadTreasuryError } = state;

  const onRetryClicked = () => {
    dispatch(setLoadTreasuryError(null));
    retrySetup();
  };

  const loadColalteralsErrorDiv = (
    <Alert
      action={
        <Button onClick={onRetryClicked} color="inherit" size="small">
          Retry
        </Button>
      }
      severity="error"
    >
      A problem occured while loading the collaterals — make sure you have RUN
      in your Zoe fees purse.
    </Alert>
  );

  const {
    displayRatio,
    displayPercent,
    displayBrandPetname,
  } = makeDisplayFunctions(brandToInfo);

  /** @param {CollateralInfo} row */
  const makeOnClick = row => _ev => {
    dispatch(setVaultCollateral(row));
  };

  // Filter out brands that the wallet does not have purses for
  const purseBrands = new Set(purses && purses.map(p => p.brand));
  const collaterals =
    collateralsRaw && collateralsRaw.filter(c => purseBrands.has(c.brand));

  if (loadTreasuryError) {
    return loadColalteralsErrorDiv;
  } else if (!collaterals) {
    return standByForCollateralDiv;
  } else if (!collateralAvailable(collaterals)) {
    return noCollateralAvailableDiv;
  }

  /** @param { Ratio } x */
  const percentCell = x => (
    <TableCell align="right">{displayPercent(x)}%</TableCell>
  );

  /**
   * Display a row per brand of potential collateral
   *
   * @param {CollateralInfo} row
   * @returns {import('react').ReactComponentElement}
   */
  const makeCollateralRow = row => {
    const marketPriceDisplay = displayRatio(row.marketPrice);
    const collateralPetnameDisplay = displayBrandPetname(row.brand);

    return (
      <TableRow key={collateralPetnameDisplay}>
        <TableCell padding="checkbox">
          <Radio onClick={makeOnClick(row)} />
        </TableCell>
        <TableCell>{collateralPetnameDisplay}</TableCell>
        <TableCell align="right">${marketPriceDisplay}</TableCell>
        {percentCell(row.liquidationMargin)}
        {percentCell(row.interestRate)}
      </TableRow>
    );
  };

  return (
    <div className={classes.root}>
      <FormControl component="fieldset">
        <FormLabel component="legend">Choose collateral</FormLabel>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                {headCells.map(makeHeaderCell)}
              </TableRow>
            </TableHead>
            <TableBody>{collaterals.map(makeCollateralRow)}</TableBody>
          </Table>
        </TableContainer>
      </FormControl>
    </div>
  );
}

export default VaultCollateral;
