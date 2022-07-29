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

const useStyles = makeStyles((theme) => ({
    root: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        margin: 'auto',
    },
    profile: {
        width: '100%',
        padding: theme.spacing(2),
    },
    body: {
        display: 'flex',
        width: '100%',
        flexDirection: 'row',
        justifyContent: 'center',
        padding: theme.spacing(2),
    },
    supply: {
        // textAlign: 'center',
        marginRight: theme.spacing(1),
        flexGrow: 1,
        flexBasis: 0,
    },
    borrow: {
        textAlign: 'center',
        flexGrow: 1 ,
        flexBasis: 0,
        padding: 0,
        marginLeft: theme.spacing(1),
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
    }
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
          <div className={classes.body}>
              <div className={classes.supply}>
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
          {getUI()}
          <PoolDialog open={open} name={name} handleClose={handleClose} market={selectedMarket} displayFunctions={displayFunctions}/>
      </div>
    )

}

export default LendingPool;