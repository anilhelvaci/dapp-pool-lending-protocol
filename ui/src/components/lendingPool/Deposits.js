import React, { useState } from 'react';
import { useApplicationContext } from '../../contexts/Application';
import { Table, TableBody, TableContainer, TableHead, TableRow, Typography } from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import { StyledTableCell } from './StyledTableComponents.js';
import DepositedItem from './DepositedItem.js';
import RedeemDialog from './RedeemDialog.js';
import AppProgressBar from './AppProgressBar.js';
import { AmountMath } from '@agoric/ertp';
import { getTotalBalanceAmount } from '../helpers.js';
import NothingToShow from './NothingToShow.js';

const Deposits = ({}) => {
  const {
    state: {
      purses,
      brandToInfo,
      markets,
      prices,
    },
  } = useApplicationContext();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState(null);

  if (brandToInfo.length === 0 || !purses || !prices || !markets) return (
    <AppProgressBar/>
  );

  const marketsDeposited = Object.values(markets).filter(market => !AmountMath.isEmpty(getTotalBalanceAmount(purses, market.protocolBrand)));
  // const marketsDeposited = [];

  if (marketsDeposited.length === 0) return (
    <NothingToShow message={'You have no deposits yet'}/>
  )

  const handleOnOpen = market => {
    setSelectedMarket(market);
    setIsOpen(true);
  };

  return (
    <div>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <StyledTableCell>Asset</StyledTableCell>
              <StyledTableCell align={'right'}>Protocol Balance</StyledTableCell>
              <StyledTableCell align={'right'}>Redeem Balance</StyledTableCell>
            </TableRow>
          </TableHead>
          <TableBody>{marketsDeposited.map(market =>
            <DepositedItem
              market={market}
              priceQuote={prices[market.underlyingBrand]}
              handleOpen={handleOnOpen}
            />,
          )}</TableBody>
        </Table>
      </TableContainer>
      <RedeemDialog open={isOpen} handleClose={() => setIsOpen(false)} market={selectedMarket} />
    </div>
  );
};

export default Deposits;