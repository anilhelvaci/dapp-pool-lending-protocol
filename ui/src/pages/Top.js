import React from 'react';

import { makeStyles } from '@material-ui/core/styles';

import { BrowserRouter as Router, Switch, Route } from 'react-router-dom';

import AppHeader from '../components/AppHeader';

import LendingPool from '../components/lendingPool/LendingPool';
import Snackbar from '@material-ui/core/Snackbar';
import Alert from '@material-ui/lab/Alert';
import { useApplicationContext } from '../contexts/Application.jsx';
import { setSnackbarState } from '../store.js';

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
  snackbar: {
    backgroundColor: theme.palette.secondary.main,
  }
}));

function Top() {
  const [isOpen, setIsOpen] = React.useState(false);
  const handleDrawerToggle = () => setIsOpen(!isOpen);

  const classes = useStyles();

  const {
    state: {
      snackbarState: {
        open,
        message,
        stick
      }
    },
    dispatch,
  } = useApplicationContext();

  const handleClose = () => {
    dispatch(setSnackbarState({ open: false, message: '' }))
  };

  return (
    <Router>
      <div className={classes.root}>
        <AppHeader
          handleDrawerToggle={handleDrawerToggle}
          drawerWidth={navigationDrawerWidth}
        ></AppHeader>
        <div className={classes.body}>
          <main className={classes.content}>
            <Switch>
              <Route path='/'>
                <LendingPool />
              </Route>
            </Switch>
          </main>
          <Snackbar open={open} autoHideDuration={stick ? null : 6000} onClose={handleClose} anchorOrigin={{
            vertical: 'top',
            horizontal: 'right',
          }} >
            <Alert onClose={handleClose} severity="info" variant={'filled'} className={classes.snackbar}>
              {message}
            </Alert>
          </Snackbar>
        </div>
      </div>
    </Router>
  );
}

export default Top;
