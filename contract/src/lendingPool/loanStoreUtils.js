import { keyEQ, keyLT } from '@agoric/store';
import { AmountMath } from '@agoric/ertp';
import { toVaultKey } from '@agoric/run-protocol/src/vaultFactory/storeUtils.js';
import { makeOrderedVaultStore } from '@agoric/run-protocol/src/vaultFactory/orderedVaultStore.js';
import { LoanPhase } from './loan.js'

/**
 * This module is somehow similar to the ~/run-protocol/vaultFactory/prioritizedVaults.js.
 * Every DebtsPerCollateral instance has one LoanStore to group the loans
 * with the same collateral type. The module uses the ~/run-protocol/vaultFactory/orderedVaults.js
 * module since our Loans are similar to the vaults in the vaultFactory.
 *
 * The reason why this module is implemented instead of directly using prioritizedVaults.js
 * module is we need to keep track of the actual Loan object as our element.
 * Instead, prioritizedVaults.js returns only the debt/collateral ratio. We need
 * the actual Loan object because the LendinPool's logic to keep track of the
 * liquidation treshold differs from the VaultFactory. The main reason for this
 * difference is that LendingPool can lend any type of asset and accept any type
 * of protocolToken. That's why the need for slightly different prioritizedVaults.js
 * showed itself. To override prioritizedVaults.js module's methods was not
 * possible because it returns a remotable object and it hardens its content.
 *
 * If we can find a propoer way to override prioritizedVaults.js module
 * we can remove some of the repeated code below.
 *
 * @return {LoanStore}
 */
export const makeLoanStoreUtils = () => {
  const store = makeOrderedVaultStore('store');
  let firstKey;
  let reschedule;

  /**
   *
   * @param scheduler
   */
  const setRescheduler = (scheduler) => {
    reschedule = scheduler;
  }

  /**
   * Returns loan instead of detb/col in priotirized vaults
   * @return {Loan}
   */
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

  /**
   *
   * @param loanId
   * @param loan
   * @return {string}
   */
  const addLoan = (loanId, loan) => {
    const key = store.addVault(loanId, loan);
    console.log('addLoan', firstKey, key);
    if (!firstKey || keyLT(key, firstKey)) {
      firstKey = key;
      reschedule();
    }
    return key;
  };

  /**
   *
   * @param key
   * @return {Loan}
   */
  const removeLoan = key => {
    const loan = store.removeByKey(key);
    console.log('removeLoan', firstKey, key);
    if (keyEQ(key, firstKey)) {
      const [secondKey] = store.keys();
      firstKey = secondKey;
    }
    return loan;
  };

  /**
   *
   * @param {Amount<'nat'>} oldDebt
   * @param {Amount<'nat'>} oldCollateral
   * @param {string}  loanId
   * @return {Loan}
   */
  const removeLoanByAttributes = (oldDebt, oldCollateral, loanId) => {
    const key = toVaultKey(oldDebt, oldCollateral, loanId);
    return removeLoan(key);
  };

  /**
   *
   * @param {Amount<'nat'>} oldDebt
   * @param {Amount<'nat'>} oldCollateral
   * @param {string}  loanId
   */
  const refreshLoanPriorityByAttributes = (oldDebt, oldCollateral, loanId) => {
    const loan = removeLoanByAttributes(oldDebt, oldCollateral, loanId);
    return addIfActive(loanId, loan);
  };

  /**
   *
   * @param {string} key
   * @param {string} loanId
   * @return {string}
   */
  const refreshLoanPriorityByKey = (key, loanId) => {
    const loan = removeLoan(key);
    return addIfActive(loanId, loan);
  }

  const addIfActive = (loanId, loan) => {
    if (loan.getPhase() !== LoanPhase.ACTIVE) return 'Not exist';
    return addLoan(loanId, loan);
  };

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