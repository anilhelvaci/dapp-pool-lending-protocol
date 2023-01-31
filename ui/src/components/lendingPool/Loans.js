import React, { useState } from 'react';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { Table, TableBody, TableContainer, TableHead, TableRow, Paper } from '@material-ui/core';
import { StyledTableCell } from './StyledTableComponents.js';
import LoanItem from './LoanItem.js';
import LoanManagementDialog from './LoanManagementDialog.js';
import AppProgressBar from './AppProgressBar.js';
import { LoanStatus } from '../../constants.js';
import NothingToShow from './NothingToShow.js';
import { isObjectEmpty } from '../helpers.js';

const Loans = ({}) => {
  const {
    state: {
      brandToInfo,
      loans,
      markets,
      prices,
    }
  } = useApplicationContext();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedLoanMetadata, setSelectedLoanMetadata] = useState({});

  if(brandToInfo.length === 0 || !loans || isObjectEmpty(markets) || !prices) return (
    <AppProgressBar/>
  );

  const hasLoansToShow = () => {
    for (const { loanState, debtSnapshot, collateralUnderlyingBrand } of Object.values(loans)) {
      if (loanState === LoanStatus.ACTIVE && loanMarketLoaded(debtSnapshot, collateralUnderlyingBrand)) return true;
    }
    return false;
  };

  const loanMarketLoaded = (debtSnapshot, collateralUnderlyingBrand) => {
    if (!debtSnapshot || !collateralUnderlyingBrand) return false;
    const debtMarket = markets[debtSnapshot.debt.brand];
    return debtMarket && debtMarket.compoundedInterest && prices[debtSnapshot.debt.brand] && prices[collateralUnderlyingBrand];
  }

  if(!hasLoansToShow()) return (
    <NothingToShow message={'You have no active loans'}/>
  );

  const handleOpen = metadata => {
    setSelectedLoanMetadata(metadata);
    setIsOpen(true);
  };

  return (
    <div>
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <StyledTableCell>Asset</StyledTableCell>
              <StyledTableCell align={'right'}>Collateral Locked</StyledTableCell>
              <StyledTableCell align={'right'}>Borrow Balance</StyledTableCell>
              <StyledTableCell align={'right'}>State</StyledTableCell>
              <StyledTableCell align={'right'}>% Of Limit</StyledTableCell>
            </TableRow>
          </TableHead>
          <TableBody>{Object.values(loans).map(loan =>
            <LoanItem
              loan={loan}
              handleOpen={handleOpen}
            />,
          )}</TableBody>
        </Table>
      </TableContainer>
      <LoanManagementDialog open={isOpen} handleClose={() => setIsOpen(false)} loanMetadata={selectedLoanMetadata}/>
    </div>
  );
};

export default Loans;