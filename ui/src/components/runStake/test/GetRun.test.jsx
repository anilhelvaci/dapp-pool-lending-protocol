/* eslint-disable import/no-extraneous-dependencies */
import { mount } from 'enzyme';
import RunStake from '../RunStake';

const state = {};

const useApplicationContext = () => ({
  state,
});

jest.mock('../../../contexts/Application', () => ({ useApplicationContext }));

jest.mock('../EconomyDetails', () => () => 'EconomyDetails');
jest.mock('../MyBalances', () => () => 'MyBalances');
jest.mock('../Adjust', () => () => 'Adjust');
jest.mock('../History', () => () => 'History');

jest.mock('@endo/eventual-send', () => ({
  E: obj =>
    new Proxy(obj, {
      get(target, propKey) {
        const method = target[propKey];
        return (...args) => method.apply(this, args);
      },
    }),
}));

jest.mock('@agoric/ertp', () => ({
  AmountMath: {
    make: jest.fn(),
  },
}));

jest.mock('@agoric/run-protocol/src/interest-math', () => ({
  calculateCurrentDebt: jest.fn(),
}));

test('renders the header', () => {
  const component = mount(<RunStake />);

  expect(component.find('h3').text()).toContain('RUN Stake');
});
