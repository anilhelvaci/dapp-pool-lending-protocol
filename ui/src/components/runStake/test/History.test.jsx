/* eslint-disable import/no-extraneous-dependencies */
import { mount } from 'enzyme';

import History from '../History';

jest.mock('../../helpers', () => ({
  makeDisplayFunctions: _brandToInfo => ({
    displayAmount: (amount, _places) => `${amount.value}`,
  }),
}));

jest.mock('@agoric/ertp', () => ({
  AmountMath: {
    make: (brand, value) => ({ brand, value }),
    makeEmpty: brand => ({ brand, value: 0n }),
  },
}));

const brand = 'BLD';
const debtBrand = 'RUN';
const loan = { id: 0 };
const history = {
  0: {
    meta: { creationStamp: 1652035986400 },
    proposalForDisplay: {
      give: { Attestation: { amount: { brand, value: 2000n } } },
      want: { Debt: { amount: { debtBrand, value: 400n } } },
    },
  },
  1: {
    meta: { creationStamp: 1652036000540 },
    proposalForDisplay: {
      give: { Attestation: { amount: { brand, value: 550n } } },
      want: { Debt: { amount: { debtBrand, value: 110n } } },
    },
    continuingInvitation: { priorOfferId: -1 },
  },
  2: {
    meta: { creationStamp: 1652036018980 },
    proposalForDisplay: {
      give: { Attestation: { amount: { brand, value: 500n } } },
      want: { Debt: { amount: { debtBrand, value: 100n } } },
    },
    continuingInvitation: { priorOfferId: 0 },
  },
  3: {
    meta: { creationStamp: 1652036021460 },
    proposalForDisplay: {
      give: { Debt: { amount: { debtBrand, value: 100n } } },
      want: { Attestation: { amount: { brand, value: 500n } } },
    },
    continuingInvitation: { priorOfferId: 0 },
  },
  4: {
    meta: { creationStamp: 1652036036910 },
    proposalForDisplay: {},
    continuingInvitation: { priorOfferId: 0 },
  },
};

test('renders a message when there is no history', () => {
  const component = mount(
    <History
      loan={loan}
      history={{}}
      brandToInfo={{}}
      brand={brand}
      debtBrand={debtBrand}
    />,
  );

  expect(component.text()).toContain('Transactions will appear here.');
});

test('renders the history of all loans and adjustments', () => {
  const component = mount(
    <History
      loan={loan}
      history={history}
      brandToInfo={{}}
      brand={brand}
      debtBrand={debtBrand}
    />,
  );

  expect(component.text()).not.toContain('Transactions will appear here.');
  const rows = component.find('tr');

  expect(rows.length).toEqual(6);
  const header = rows.at(0).find('th');

  expect(header.at(0).text()).toContain('Date');
  expect(header.at(1).text()).toContain('Liened');
  expect(header.at(2).text()).toContain('Borrowed');

  const expectCellText = (row, column, text) =>
    expect(
      rows
        .at(row)
        .find('td')
        .at(column)
        .text(),
    ).toEqual(text);
  expectCellText(1, 0, '2022-05-08 18:53:56');
  expectCellText(2, 0, '2022-05-08 18:53:41');
  expectCellText(3, 0, '2022-05-08 18:53:38');
  expectCellText(4, 0, '2022-05-08 18:53:20');
  expectCellText(5, 0, '2022-05-08 18:53:06');

  expectCellText(1, 1, '0 BLD');
  expectCellText(2, 1, '-500 BLD');
  expectCellText(3, 1, '500 BLD');
  expectCellText(4, 1, '550 BLD');
  expectCellText(5, 1, '2000 BLD');

  expectCellText(1, 2, '0 RUN');
  expectCellText(2, 2, '-100 RUN');
  expectCellText(3, 2, '100 RUN');
  expectCellText(4, 2, '110 RUN');
  expectCellText(5, 2, '400 RUN');
});
