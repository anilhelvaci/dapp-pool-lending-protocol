import React from 'react';

import { makeStyles } from '@material-ui/core/styles';

import { BrowserRouter as Router, Switch, Route } from 'react-router-dom';

import AppHeader from '../components/AppHeader';
import ResponsiveNavigation from '../components/ResponsiveNavigation';

import NavDrawer from '../components/NavDrawer';

import NewVault from '../components/vault/NewVault';
import Treasury from '../components/Treasury';
import VaultManagement from '../components/vault/VaultManagement/VaultManagement';
import RunStake from '../components/runStake/RunStake';
import LendingPool from '../components/lendingPool/LendingPool';

const navigationDrawerWidth = 240;

const useStyles = makeStyles(theme => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
  },
  body: {
    display: 'flex',
    flexDirection: 'row',
    margin: 0,
    float: 'none !important',
  },
  content: {
    flexGrow: 1,
    backgroundColor: theme.palette.background.default,
    padding: theme.spacing(1),
    [theme.breakpoints.down('sm')]: {
      padding: 0,
    },
  },
}));

function Top() {
  const [isOpen, setIsOpen] = React.useState(false);
  const handleDrawerToggle = () => setIsOpen(!isOpen);

  const classes = useStyles();

  return (
    <Router>
      <div className={classes.root}>
        <AppHeader
          handleDrawerToggle={handleDrawerToggle}
          drawerWidth={navigationDrawerWidth}
        ></AppHeader>
        <div className={classes.body}>
          <ResponsiveNavigation
            drawerWidth={navigationDrawerWidth}
            isOpen={false}
            setIsOpen={setIsOpen}
          >
            <NavDrawer />
          </ResponsiveNavigation>

          <main className={classes.content}>
            <Switch>
              <Route path="/lending-pool">
              <LendingPool />
              </Route>
              <Route path="/vaults">
                <Treasury />
              </Route>
              <Route path="/manageVault">
                <VaultManagement />
              </Route>
              <Route path="/run-stake">
                <RunStake />
              </Route>
              <Route path="/">
                <NewVault />
              </Route>
            </Switch>
          </main>
        </div>
      </div>
    </Router>
  );
}

export default Top;
