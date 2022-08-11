import AppBar from '@material-ui/core/AppBar';

console.log('zaa');
import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Paper from '@material-ui/core/Paper';
import { Radio, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@material-ui/core';
import Profile from './Profile';
import PoolDialog from './Dialog';
import { makeDisplayFunctions, getTotalBalanceAmount } from '../helpers';
import {useApplicationContext} from '../../contexts/Application';
import { E } from '@endo/far';
import { StyledTableCell, StyledTableRow } from "./StyledTableComponents";
import Market from "./Market";
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import { a11yProps, TabPanel } from '../TabPanelHelper.js';
import Supply from './Supply.js';
import Borrow from './Borrow.js';
import Deposits from './Deposits.js';
import Loans from './Loans.js';

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
    body: {
        // display: 'flex',
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'center',
        padding: theme.spacing(2),
        paddingTop: theme.spacing(1)
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
        backgroundColor: 'white',
        marginBottom: theme.spacing(1),
    },
    horizontalContainer: {
        display: 'flex',
        justifyContent: 'center',
        flexDirection: 'row',
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
        flexGrow: 1 ,
        flexBasis: 0,
        padding: 0,
        marginLeft: theme.spacing(1),
    },
}));

const createSupplyData = (asset, apy, balance, collateral) => {
    return { asset, apy, balance, collateral };
};

const createBorrowData = (asset, apy, balance, limit) => {
    return { asset, apy, balance, limit };
};

const supplyRows = [
    createSupplyData('Ether', '14.67%', '$1,5990', 'yes'),
    createSupplyData('Comp', '42.94%', '$37,429', 'no'),
    createSupplyData('Dai', '14.58%', '$4,3140', 'yes'),
    createSupplyData('Uniswap', '43.88%', '$7,990', 'yes'),
    createSupplyData('Tether', '57.77%', '$2,90', 'no'),
];

const borrowRows = [
    createBorrowData('Ether', '14.67%', '$990.234', '80%'),
    createBorrowData('Comp', '14.67%', '$990.234', '80%'),
    createBorrowData('Dai', '14.67%', '$990.234', '80%'),
    createBorrowData('Uniswap', '14.67%', '$990.234', '80%'),
    createBorrowData('Tether', '14.67%', '$990.234', '80%'),
];

function LendingPool() {
    const classes = useStyles();

    const [open, setOpen] = React.useState(false);
    const [name, setName] = React.useState('-');
    const [selectedMarket, setSelectedMarket] = React.useState(null);
    const [value, setValue] = React.useState(0);

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

    const getActualUI = markets => {
        return (
          <div className={classes.supply} >
              <TableContainer component={Paper}>
                  <Table>
                      <TableHead>
                          <TableRow >
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
                          displayFunctions={displayFunctions}
                          priceQuote={prices[market.brand]} />)}</TableBody>
                  </Table>
              </TableContainer>
          </div>
        )
    };

    const getUI = () => {
        console.log('inside getUI');
        if (lendingPool && markets && brandToInfo.length > 0 && purses && prices) {
            displayFunctions = makeDisplayFunctions(brandToInfo);
            E(lendingPool.publicFacet).helloWorld().then(msg => console.log(msg, "From LendingPool"));
            console.log("Markets:", markets);
            return getActualUI(markets);
        } else {
            return (
              <div className={classes.body}>
                  <Typography>
                      Loading...
                  </Typography>
              </div>
            )
        }
    }

    return (
      <div className={classes.root}>
          <div className={classes.profile}>
              <Profile/>
          </div>
          <div className={classes.body}>
              <Paper className={classes.appBar} elevation={4} >
                  <Tabs
                    value={value}
                    onChange={(_, newValue) => setValue(newValue)}
                    aria-label="simple tabs example"
                    textColor={'primary'}
                    indicatorColor={'primary'}
                    centered>
                      <Tab label="Markets" {...a11yProps(0)} />
                      <Tab label="Activity" {...a11yProps(1)} />
                  </Tabs>
              </Paper>
              <TabPanel value={value} index={0}  >
                  {getUI()}
              </TabPanel>
              <TabPanel value={value} index={1} >
                  <div className={classes.horizontalContainer}>
                      <div className={classes.horizontalItemLeft}>
                          <Deposits/>
                      </div>
                      <div className={classes.horizontalItemRight}>
                          <Loans/>
                      </div>
                  </div>
              </TabPanel>
          </div>
          <PoolDialog open={open} name={name} handleClose={handleClose} market={selectedMarket} displayFunctions={displayFunctions}/>
      </div>
    )

}

export default LendingPool;