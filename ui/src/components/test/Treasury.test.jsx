/* eslint-disable import/no-extraneous-dependencies */
import { act } from '@testing-library/react';
import { mount } from 'enzyme';
import Alert from '@material-ui/lab/Alert';
import CircularProgress from '@material-ui/core/CircularProgress';
import Checkbox from '@material-ui/core/Checkbox';

import VaultList from '../Treasury';
import { VaultSummary } from '../VaultSummary';

const state = {};
const dispatch = jest.fn();
const retrySetup = jest.fn();

const useApplicationContext = () => ({
  state,
  dispatch,
  retrySetup,
});

jest.mock('../../contexts/Application', () => ({ useApplicationContext }));

jest.mock('../../store', () => ({
  setVaultToManageId: jest.fn(),
  setLoadTreasuryError: jest.fn(),
}));

jest.mock('../VaultSummary', () => ({ VaultSummary: () => 'VaultSummary' }));

beforeEach(() => {
  state.loadTreasuryError = false;
  state.approved = false;
  state.vaults = null;
  state.brandToInfo = [];
  state.treasury = null;
  window.localStorage.setItem('showClosedVaults', 'false');
});

test('renders a message when the dapp needs approval', () => {
  const component = mount(<VaultList />);

  expect(component.text()).toContain(
    'To continue, please approve the VaultFactory Dapp in your wallet.',
  );
});

test('renders an alert when vaults fail to load', () => {
  state.loadTreasuryError = true;
  state.approved = true;

  const component = mount(<VaultList />);

  const alert = component.find(Alert);
  expect(alert.text()).toContain(
    'A problem occured while loading your vaults — make sure you have RUN in your Zoe fees purse.',
  );
});

test('renders a loading indicator when vaults are null', () => {
  state.approved = true;

  const component = mount(<VaultList />);

  const progress = component.find(CircularProgress);
  expect(progress).toHaveLength(1);
});

test('renders a message when no vaults are available', () => {
  state.approved = true;
  state.vaults = {};
  state.treasury = {};

  const component = mount(<VaultList />);

  expect(component.text()).toContain('No vaults available yet');
});

test('renders the vaults', () => {
  state.vaults = {
    1: {
      status: 'Loan Initiated',
    },
  };
  state.approved = true;
  state.treasury = { priceAuthority: { quoteGiven: jest.fn() } };

  const component = mount(<VaultList />);

  const vaultSummaries = component.find(VaultSummary);
  expect(vaultSummaries).toHaveLength(1);
  expect(vaultSummaries.at(0).props().vault).toEqual(state.vaults['1']);
  expect(vaultSummaries.at(0).props().id).toEqual('1');
});

test('hides closed vaults by default', () => {
  state.vaults = {
    1: {
      status: 'Closed',
    },
  };
  state.approved = true;
  state.treasury = { priceAuthority: { quoteGiven: jest.fn() } };

  const component = mount(<VaultList />);

  const vaultSummaries = component.find(VaultSummary);
  expect(vaultSummaries).toHaveLength(0);
});

test('shows closed vaults when enabled', () => {
  state.vaults = {
    1: {
      status: 'Closed',
    },
  };
  state.approved = true;
  state.treasury = { priceAuthority: { quoteGiven: jest.fn() } };

  const component = mount(<VaultList />);
  const showClosedCheckbox = component.find(Checkbox);
  act(() => showClosedCheckbox.props().onChange({ target: { checked: true } }));
  component.update();

  const vaultSummaries = component.find(VaultSummary);
  expect(vaultSummaries).toHaveLength(1);
  expect(vaultSummaries.at(0).props().vault).toEqual(state.vaults['1']);
  expect(vaultSummaries.at(0).props().id).toEqual('1');
});

test('shows loading vaults', () => {
  state.vaults = {
    1: {
      status: 'Loading',
    },
  };
  state.approved = true;
  state.treasury = { priceAuthority: { quoteGiven: jest.fn() } };

  const component = mount(<VaultList />);

  const vaultSummaries = component.find(VaultSummary);
  expect(vaultSummaries).toHaveLength(1);
  expect(vaultSummaries.at(0).props().vault).toEqual(state.vaults['1']);
  expect(vaultSummaries.at(0).props().id).toEqual('1');
});
