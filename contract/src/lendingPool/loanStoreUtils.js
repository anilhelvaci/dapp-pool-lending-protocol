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

  const toVaultKey = (normalizedDebt, collateral, vaultId) => {
    assert(normalizedDebt);
    assert(collateral);
    assert(vaultId);

    const numberPart = calculateKeyNumberPart(normalizedDebt, collateral);
    return `${numberPart}:${vaultId}`;
  };

  const fromVaultKey = key => {
    return [key.split(':')];
  };

  const firstDebtRatio = () => {
    if (store.getSize() === 0) {
      return undefined;
    }
    // Get the first vault.
    const [vault] = store.values();
    const collateralAmount = vault.getCollateralAmount();
    if (AmountMath.isEmpty(collateralAmount)) {
      // ??? can currentDebtToCollateral() handle this?
      // Would be an infinite ratio
      return undefined;
    }
    return vault;
  };

  const removeByKey = key => {
    try {
      const vault = store.get(key);
      assert(vault);
      store.delete(key);
      return vault;
    } catch (e) {
      const keys = Array.from(store.keys());
      console.error(
        'removeByKey failed to remove',
        key,
        'parts:',
        fromVaultKey(key),
      );
      console.error('  key literals:', keys);
      console.error('  key parts:', keys.map(fromVaultKey));
      throw e;
    }
  };

  const addElement = (vaultId, vault) => {
    const debt = vault.getCurrentDebt();
    const collateral = vault.getCollateralAmount();
    console.log("[COLLATERAL]", collateral)
    const key = toVaultKey(debt, collateral, vaultId);
    store.init(key, vault);
    return key;
  };

  const addLoan = (vaultId, vault) => {
    const key = addElement(vaultId, vault);
    console.log('addVault', firstKey, key);
    if (!firstKey || keyLT(key, firstKey)) {
      firstKey = key;
      reschedule();
    }
    return key;
  };

  const removeLoan = key => {
    const vault = removeByKey(key);
    console.log('removeVault', firstKey, key);
    if (keyEQ(key, firstKey)) {
      const [secondKey] = store.keys();
      firstKey = secondKey;
    }
    return vault;
  };

  const removeLoanByAttributes = (oldDebt, oldCollateral, vaultId) => {
    const key = toVaultKey(oldDebt, oldCollateral, vaultId);
    return removeLoan(key);
  };

  const refreshLoanPriorityByAttributes = (oldDebt, oldCollateral, vaultId) => {
    const vault = removeLoanByAttributes(oldDebt, oldCollateral, vaultId);
    addLoan(vaultId, vault);
  };

  const refreshLoanPriorityByKey = (key, vaultId) => {
    const vault = removeLoan(key);
    return addLoan(vaultId, vault);
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