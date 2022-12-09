import { makeStore } from '@agoric/store';
import { ARITHMETIC_OPERATION } from './constants.js';
import { AmountMath } from '@agoric/ertp';


export const makeBalanceTracer = () => {
	const balances = makeStore('Balances');

	const getOperation = operationCode => {
	  switch (operationCode) {
		  case ARITHMETIC_OPERATION.ADD:
				return AmountMath.add;
		  case ARITHMETIC_OPERATION.SUBSTRACT:
				return AmountMath.subtract;
		  default:
				throw new Error('Inavlid Operation Code');
	  }
	};

	const addNewBalanceType = brand => {
		balances.init(brand, AmountMath.makeEmpty(brand));
	};

	const updateBalance = (brand, amountToAdd, operationCode) => {
		const currentBalance = balances.get(brand);
		const operation = getOperation(operationCode);
		const newBalance = operation(currentBalance, amountToAdd);
		balances.set(brand, newBalance);
	};

	const getBalance = brand => balances.get(brand);

	return harden({
		addNewBalanceType,
		updateBalance,
		getBalance,
	});
};