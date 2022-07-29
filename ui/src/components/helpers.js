// @ts-check

import {
  stringifyRatioAsPercent,
  stringifyRatio,
  stringifyValue,
} from '@agoric/ui-components';

import { AssetKind, AmountMath } from '@agoric/ertp';
import { ceilMultiplyBy, makeRatioFromAmounts } from '@agoric/zoe/src/contractSupport/ratio.js';
import { getAmountOut } from '@agoric/zoe/src/contractSupport/priceQuote.js';
import { Nat } from '@endo/nat';

export const getPurseAssetKind = purse =>
  (purse && purse.displayInfo && purse.displayInfo.assetKind) || undefined;
export const getPurseDecimalPlaces = purse =>
  (purse && purse.displayInfo && purse.displayInfo.decimalPlaces) || undefined;

export const displayPetname = pn => (Array.isArray(pn) ? pn.join('.') : pn);

export const filterPursesByBrand = (purses, desiredBrand) =>
  purses.filter(({ brand }) => brand === desiredBrand);

export const filterProtocolPurses = purses =>
  purses.filter(({ brandPetname }) => brandPetname.slice(0,2) === 'Ag'); // Might consider looking for a better way

export const getTotalBalanceAmount = (purses, desiredBrand) => {
  let totalValue = 0n;
  const filteredPurses = filterPursesByBrand(purses, desiredBrand);
  filteredPurses.forEach(purse => totalValue += purse.value);
  return AmountMath.make(desiredBrand, totalValue);
}

export const comparePurses = (a, b) =>
  displayPetname(a.pursePetname) > displayPetname(b.pursePetname) ? 1 : -1;

export const sortPurses = purses => purses.sort(comparePurses);

export const getInfoForBrand = (brandToInfo, brand) => {
  const array = brandToInfo.find(([b]) => b === brand);
  if (array) {
    return array[1];
  }
  return undefined;
};

export const makeDisplayFunctions = brandToInfo => {
  const brandToInfoMap = new Map(brandToInfo);

  const getDecimalPlaces = brand => brandToInfoMap.get(brand).decimalPlaces;
  const getPetname = brand => brandToInfoMap.get(brand).petname;

  const displayPercent = (ratio, placesToShow) => {
    return stringifyRatioAsPercent(ratio, getDecimalPlaces, placesToShow);
  };
  const displayBrandPetname = brand => {
    return displayPetname(getPetname(brand));
  };
  const displayRatio = (ratio, placesToShow) => {
    return stringifyRatio(ratio, getDecimalPlaces, placesToShow);
  };

  const displayAmount = (amount, placesToShow) => {
    const decimalPlaces = getDecimalPlaces(amount.brand);
    return stringifyValue(
      amount.value,
      AssetKind.NAT,
      decimalPlaces,
      placesToShow,
    );
  };

  const computeAmountInCompare = (quote, amountIn) => {
    const decimalPlaces = getDecimalPlaces(amountIn.brand);
    return ceilMultiplyBy(amountIn, makeRatioFromAmounts(
      getAmountOut(quote),
      AmountMath.make(amountIn.brand, 10n ** Nat(decimalPlaces)),
    ));
  };

  return {
    displayPercent,
    displayBrandPetname,
    displayRatio,
    displayAmount,
    getDecimalPlaces,
    computeAmountInCompare,
  };
};
