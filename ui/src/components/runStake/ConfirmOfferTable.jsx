import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import { AmountMath } from '@agoric/ertp';
import { floorMultiplyBy } from '@agoric/zoe/src/contractSupport';

import { makeDisplayFunctions } from '../helpers';

const useStyles = makeStyles(_ => ({
  row: {
    fontSize: '18px',
    lineHeight: '24px',
    marginBottom: 8,
    wordBreak: 'break-all',
  },
  new: {
    color: 'rgba(0, 0, 0, 0.87)',
  },
  invalidNew: {
    color: 'rgb(226, 41, 81)',
  },
  buttonRow: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
}));

const ConfirmOfferTable = ({
  locked,
  borrowed,
  lockedDelta,
  debtDelta,
  collateralAction,
  debtAction,
  brandToInfo,
  borrowLimit,
  accountState,
  onConfirm,
}) => {
  const { displayAmount } = makeDisplayFunctions(brandToInfo);
  const classes = useStyles();

  let newLockedValue =
    collateralAction === 'lock'
      ? locked.value + (lockedDelta?.value ?? 0n)
      : locked.value - (lockedDelta?.value ?? 0n);
  let newLockedSignum = '';
  if (newLockedValue < 0) {
    newLockedSignum = '-';
    newLockedValue *= -1n;
  }

  let newBorrowedValue =
    debtAction === 'borrow'
      ? borrowed.value + (debtDelta?.value ?? 0n)
      : borrowed.value - (debtDelta?.value ?? 0n);
  let newBorrowedSignum = '';
  if (newBorrowedValue < 0) {
    newBorrowedSignum = '-';
    newBorrowedValue *= -1n;
  }

  const newLocked = AmountMath.make(locked.brand, newLockedValue);
  const newBorrowed = AmountMath.make(borrowed.brand, newBorrowedValue);

  let invalidInput = false;
  if (
    newBorrowedSignum === '-' ||
    newLockedSignum === '-' ||
    newBorrowed.value > floorMultiplyBy(newLocked, borrowLimit).value ||
    newLocked.value > accountState.bonded.value
  ) {
    invalidInput = true;
  }

  const lockedChanged = newLocked.value !== locked.value;
  const borrowedChanged = newBorrowed.value !== borrowed.value;

  return (
    <>
      <div className={classes.row}>
        Liened: {displayAmount(locked)} -&gt;{' '}
        <span
          className={
            invalidInput
              ? classes.invalidNew
              : (lockedChanged && classes.new) || undefined
          }
        >
          {newLockedSignum}
          {displayAmount(newLocked)} BLD
        </span>
      </div>
      <div className={classes.row}>
        Borrowed: {displayAmount(borrowed)} -&gt;{' '}
        <span
          className={
            invalidInput
              ? classes.invalidNew
              : (borrowedChanged && classes.new) || undefined
          }
        >
          {newBorrowedSignum}
          {displayAmount(newBorrowed)} RUN
        </span>
      </div>
      <div className={classes.buttonRow}>
        <Button
          onClick={() => onConfirm()}
          className={classes.button}
          variant="contained"
          color="primary"
          disabled={invalidInput || (!borrowedChanged && !lockedChanged)}
        >
          Make Offer
        </Button>
      </div>
    </>
  );
};

export default ConfirmOfferTable;
