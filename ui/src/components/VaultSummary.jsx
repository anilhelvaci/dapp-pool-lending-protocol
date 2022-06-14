import React, { useEffect, useState } from 'react';

import { AmountMath } from '@agoric/ertp';
import {
  makeRatioFromAmounts,
  floorMultiplyBy,
} from '@agoric/zoe/src/contractSupport';
import { Nat } from '@endo/nat';
import { E } from '@endo/eventual-send';
import { makeStyles } from '@material-ui/core/styles';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
} from '@material-ui/core';

import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math';
import LoadingBlocks from './LoadingBlocks';
import { makeDisplayFunctions } from './helpers';
import { useApplicationContext } from '../contexts/Application';
import { VaultStatus } from '../constants';

const useStyles = makeStyles(theme => {
  return {
    header: {
      color: theme.palette.primary.main,
      fontWeight: 'bold',
    },
    loadingShimmer: {
      display: 'inline-block',
      height: '15px',
      width: '100%',
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#e9e9e9',

      '&::after': {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        transform: 'translateX(-100%)',
        backgroundImage:
          'linear-gradient(90deg, #fff0 0, #fff2 20%, #fff8 60%, #fff0)',
        animation: `$shimmer 2.4s infinite`,
        content: '""',
      },
    },
    '@keyframes shimmer': {
      '100%': {
        transform: 'translateX(100%)',
      },
    },
    pending: {
      height: 368,
      display: 'flex',
      flexDirection: 'column',
    },
    acceptOfferMessage: {
      marginTop: theme.spacing(2),
      flexGrow: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
    },
  };
});

const calcRatio = (priceRate, newLock, newBorrow) => {
  const lockPrice = floorMultiplyBy(newLock, priceRate);
  return makeRatioFromAmounts(lockPrice, newBorrow);
};

/**
 * @typedef {{
 * vault: VaultData,
 * brandToInfo: TreasuryState['brandToInfo'],
 * id: string,
 * }} Props
 */

/**
 * @param {Props} props
 */
export function VaultSummary({ vault, brandToInfo, id }) {
  const classes = useStyles();

  const { state } = useApplicationContext();
  const {
    treasury: { priceAuthority },
  } = state;

  const makeRatioState = () => useState(/** @type { Ratio | null } */ (null));
  const [marketPrice, setMarketPrice] = makeRatioState();
  const [collateralizationRatio, setCollateralizationRatio] = makeRatioState();

  const {
    displayPercent,
    displayAmount,
    displayBrandPetname,
    getDecimalPlaces,
  } = makeDisplayFunctions(brandToInfo);

  const {
    debtSnapshot,
    asset,
    interestRate,
    liquidationRatio,
    locked,
    status,
  } = vault;

  const debt =
    debtSnapshot &&
    asset &&
    calculateCurrentDebt(
      debtSnapshot.debt,
      debtSnapshot.interest,
      asset.compoundedInterest,
    );

  useEffect(() => {
    if (marketPrice && locked && debt) {
      setCollateralizationRatio(calcRatio(marketPrice, locked, debt));
    }
  }, [marketPrice, locked, debt]);

  useEffect(() => {
    if (!(locked && debt)) return;

    const decimalPlaces = getDecimalPlaces(locked.brand);

    // Make what would display as 1 unit of collateral
    const inputAmount = AmountMath.make(
      locked.brand,
      10n ** Nat(decimalPlaces),
    );
    assert(priceAuthority, 'priceAuthority missing');
    const quoteP = E(priceAuthority).quoteGiven(inputAmount, debt.brand);

    quoteP.then(({ quoteAmount }) => {
      const [{ amountIn, amountOut }] = quoteAmount.value;
      const newMarketPrice = makeRatioFromAmounts(
        amountOut, // RUN
        amountIn, // 1 unit of collateral
      );
      setMarketPrice(newMarketPrice);
    });
  }, [vault]);

  if (vault.status === VaultStatus.PENDING) {
    return (
      <div className={classes.pending}>
        <TableContainer>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell className={classes.header}>Id</TableCell>
                <TableCell className={classes.header} align="right">
                  {id}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Status</TableCell>
                <TableCell align="right">{vault.status}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
        <div className={classes.acceptOfferMessage}>
          <LoadingBlocks />
          <p> Please accept the offer in your wallet.</p>
        </div>
      </div>
    );
  }

  if (vault.status === VaultStatus.ERROR) {
    return (
      <TableContainer>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className={classes.header}>Id</TableCell>
              <TableCell className={classes.header} align="right">
                {id}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell align="right">{vault.status}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell colSpan={3}>
                <details style={{ whiteSpace: 'pre-wrap' }}>
                  {vault.err && vault.err.toString()}
                </details>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (!vault.status || vault.status === VaultStatus.LOADING) {
    return (
      <TableContainer>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className={classes.header}>Id</TableCell>
              <TableCell className={classes.header} align="right">
                {id}
              </TableCell>
            </TableRow>
            {[...Array(6).keys()].map(i => (
              <TableRow key={i}>
                <TableCell colSpan={3}>
                  <div className={classes.loadingShimmer}></div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  if (vault.status === VaultStatus.CLOSED) {
    return (
      <TableContainer>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className={classes.header}>Id</TableCell>
              <TableCell className={classes.header} align="right">
                {id}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Status</TableCell>
              <TableCell align="right">Closed</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <TableContainer>
      <Table>
        <TableBody>
          <TableRow>
            <TableCell className={classes.header}>Id</TableCell>
            <TableCell className={classes.header} align="right">
              {id}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Status</TableCell>
            <TableCell align="right">{status}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Deposited</TableCell>
            <TableCell align="right">
              {displayAmount(locked)} {displayBrandPetname(locked.brand)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Debt</TableCell>
            <TableCell align="right">
              {displayAmount(debt)} {displayBrandPetname(debt.brand)}
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Interest Rate</TableCell>
            <TableCell align="right">
              {interestRate ? displayPercent(interestRate) : '--'}%
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Liquidation Ratio</TableCell>
            <TableCell align="right">
              {displayPercent(liquidationRatio)}%
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell>Collateral Ratio</TableCell>
            <TableCell align="right">
              {displayPercent(collateralizationRatio)}%
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </TableContainer>
  );
}
