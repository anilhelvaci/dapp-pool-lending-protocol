/* eslint-disable no-unused-vars */
import React, { useEffect, useState } from 'react';

import { AmountMath } from '@agoric/ertp';
import { E } from '@endo/eventual-send';
import { floorMultiplyBy, invertRatio } from '@agoric/zoe/src/contractSupport';
import Paper from '@material-ui/core/Paper';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import Typography from '@material-ui/core/Typography';
import { Grid } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { filterPurses } from '@agoric/ui-components';

import ApproveOfferSB from '../ApproveOfferSB';
import ConfirmOfferTable from './ConfirmOfferTable';
import GetStarted from './GetStarted';
import NatPurseAmountInput from './NatPurseAmountInput';
import { makeDisplayFunctions } from '../helpers';
import { LoanStatus } from '../../constants';

const useStyles = makeStyles(theme => ({
  root: {
    backgroundColor: '#FFFFFF',
    marginBottom: theme.spacing(4),
    borderRadius: '20px',
    color: '#707070',
    fontSize: '22px',
    lineHeight: '27px',
    padding: theme.spacing(4),
    paddingTop: theme.spacing(2),
  },
  settingsToolbar: {
    minHeight: '48px',
    paddingLeft: '20px',
  },
  toolbarIcon: {
    marginRight: theme.spacing(1),
  },
  buttons: {
    marginTop: theme.spacing(1),
  },
  actionChoices: {
    marginBottom: theme.spacing(3),
    maxHeight: '40px',
  },
  button: {
    color: 'white',
  },
  infoText: {
    marginBottom: theme.spacing(3),
    marginTop: theme.spacing(3),
  },
  title: {
    fontSize: '22px',
  },
  tabsRoot: {
    flexGrow: 1,
  },
  break: {
    border: 0,
    height: '1px',
    background: '#E5E5E5',
  },
  step: {
    marginBottom: theme.spacing(3),
  },
  stepTitle: {
    fontSize: '18px',
    color: '#707070',
  },
  collateralInfo: {
    fontSize: 14,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    color: 'rgb(112, 112, 112)',
    paddingRight: 4,
  },
  adjustCollateral: {
    paddingBottom: theme.spacing(3),
  },
  adjustDebt: {
    paddingBottom: theme.spacing(3),
  },
  checkboxLabel: {
    fontSize: '16px',
    color: '#222222',
  },
  form: {
    marginTop: theme.spacing(4),
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  confirm: {
    marginTop: theme.spacing(4),
  },
}));

const Adjust = ({
  purses,
  brandToInfo,
  brand,
  debtBrand,
  accountState,
  walletP,
  lienBrand,
  getRun,
  loan,
  borrowLimit,
  debt,
}) => {
  const classes = useStyles();

  const [runPurseSelected, setRunPurseSelected] = useState(null);
  const [collateralAction, setCollateralAction] = useState('lock');
  const [debtAction, setDebtAction] = useState('borrow');
  const [debtDelta, setDebtDelta] = useState(null);
  const [lockedDelta, setLockedDelta] = useState(null);
  const [getStartedClicked, setGetStartedClicked] = useState(false);
  const [currentTab, setCurrentTab] = useState(0);
  const [openApproveOfferSB, setOpenApproveOfferSB] = useState(false);
  const [useMaxCollateral, setUseMaxCollateral] = useState(false);
  const [useMaxDebt, setUseMaxDebt] = useState(false);

  const handleTabChange = (_, newTab) => {
    setCurrentTab(newTab);
  };

  const handleApproveOfferSBClose = () => {
    setOpenApproveOfferSB(false);
  };

  const unliened =
    accountState &&
    AmountMath.subtract(accountState.bonded, accountState.liened);

  useEffect(() => {
    if (!useMaxCollateral) return;

    if (collateralAction === 'lock' && lockedDelta?.value !== unliened?.value) {
      setLockedDelta(unliened);
    } else if (collateralAction === 'unlock') {
      const current = debt ?? AmountMath.makeEmpty(debtBrand);
      const delta = debtDelta ?? AmountMath.makeEmpty(debtBrand);
      const newBorrowed =
        current.value > delta.value
          ? AmountMath.subtract(
              debt ?? AmountMath.makeEmpty(debtBrand),
              debtDelta ?? AmountMath.makeEmpty(debtBrand),
            )
          : AmountMath.makeEmpty(debtBrand);

      const newLockedDelta = AmountMath.subtract(
        accountState?.liened ?? AmountMath.makeEmpty(brand),
        floorMultiplyBy(newBorrowed, invertRatio(borrowLimit)),
      );
      if (newLockedDelta?.value !== lockedDelta?.value) {
        setLockedDelta(newLockedDelta);
      }
    }
  }, [useMaxCollateral, debtDelta, accountState, loan]);

  useEffect(() => {
    if (!useMaxDebt) return;

    if (debtAction === 'borrow') {
      const newLiened = AmountMath.add(
        accountState?.liened ?? AmountMath.makeEmpty(brand),
        lockedDelta ?? AmountMath.makeEmpty(brand),
      );
      const newDebtLimit = floorMultiplyBy(newLiened, borrowLimit);
      const newDebtDelta = AmountMath.subtract(
        newDebtLimit,
        debt ?? AmountMath.makeEmpty(debtBrand),
      );
      if (newDebtDelta.value !== debtDelta?.value) {
        setDebtDelta(newDebtDelta);
      }
    } else {
      const newDebtDelta = debt ?? AmountMath.makeEmpty(debtBrand);
      if (newDebtDelta.value !== debtDelta?.value) {
        setDebtDelta(newDebtDelta);
      }
    }
  }, [useMaxDebt, lockedDelta, accountState, loan]);

  useEffect(() => {
    setUseMaxCollateral(false);
    setUseMaxDebt(false);
    setDebtDelta(null);
    setLockedDelta(null);
    if (currentTab === 0) {
      setCollateralAction('lock');
      setDebtAction('borrow');
    } else {
      setCollateralAction('unlock');
      setDebtAction('repay');
    }
  }, [currentTab]);

  const handleCollateralAmountChange = value => {
    const newLockedDelta = AmountMath.make(brand, value);
    setLockedDelta(newLockedDelta);
  };

  const handleDebtAmountChange = value => {
    const newDebtDelta = AmountMath.make(debtBrand, value);
    setDebtDelta(newDebtDelta);
  };

  console.log('adjust', purses, brand, debtBrand, accountState, loan);
  if (!purses || !brand || !debtBrand || !accountState || !loan) {
    return (
      <div>
        <Paper elevation={3} className={classes.root}>
          <GetStarted />
        </Paper>
      </div>
    );
  }

  const isLoanInProgress = [
    LoanStatus.PROPOSED,
    LoanStatus.PENDING,
    LoanStatus.COMPLETE,
  ].includes(loan?.status);

  const isLoanOpen = loan?.status === LoanStatus.OPEN;

  if ((!isLoanOpen && !getStartedClicked) || isLoanInProgress) {
    return (
      <Paper elevation={3} className={classes.root}>
        <GetStarted
          pendingApproval={isLoanInProgress}
          onGetStarted={() => setGetStartedClicked(true)}
        />
      </Paper>
    );
  }

  const runPurses = filterPurses(purses, debtBrand);
  const runPurse =
    runPurseSelected || runPurses.length > 0 ? runPurses[0] : null;

  const bldPurses = filterPurses(purses, brand);
  // TODO: find a better way to identify the staking purse.
  const bldStakingPurse = bldPurses.length > 0 ? bldPurses[0] : null;

  const { displayAmount } = makeDisplayFunctions(brandToInfo);

  const adjustCollateral = (
    <Grid item className={classes.step} key="adjustCollateral">
      <Typography variant="h6" className={classes.stepTitle}>
        {collateralAction === 'lock' ? 'Lien BLD' : 'Unlien BLD'}
      </Typography>
      <div className={classes.collateralForm}>
        <div className={classes.collateralInfo}>
          {collateralAction === 'lock'
            ? `Unliened: ${displayAmount(unliened)} BLD`
            : `Liened: ${displayAmount(accountState.liened)} BLD`}
        </div>
        <NatPurseAmountInput
          amount={lockedDelta && lockedDelta.value}
          onAmountChange={handleCollateralAmountChange}
          brandToFilter={debtBrand}
          brandToInfo={brandToInfo}
          iconSrc="tokens/BLD.svg"
          showPurseSelector={false}
          useMax={useMaxCollateral}
          onUseMaxChange={setUseMaxCollateral}
        />
      </div>
    </Grid>
  );

  const adjustDebt = (
    <Grid item className={classes.step} key="adjustDebt">
      <Typography variant="h6" className={classes.stepTitle}>
        {debtAction === 'borrow' ? 'Borrow RUN' : 'Repay RUN'}
      </Typography>
      <NatPurseAmountInput
        purses={runPurses}
        selectedPurse={runPurse}
        amount={debtDelta && debtDelta.value}
        onPurseChange={setRunPurseSelected}
        onAmountChange={handleDebtAmountChange}
        brandToFilter={debtBrand}
        brandToInfo={brandToInfo}
        iconSrc="tokens/RUN.svg"
        useMax={useMaxDebt}
        onUseMaxChange={setUseMaxDebt}
      />
    </Grid>
  );

  const openLoan = () => {
    const id = `${Date.now()}`;
    const invitation = E(getRun.RUNStakeAPI).makeLoanInvitation();
    const collateralAmount = AmountMath.make(
      lienBrand,
      lockedDelta?.value ?? 0n,
    );
    const debtAmount = AmountMath.make(debtBrand, debtDelta?.value ?? 0n);

    const offerConfig = {
      id,
      invitation,
      installationHandleBoardId: getRun.installationBoardId,
      instanceHandleBoardId: getRun.instanceBoardId,
      proposalTemplate: {
        give: {
          Attestation: {
            value: collateralAmount.value,
            pursePetname: bldStakingPurse.pursePetname,
            type: 'Attestation',
          },
        },
        want: {
          Debt: {
            pursePetname: runPurse.pursePetname,
            value: debtAmount.value,
          },
        },
      },
    };

    console.log('OFFER CONFIG', offerConfig);

    setUseMaxCollateral(false);
    setUseMaxDebt(false);
    setDebtDelta(null);
    setLockedDelta(null);
    setOpenApproveOfferSB(true);

    E(walletP).addOffer(offerConfig);
  };

  const makeOffer = async () => {
    if (!isLoanOpen) {
      openLoan();
      return;
    }

    const id = `${Date.now()}`;

    const continuingInvitation = {
      priorOfferId: loan?.id,
      description: 'AdjustBalances',
    };

    const collateralAmount = AmountMath.make(
      lienBrand,
      lockedDelta?.value ?? 0n,
    );
    const debtAmount = AmountMath.make(debtBrand, debtDelta?.value ?? 0n);

    const RUN = {
      value: debtAmount.value,
      pursePetname: runPurse.pursePetname,
    };

    const give = {};
    const want = {};

    const Attestation = {
      value: collateralAmount.value,
      pursePetname: bldStakingPurse.pursePetname,
      type: 'Attestation',
    };

    if (collateralAction === 'lock' && collateralAmount.value > 0n) {
      give.Attestation = Attestation;
    } else if (collateralAmount.value > 0n) {
      want.Attestation = Attestation;
    }

    if (debtAction === 'borrow' && debtAmount.value > 0n) {
      want.Debt = RUN;
    } else if (debtAmount.value > 0n) {
      give.Debt = RUN;
    }

    const offerConfig = {
      id,
      continuingInvitation,
      installationHandleBoardId: getRun.installationBoardId,
      instanceHandleBoardId: getRun.instanceBoardId,
      proposalTemplate: {
        give,
        want,
      },
    };

    console.log('OFFER CONFIG', offerConfig);

    setUseMaxCollateral(false);
    setUseMaxDebt(false);
    setDebtDelta(null);
    setLockedDelta(null);
    setOpenApproveOfferSB(true);

    E(walletP).addOffer(offerConfig);
  };

  return (
    <>
      <Paper elevation={3} className={classes.root}>
        <Tabs
          value={currentTab}
          onChange={handleTabChange}
          indicatorColor="primary"
          textColor="primary"
          centered
        >
          <Tab label="Borrow" />
          <Tab label="Repay" />
        </Tabs>
        <Grid className={classes.form} container direction="column">
          {debtAction === 'borrow'
            ? [adjustCollateral, adjustDebt]
            : [adjustDebt, adjustCollateral]}
        </Grid>
        <div className={classes.confirm}>
          <hr className={classes.break} />
          <ConfirmOfferTable
            locked={accountState.liened}
            borrowed={debt ?? AmountMath.makeEmpty(debtBrand)}
            lockedDelta={lockedDelta}
            debtDelta={debtDelta}
            brandToInfo={brandToInfo}
            collateralAction={collateralAction}
            debtAction={debtAction}
            borrowLimit={borrowLimit}
            onConfirm={() => makeOffer()}
            accountState={accountState}
          />
        </div>
      </Paper>
      <ApproveOfferSB
        open={openApproveOfferSB}
        handleClose={handleApproveOfferSBClose}
      />
    </>
  );
};

export default Adjust;
