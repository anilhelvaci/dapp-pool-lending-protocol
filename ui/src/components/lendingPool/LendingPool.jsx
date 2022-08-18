import React, { useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Paper from '@material-ui/core/Paper';
import {
  Table,
  TableBody,
  TableContainer,
  TableHead,
  TableRow,

} from '@material-ui/core';
import Profile from './Profile';
import PoolDialog from './Dialog';
import { makeDisplayFunctions, getTotalBalanceAmount } from '../helpers';
import { useApplicationContext } from '../../contexts/Application';
import { E } from '@endo/far';
import { StyledTableCell, StyledTableRow } from './StyledTableComponents';
import Market from './Market';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import { a11yProps, TabPanel } from '../TabPanelHelper.js';
import Deposits from './Deposits.js';
import Loans from './Loans.js';
import { AGORIC_LOGO_URL } from '../../constants.js';
import AppProgressBar from './AppProgressBar.js';
import { setSnackbarState } from '../../store.js';

const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: 'auto',
  },
  profile: {
    width: '100%',
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(1),
  },
  paddingTopAndBottomByTwo: {
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
  },
  body: {
    // display: 'flex',
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    padding: theme.spacing(2),
    paddingTop: theme.spacing(1),
  },
  test: {
    marginTop: 0,
  },
  tableHead: {
    backgroundColor: 'orange',
    fontWeight: 900,
    fontSize: 'medium',
  },
  dialog: {
    width: 500,
  },
  appBar: {
    display: 'flex',
    flexDirection: 'row',
    backgroundColor: 'white',
    marginBottom: theme.spacing(1),
    position: 'relative',
    paddingTop: theme.spacing(1),
  },
  horizontalContainer: {
    display: 'flex',
    justifyContent: 'center',
    flexDirection: 'row',
    marginTop: theme.spacing(1),
  },
  supply: {
    // textAlign: 'center',
    flexGrow: 1,
    marginTop: theme.spacing(1),
    flexBasis: 0,
  },
  horizontalItemLeft: {
    flexGrow: 1,
    marginRight: theme.spacing(1),
    flexBasis: 0,
  },
  horizontalItemRight: {
    flexGrow: 1,
    marginLeft: theme.spacing(1),
    flexBasis: 0,
  },
  borrow: {
    textAlign: 'center',
    flexGrow: 1,
    flexBasis: 0,
    padding: 0,
    marginLeft: theme.spacing(1),
  },
  logo: {
    position: 'absolute',
    top: 0,
    left: 0,
    padding: theme.spacing(1),
    paddingBottom: theme.spacing(2),
    height: '80px',
    [theme.breakpoints.down('xs')]: {
      display: 'none',
    },
  },
  logoImage: {
    transform: 'scale(0.9)',
    width: 200,
  },
  approve: {
    width: 'fit-content',
    margin: 'auto',
  }
}));

function LendingPool() {
  const classes = useStyles();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('-');
  const [selectedMarket, setSelectedMarket] = useState(null);
  const [value, setValue] = useState(0);

  const handleClickOpen = (selectedMarket) => {
    setSelectedMarket(selectedMarket);
    setOpen(true);
  };
  const handleClose = () => {
    setOpen(false);
  };

  const {
    state: {
      lendingPool,
      purses,
      approved,
      brandToInfo,
      markets,
      prices,
      loans,
      snackbarState: {
        open: snackbarOpen,
      }
    },
    dispatch,
    walletP,
  } = useApplicationContext();

  console.log(lendingPool,
    purses,
    approved,
    brandToInfo, dispatch, prices,
    walletP);

  let displayFunctions;

  if (!approved && !snackbarOpen) {
    dispatch(setSnackbarState({
      open: true,
      message: 'To continue, please approve the LendingPool Dapp in your wallet.',
      stick: true,
    }));
  }

  const getActualUI = markets => {
    return (
      <div className={classes.supply}>
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <StyledTableCell>Asset</StyledTableCell>
                <StyledTableCell align='right'>Total Supply</StyledTableCell>
                <StyledTableCell align='right'>Total Protocol Supply</StyledTableCell>
                <StyledTableCell align='right'>Total Borrow</StyledTableCell>
                <StyledTableCell align='right'>APY</StyledTableCell>
                <StyledTableCell align='right'>Exchange Rate</StyledTableCell>
                <StyledTableCell align='right'>MMR</StyledTableCell>
              </TableRow>
            </TableHead>
            <TableBody>{Object.values(markets).map(market =>
              <Market
                market={market}
                handleClickOpen={handleClickOpen}
                brandToInfo={brandToInfo}
                priceQuote={prices[market.brand]} />)}</TableBody>
          </Table>
        </TableContainer>
      </div>
    );
  };

  const getUI = () => {
    console.log('inside getUI');
    if (lendingPool && markets && brandToInfo.length > 0 && purses && prices) {
      displayFunctions = makeDisplayFunctions(brandToInfo);
      E(lendingPool.publicFacet).helloWorld().then(msg => console.log(msg, 'From LendingPool'));
      console.log('Markets:', markets);
      return getActualUI(markets);
    } else {
      return (
        <AppProgressBar />
      );
    }
  };

  const getProfile = () => {
    if (!lendingPool || !purses || !approved || brandToInfo.length === 0 || !markets || !prices || !dispatch || !walletP || !loans) return (
      <AppProgressBar/>
    );
    return <Profile markets={markets} brandToInfo={brandToInfo} loans={loans} prices={prices} purses={purses}/>
  };

  return (
    <div className={classes.root}>
      <div className={classes.body}>
        <Paper className={classes.appBar} elevation={4}>
          <div className={classes.logo}>
            <a href='https://agoric.com'>
              <img
                className={classes.logoImage}
                src={AGORIC_LOGO_URL}
                alt='Agoric'
              ></img>
            </a>
          </div>
          <Tabs
            style={{ flexGrow: 1 }}
            value={value}
            onChange={(_, newValue) => setValue(newValue)}
            aria-label='simple tabs example'
            textColor={'primary'}
            indicatorColor={'primary'}
            centered>
            <Tab label='Markets' {...a11yProps(0)} />
            <Tab label='Activity' {...a11yProps(1)} />
          </Tabs>
        </Paper>
        {getProfile()}
        <TabPanel value={value} index={0}>
          {getUI()}
        </TabPanel>
        <TabPanel value={value} index={1}>
          <div className={classes.horizontalContainer}>
            <div className={classes.horizontalItemLeft}>
              <Deposits />
            </div>
            <div className={classes.horizontalItemRight}>
              <Loans />
            </div>
          </div>
        </TabPanel>
      </div>
      <PoolDialog open={open} name={name} handleClose={handleClose} market={selectedMarket}
                  displayFunctions={displayFunctions} />
    </div>
  );
}

export default LendingPool;