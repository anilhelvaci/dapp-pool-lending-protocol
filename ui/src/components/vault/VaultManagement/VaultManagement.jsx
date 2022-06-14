// @ts-check
/// <reference types="ses"/>

import React, { useEffect, useState } from 'react';
import { Redirect } from 'react-router-dom';
import { Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import {
  makeRatioFromAmounts,
  floorMultiplyBy,
} from '@agoric/zoe/src/contractSupport';
import { AmountMath } from '@agoric/ertp';
import { Nat } from '@endo/nat';
import { E } from '@endo/eventual-send';
import { calculateCurrentDebt } from '@agoric/run-protocol/src/interest-math';

import AdjustVaultForm from './AdjustVaultForm';
import UnchangeableValues from './UnchangeableValues';
import ChangesTable from './ChangesTable';
import CloseVaultForm from './CloseVaultForm';
import ErrorBoundary from '../../ErrorBoundary';
import ApproveOfferSB from '../../ApproveOfferSB';
import { makeAdjustVaultOffer } from './makeAdjustVaultOffer';
import { useApplicationContext } from '../../../contexts/Application';
import { makeDisplayFunctions } from '../../helpers';

const useStyles = makeStyles(theme => ({
  root: {
    marginBottom: theme.spacing(3),
  },
  header: {
    marginTop: theme.spacing(3),
    marginBottom: theme.spacing(1),
    marginLeft: theme.spacing(1),
    padding: theme.spacing(2),
    '& > .MuiTypography-root': {
      fontFamily: 'Inter',
      fontWeight: '500',
      color: '#707070',
      fontSize: '22px',
    },
    '& > .MuiTypography-h3': {
      fontSize: '40px',
      lineHeight: '48px',
    },
  },
  valuesTable: {
    marginBottom: theme.spacing(3),
  },
}));

const VaultManagement = () => {
  const classes = useStyles();

  const { state, walletP } = useApplicationContext();

  const { purses, vaults, vaultToManageId, brandToInfo, treasury } = state;

  /** @type { VaultData } */
  let vaultToManage;
  if (vaultToManageId && vaults) {
    vaultToManage = vaults[vaultToManageId];
  } else {
    return <Redirect to="/vaults" />;
  }
  const {
    interestRate,
    liquidationRatio,
    locked,
    debtSnapshot,
    asset,
  } = vaultToManage;

  assert(
    locked && debtSnapshot && asset,
    `Can't manage vault with missing data: locked: ${locked}, debt: ${debtSnapshot}, asset: ${asset}`,
  );
  const debt = calculateCurrentDebt(
    debtSnapshot.debt,
    debtSnapshot.interest,
    asset.compoundedInterest,
  );

  // deposit, withdraw, noaction
  const [collateralAction, setCollateralAction] = useState('noaction');
  // borrow, repay, noaction
  const [debtAction, setDebtAction] = React.useState('noaction');
  const [lockedInputError, setLockedInputError] = useState(
    /** @type { string | null } */ (null),
  );
  const [debtInputError, setDebtInputError] = useState(
    /** @type { string | null } */ (null),
  );
  const [lockedDelta, setLockedDelta] = useState(
    AmountMath.make(locked.brand, 0n),
  );
  const [debtDelta, setDebtDelta] = useState(AmountMath.make(debt.brand, 0n));
  const [collateralPurseSelected, setCollateralPurseSelected] = useState(null);
  const [runPurseSelected, setRunPurseSelected] = useState(null);
  const [offerInvalid, setOfferInvalid] = useState(true);

  const [lockedAfterDelta, setLockedAfterDelta] = useState(locked);
  const [debtAfterDelta, setDebtAfterDelta] = useState(debt);
  const makeRatioState = () => useState(/** @type { Ratio | null } */ (null));
  const [
    newCollateralizationRatio,
    setNewCollateralizationRatio,
  ] = makeRatioState();
  const [marketPrice, setMarketPrice] = makeRatioState();
  const [collateralizationRatio, setCollateralizationRatio] = makeRatioState();

  const {
    displayBrandPetname,
    displayAmount,
    getDecimalPlaces,
  } = makeDisplayFunctions(brandToInfo);
  const lockedPetname = displayBrandPetname(locked.brand);

  const [openApproveOfferSB, setOpenApproveOfferSB] = React.useState(false);

  const handleApproveOfferSBClose = () => {
    setOpenApproveOfferSB(false);
  };

  const resetState = () => {
    setCollateralAction('noaction');
    setDebtAction('noaction');
  };

  const makeOffer = () => {
    makeAdjustVaultOffer({
      vaultToManageId,
      walletP,
      runPurseSelected,
      runValue: debtDelta && debtDelta.value,
      collateralPurseSelected,
      collateralValue: lockedDelta && lockedDelta.value,
      collateralAction,
      debtAction,
    });
    resetState();
    setOpenApproveOfferSB(true);
  };

  const calcRatio = (priceRate, newLock, newBorrow) => {
    const lockPrice = floorMultiplyBy(newLock, priceRate);
    return makeRatioFromAmounts(lockPrice, newBorrow);
  };

  // run once when component loaded.
  // TODO: use makeQuoteNotifier
  useEffect(() => {
    const decimalPlaces = getDecimalPlaces(locked.brand);

    // Make what would display as 1 unit of collateral
    const inputAmount = AmountMath.make(
      locked.brand,
      10n ** Nat(decimalPlaces),
    );
    assert(treasury, 'treasury missing, need priceAuthority');
    const quoteP = E(treasury.priceAuthority).quoteGiven(
      inputAmount,
      debt.brand,
    );

    quoteP.then(({ quoteAmount }) => {
      const [{ amountIn, amountOut }] = quoteAmount.value;
      const newMarketPrice = makeRatioFromAmounts(
        amountOut, // RUN
        amountIn, // 1 unit of collateral
      );
      setMarketPrice(newMarketPrice);
    });
  }, [vaultToManage]);

  useEffect(() => {
    if (marketPrice && locked && debt) {
      setCollateralizationRatio(calcRatio(marketPrice, locked, debt));
    }
  }, [marketPrice, locked, debt]);

  useEffect(() => {
    if (!marketPrice) return;

    setNewCollateralizationRatio(
      calcRatio(marketPrice, lockedAfterDelta, debtAfterDelta),
    );
  }, [marketPrice, lockedAfterDelta, debtAfterDelta]);

  useEffect(() => {
    if (collateralAction === 'noaction' && locked) {
      const newLockedDelta = AmountMath.makeEmpty(locked.brand);
      setLockedDelta(newLockedDelta);
      setLockedAfterDelta(AmountMath.add(locked, newLockedDelta));
    }
  }, [collateralAction, locked]);

  useEffect(() => {
    if (debtAction === 'noaction' && debt) {
      const newDebtDelta = AmountMath.makeEmpty(debt.brand);
      setDebtDelta(newDebtDelta);
      setDebtAfterDelta(AmountMath.add(debt, newDebtDelta));
    }
  }, [debtAction, debt]);

  useEffect(() => {
    if (collateralAction === 'deposit') {
      setLockedInputError(null);
      setLockedAfterDelta(AmountMath.add(locked, lockedDelta));
    }
    if (collateralAction === 'withdraw') {
      let newAmount;
      try {
        newAmount = AmountMath.subtract(locked, lockedDelta);
      } catch {
        setLockedInputError('Insufficient locked balance');
        return;
      }
      setLockedInputError(null);
      setLockedAfterDelta(newAmount);
    }
  }, [locked, lockedDelta, collateralAction]);

  useEffect(() => {
    if (debtAction === 'borrow') {
      setDebtInputError(null);
      setDebtAfterDelta(AmountMath.add(debt, debtDelta));
    }
    if (debtAction === 'repay') {
      let newAmount;
      try {
        newAmount = AmountMath.subtract(debt, debtDelta);
      } catch {
        setDebtInputError('Insufficient debt balance');
        return;
      }
      setDebtInputError(null);
      setDebtAfterDelta(newAmount);
    }
  }, [debt, debtDelta, debtAction]);

  const checkIfOfferInvalid = () => {
    if (!liquidationRatio || !marketPrice) return false;
    const ratio = calcRatio(marketPrice, lockedAfterDelta, debtAfterDelta);
    const approxCollateralizationRatio =
      Number(ratio.numerator.value) / Number(ratio.denominator.value);
    const approxLiquidationRatio =
      Number(liquidationRatio.numerator.value) /
      Number(liquidationRatio.denominator.value);
    return approxCollateralizationRatio < approxLiquidationRatio;
  };

  useEffect(() => {
    setOfferInvalid(checkIfOfferInvalid);
  }, [lockedAfterDelta, debtAfterDelta, liquidationRatio, marketPrice]);

  if (!marketPrice) {
    return <div>Finding the market price...</div>;
  }

  const header = (
    <div className={classes.header}>
      <Typography variant="h3">
        {displayAmount(locked)} {lockedPetname} Locked
      </Typography>
      <Typography>Vault ID: {vaultToManageId}</Typography>
    </div>
  );

  return (
    <div className={classes.root}>
      <ErrorBoundary>
        {header}
        <UnchangeableValues
          marketPrice={marketPrice}
          liquidationRatio={liquidationRatio}
          interestRate={interestRate}
          brandToInfo={brandToInfo}
          debt={debt}
          locked={locked}
        />
        <div className={classes.valuesTable}>
          <ChangesTable
            locked={locked}
            lockedAfterDelta={lockedAfterDelta}
            collateralizationRatio={collateralizationRatio}
            newCollateralizationRatio={newCollateralizationRatio}
            debt={debt}
            debtAfterDelta={debtAfterDelta}
            brandToInfo={brandToInfo}
          />
        </div>
        <AdjustVaultForm
          purses={purses}
          brandToInfo={brandToInfo}
          invalidOffer={offerInvalid}
          collateralAction={collateralAction}
          setCollateralAction={setCollateralAction}
          debtAction={debtAction}
          setDebtAction={setDebtAction}
          lockedInputError={lockedInputError}
          debtInputError={debtInputError}
          lockedDelta={lockedDelta}
          setLockedDelta={setLockedDelta}
          debtDelta={debtDelta}
          setDebtDelta={setDebtDelta}
          lockedBrand={locked.brand}
          debtBrand={debt.brand}
          makeOffer={makeOffer}
          collateralPurseSelected={collateralPurseSelected}
          setCollateralPurseSelected={setCollateralPurseSelected}
          runPurseSelected={runPurseSelected}
          setRunPurseSelected={setRunPurseSelected}
        />
        <CloseVaultForm
          purses={purses}
          walletP={walletP}
          vaultToManageId={vaultToManageId}
          debt={debt}
          locked={locked}
          brandToInfo={brandToInfo}
        />
      </ErrorBoundary>
      <ApproveOfferSB
        open={openApproveOfferSB}
        handleClose={handleApproveOfferSBClose}
      />
    </div>
  );
};

export default VaultManagement;
