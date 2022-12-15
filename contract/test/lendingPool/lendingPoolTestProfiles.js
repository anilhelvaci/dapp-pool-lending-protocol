import { makeRatio } from '@agoric/zoe/src/contractSupport/index.js';
import { POOL_TYPES } from './lendingPoolScenrioHelpers.js';
import { makeMarketStateChecker } from './helpers.js';
import { E } from '@endo/far';
import { AmountMath } from '@agoric/ertp';

export const makeLendingPoolTestProfileOne = async (t, scenarioHelpers, assertionHelpers, profileInfo) => {

	const {
		collateralPool: {
			keyword: colKeyword,
			brand: colBrand,
			priceValue: colPriceVal,
			rates: colRates,
			depositValue: colDepositValue,
		},
		debtPool: {
			keyword: debtKeyword,
			brand: debtBrand,
			priceValue: debtPriceVal,
			rates: debtRates,
			depositValue: debtDepositValue,
		},
		riskControls,
		compCurrencyBrand,
	} = profileInfo;

	const colCompPrice = makeRatio(colPriceVal, compCurrencyBrand, 10n ** 8n, colBrand);
	const debtCompPrice = makeRatio(debtPriceVal, compCurrencyBrand, 10n ** 8n, debtBrand);

	const [{ poolManager: colPoolMan }, { poolManager: debtPoolMan }] = await Promise.all([
		scenarioHelpers.addPool(colRates, riskControls, colCompPrice, colKeyword, POOL_TYPES.COLLATERAL),
		scenarioHelpers.addPool(debtRates, riskControls, debtCompPrice, debtKeyword, POOL_TYPES.DEBT)
	]);

	// Get market state checkers
	const [{ checkMarketStateInSync: checkVanPoolStateInSync }, { checkMarketStateInSync: checkPanPoolStateInSync }] = await Promise.all([
		makeMarketStateChecker(t, colPoolMan),
		makeMarketStateChecker(t, debtPoolMan),
	]);

	// Put money inside the pools
	await Promise.all([
		scenarioHelpers.depositMoney(POOL_TYPES.COLLATERAL, colDepositValue),
		scenarioHelpers.depositMoney(POOL_TYPES.DEBT, debtDepositValue)
	]);

	const checkPoolStates = async () => {
		// Check market state after deposit
		await Promise.all([
			checkVanPoolStateInSync(),
			checkPanPoolStateInSync(),
		]);
	};

	await checkPoolStates();

	// Check if the pool has enough liquidty
	const debtPoolInitialliquidity = AmountMath.make(debtBrand, debtDepositValue * 10n ** 8n);
	await assertionHelpers.assertEnoughLiquidityInPool(debtPoolMan, debtPoolInitialliquidity);

	return harden({ colPoolMan, debtPoolMan, checkPoolStates });
};