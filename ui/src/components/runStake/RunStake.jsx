import { React, useState, useEffect } from 'react';

import { AmountMath } from '@agoric/ertp';
import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math';
import { E } from '@endo/eventual-send';
import { Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';

import Adjust from './Adjust';
import EconomyDetails from './EconomyDetails.jsx';
import MyBalances from './MyBalances.jsx';
import History from './History.jsx';
import { useApplicationContext } from '../../contexts/Application';

const useStyles = makeStyles(theme => ({
  adjust: {
    margin: `0 ${theme.spacing(2)}px`,
    flexGrow: 1,
  },
  body: {
    maxWidth: '1400px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    margin: 'auto',
  },
  container: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    flexWrap: 'wrap',
    padding: '32px 0',
  },
  item: {
    margin: `0 ${theme.spacing(2)}px`,
    minWidth: 420,
  },
  infoColumn: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
  },
  header: {
    maxWidth: '1560px',
    margin: 'auto',
    padding: theme.spacing(2),
    paddingBottom: 0,
    '& > .MuiTypography-root': {
      fontFamily: 'Inter',
      fontWeight: '500',
      color: '#707070',
      fontSize: '20px',
    },
    '& > .MuiTypography-h3': {
      fontSize: '32px',
      lineHeight: '32px',
      marginBottom: '16px',
    },
  },
  headerBottom: {
    height: '2px',
    width: '100%',
    margin: 'auto',
    backgroundColor: '#e0e0e0',
    marginTop: '24px',
  },
  history: {
    width: '100%',
    padding: '0 16px',
  },
  root: {
    margin: 'auto',
  },
}));

const RunStake = () => {
  const classes = useStyles();
  const {
    state: { purses, brandToInfo, RUNStake, loan, loanAsset, RUNStakeHistory },
    walletP,
    dispatch,
  } = useApplicationContext();

  const [accountState, setAccountState] = useState(null);

  useEffect(() => {
    if (!walletP) return () => {};

    let cancelled = false;
    const refreshAccountState = async () => {
      const newAccountState = await E(walletP).getAccountState();
      if (!cancelled) {
        setAccountState(newAccountState);
      }
      console.log('accountState:', newAccountState);
    };
    refreshAccountState();

    return () => (cancelled = true);
  }, [purses, walletP]);

  const {
    MintingRatio: { value: borrowLimit },
    InterestRate: { value: interestRate },
    LoanFee: { value: loanFee },
  } = RUNStake?.RUNStakeTerms?.governedParams ?? {
    MintingRatio: {},
    InterestRate: {},
    LoanFee: {},
  };

  const debt =
    loan?.data?.debtSnapshot &&
    loanAsset &&
    calculateCurrentDebt(
      loan.data.debtSnapshot.debt,
      loan.data.debtSnapshot.interest,
      loanAsset.compoundedInterest,
    );

  const { Attestation: lienBrand, Debt: debtBrand, Stake: stakeBrand } =
    RUNStake?.RUNStakeTerms?.brands ?? {};

  const liened =
    stakeBrand &&
    loan?.data?.locked &&
    AmountMath.make(stakeBrand, loan.data.locked.value.payload[0][1]);

  return (
    <div className={classes.root}>
      <div className={classes.header}>
        <Typography variant="h3">RUN Stake</Typography>
        <Typography>
          Stake BLD, borrow RUN, automatically pay it back with your staking
          rewards.
        </Typography>
        <div className={classes.headerBottom}></div>
      </div>
      <div className={classes.body}>
        <div className={classes.container}>
          <div className={classes.infoColumn}>
            <div className={classes.item}>
              <EconomyDetails
                brandToInfo={brandToInfo}
                borrowLimit={borrowLimit}
                interestRate={interestRate}
                loanFee={loanFee}
              />
            </div>
            <div className={classes.item}>
              <MyBalances
                brandToInfo={brandToInfo}
                accountState={accountState}
                borrowLimit={borrowLimit}
                runStake={RUNStake}
                loan={loan}
                debt={debt}
                liened={liened}
                stakeBrand={stakeBrand}
              />
            </div>
          </div>
          <div className={classes.adjust}>
            <Adjust
              brand={stakeBrand}
              debtBrand={debtBrand}
              lienBrand={lienBrand}
              purses={purses}
              brandToInfo={brandToInfo}
              accountState={accountState}
              walletP={walletP}
              getRun={RUNStake}
              loan={loan}
              dispatch={dispatch}
              borrowLimit={borrowLimit}
              debt={debt}
              liened={liened}
            />
          </div>
        </div>
        <div className={classes.history}>
          <History
            loan={loan}
            history={RUNStakeHistory}
            brandToInfo={brandToInfo}
            brand={stakeBrand}
            debtBrand={debtBrand}
          />
        </div>
      </div>
    </div>
  );
};

export default RunStake;
