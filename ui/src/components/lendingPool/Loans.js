import React, { useState } from 'react';
import { useApplicationContext } from '../../contexts/Application.jsx';
import { Table, TableBody, TableContainer, TableHead, TableRow } from '@material-ui/core';
import Paper from '@material-ui/core/Paper';
import { StyledTableCell } from './StyledTableComponents.js';
import LoanItem from './LoanItem.js';
import Typography from '@material-ui/core/Typography';
import AdjustDialog from './AdjustDialog.js';
import LoanManagementDialog from './LoanManagementDialog.js';

const Loans = ({}) => {
  const {
    state: {
      brandToInfo,
      loans
    }
  } = useApplicationContext();

  const [isOpen, setIsOpen] = useState(false);
  const [selectedLoanMetadata, setSelectedLoanMetadata] = useState({});

  if(brandToInfo.length === 0 ) return null;

  if(!loans ) return (
    <Typography>
      There is no loan yet.
    </Typography>
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