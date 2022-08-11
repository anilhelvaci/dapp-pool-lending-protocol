import React, { useState } from 'react';
import { useApplicationContext } from '../../contexts/Application';
import { Table, TableBody, TableContainer, TableHead, TableRow, Typography } from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import { StyledTableCell } from './StyledTableComponents.js';
import Market from './Market.js';
import DepositedItem from './DepositedItem.js';
import RedeemDialog from './RedeemDialog.js';

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
    <div>
      <Typography>
        Something's missing...
      </Typography>
    </div>
  );

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
          <TableBody>{Object.values(markets).map(market =>
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