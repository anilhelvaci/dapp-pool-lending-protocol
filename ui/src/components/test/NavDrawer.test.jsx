/* eslint-disable import/no-extraneous-dependencies */
import { mount } from 'enzyme';
import { MemoryRouter } from 'react-router-dom';
import NavDrawer from '../NavDrawer';

test('renders the run-stake link', () => {
  const component = mount(
    <MemoryRouter initialEntries={['/']}>
      <NavDrawer />
    </MemoryRouter>,
  );

  expect(component.text()).toContain('RUN Stake');
});
