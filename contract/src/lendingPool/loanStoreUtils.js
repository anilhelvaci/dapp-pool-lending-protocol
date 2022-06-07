import { keyEQ, keyLT, makeScalarMap } from '@agoric/store';
import { AmountMath } from '@agoric/ertp';

export const makeLoanStoreUtils = () => {
  const store = makeScalarMap('store');
  let firstKey;
  let reschedule;

  const setRescheduler = (scheduler) => {
    reschedule = scheduler;
  }

  const calculateKeyNumberPart = (normalizedDebt, collateral) => {
    const c = Number(collateral.value);
    const d = normalizedDebt.value
      ? Number(normalizedDebt.value)
      : Number.EPSILON;
    return ((c / d) / Number(10n ** 20n)).toFixed(50);
  };

  const toLoanKey = (normalizedDebt, collateral, loanId) => {
    assert(normalizedDebt);
    assert(collateral);
    assert(loanId);

    const numberPart = calculateKeyNumberPart(normalizedDebt, collateral);
    return `${numberPart}:${loanId}`;
  };

  const fromLoanKey = key => {
    return [key.split(':')];
  };

  const firstDebtRatio = () => {
    if (store.getSize() === 0) {
      return undefined;
    }
    // Get the first loan.
    const [loan] = store.values();
    const collateralAmount = loan.getCollateralAmount();
    if (AmountMath.isEmpty(collateralAmount)) {
      // ??? can currentDebtToCollateral() handle this?
      // Would be an infinite ratio
      return undefined;
    }
    return loan;
  };

  const removeByKey = key => {
    try {
      const loan = store.get(key);
      assert(loan);
      store.delete(key);
      return loan;
    } catch (e) {
      const keys = Array.from(store.keys());
      console.error(
        'removeByKey failed to remove',
        key,
        'parts:',
        fromLoanKey(key),
      );
      console.error('  key literals:', keys);
      console.error('  key parts:', keys.map(fromLoanKey));
      throw e;
    }
  };

  const addElement = (loanId, loan) => {
    const debt = loan.getCurrentDebt();
    const collateral = loan.getCollateralAmount();
    console.log("[COLLATERAL]", collateral)
    const key = toLoanKey(debt, collateral, loanId);
    store.init(key, loan);
    return key;
  };

  const addLoan = (loanId, loan) => {
    const key = addElement(loanId, loan);
    console.log('addLoan', firstKey, key);
    if (!firstKey || keyLT(key, firstKey)) {
      firstKey = key;
      reschedule();
    }
    return key;
  };

  const removeLoan = key => {
    const loan = removeByKey(key);
    console.log('removeLoan', firstKey, key);
    if (keyEQ(key, firstKey)) {
      const [secondKey] = store.keys();
      firstKey = secondKey;
    }
    return loan;
  };

  const removeLoanByAttributes = (oldDebt, oldCollateral, loanId) => {
    const key = toLoanKey(oldDebt, oldCollateral, loanId);
    return removeLoan(key);
  };

  const refreshLoanPriorityByAttributes = (oldDebt, oldCollateral, loanId) => {
    const loan = removeLoanByAttributes(oldDebt, oldCollateral, loanId);
    addLoan(loanId, loan);
  };

  const refreshLoanPriorityByKey = (key, loanId) => {
    const loan = removeLoan(key);
    return addLoan(loanId, loan);
  }

  return harden({
    addLoan,
    refreshLoanPriorityByAttributes,
    refreshLoanPriorityByKey,
    removeLoan,
    removeLoanByAttributes,
    firstDebtRatio,
    entries: store.entries,
    setRescheduler
  });
};