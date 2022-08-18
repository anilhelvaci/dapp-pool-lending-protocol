import React, { useEffect, useState } from 'react';
import { ListItem, ListItemIcon, Paper } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { getTotalBalanceAmount, makeDisplayFunctions } from '../helpers';
import { E } from '@endo/far';
import Typography from '@material-ui/core/Typography';
import { floorMultiplyBy, getAmountOut } from '@agoric/zoe/src/contractSupport';
import { AmountMath } from '@agoric/ertp';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import MonetizationIcon from '@material-ui/icons/MonetizationOn';
import List from '@material-ui/core/List';
import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math.js';
import { LoanStatus } from '../../constants.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const useStyles = makeStyles((theme) => ({
  test: {
    textAlign: 'center',
    marginTop: theme.spacing(1),
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
  },
  listItem: {
    justifyContent: 'center',
    paddingBottom: theme.spacing(0),
  },
  listItemIcon: {
    minWidth: 'unset',
    marginRight: theme.spacing(1),
  }
}));

const Profile = ({ markets, brandToInfo, loans, prices, purses }) => {
  const classes = useStyles();

  const [firstMarket] = Object.values(markets);
  const compareCurrencyBrand = firstMarket.thirdCurrencyBrand;

  useEffect(() => {
    computeTotalSupply();
    computeTotalBorrow();
  }, [loans, purses, markets, prices])

  const [totalSupply, setTotalSupply] = useState(AmountMath.makeEmpty(compareCurrencyBrand));
  const [totalBorrow, setTotalBorrow] = useState(AmountMath.makeEmpty(compareCurrencyBrand));

  const {
    displayAmount,
    computeAmountInCompare,
  } = makeDisplayFunctions(brandToInfo);

  const getData = () => {
    let totalBorrowNum = Number(totalBorrow.value);
    let totalSupplyNum = Number(totalSupply.value);

    if (totalBorrowNum === 0) totalBorrowNum = 1;
    if (totalSupplyNum === 0) totalSupplyNum = 1;

    return [totalBorrowNum, totalSupplyNum]
  };

  const computeTotalSupply = () => {
    let compareTotalValue = 0n;
    for (const market of Object.values(markets)) {
      const totalProtocolAmount = getTotalBalanceAmount(purses, market.protocolBrand);
      const underlyingLocked = floorMultiplyBy(totalProtocolAmount, market.exchangeRate);
      const quote = prices[market.underlyingBrand];
      if (!quote) continue;
      const supplyAMountInCompare = computeAmountInCompare(quote, underlyingLocked);
      compareTotalValue += supplyAMountInCompare.value;
    }
    setTotalSupply(AmountMath.make(compareCurrencyBrand, compareTotalValue));
  };

  const computeTotalBorrow = () => {
    let compareTotalValue = 0n;
    for (const loan of Object.values(loans)) {
      if (loan.loanState !== LoanStatus.ACTIVE) continue;
      const { debtSnapshot } = loan;
      if (!debtSnapshot) continue;
      const debtMarket = markets[debtSnapshot.debt.brand];
      const currentDebt = calculateCurrentDebt(debtSnapshot.debt, debtSnapshot.interest, debtMarket.compoundedInterest);
      const quote = prices[debtSnapshot.debt.brand];
      if (!quote) continue;
      const borrowAmountInCompare = computeAmountInCompare(quote, currentDebt);
      compareTotalValue += borrowAmountInCompare.value;
    }
    setTotalBorrow(AmountMath.make(compareCurrencyBrand, compareTotalValue));
  };

  const data = {
    labels: ['Borrow', 'Supply'],
    datasets: [
      {
        data: getData(),
        backgroundColor: [
          'rgba(59, 199, 190, 0.5)',
          'rgba(215, 50, 82, 0.5)',
        ],
        borderWidth: 1,
      },
    ],
  };

  return (
    <Paper className={classes.test} elevation={4}>
      <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ flexGrow: 1, flexBasis: 0 }}>
          <List>
            <ListItem className={classes.listItem}>
              <ListItemIcon className={classes.listItemIcon}>
                <MonetizationIcon/>
              </ListItemIcon>
              <Typography variant={'h6'}>Total Supply</Typography>
            </ListItem>
          </List>
          <Typography>${displayAmount(totalSupply, 4)}</Typography>
        </div>
        <div style={{ flexGrow: 1, flexBasis: 0, justifyContent: 'center' }}>
          <Doughnut data={data} width={'%30'} height={'%30'} options={{
            cutout: '80%',
            responsive: true,
            maintainAspectRatio: false,
          }} />
        </div>
        <div style={{ flexGrow: 1, flexBasis: 0, justifyContent: 'center' }}>
          <List>
            <ListItem className={classes.listItem}>
              <ListItemIcon className={classes.listItemIcon}>
                <MonetizationIcon/>
              </ListItemIcon>
              <Typography variant={'h6'}>Total Borrow</Typography>
            </ListItem>
          </List>
          <Typography>${displayAmount(totalBorrow, 4)}</Typography>
        </div>
      </div>
    </Paper>
  );
};

export default Profile;