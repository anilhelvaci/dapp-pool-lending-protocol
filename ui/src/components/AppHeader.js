import React from 'react';
import { makeStyles } from '@material-ui/core/styles';

import IconButton from '@material-ui/core/IconButton';
import MenuIcon from '@material-ui/icons/Menu';
import { AGORIC_LOGO_URL } from '../constants';

const useStyles = makeStyles(theme => ({
  appBar: {
    position: 'sticky',
    [theme.breakpoints.up('sm')]: {
      display: 'none',
    },
    padding: '8px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    top: 0,
  },
  menuButton: ({ drawerWidth }) => ({
    marginRight: theme.spacing(2),
    ...(drawerWidth && {
      [theme.breakpoints.up('sm')]: {
        display: 'none',
      },
    }),
    height: '48px',
  }),
  logo: {
    height: '60px',
    width: '200px',
    display: 'flex',
    alignItems: 'center',
    '& a': {
      display: 'flex',
      alignItems: 'center',
    },
  },
  logoImage: {
    transform: 'scale(0.85)',
  },
}));

function AppHeader({ handleDrawerToggle, children, drawerWidth }) {
  const classes = useStyles({ drawerWidth });

  return (
    <div className={classes.appBar}>
      <div className={classes.logo}>
        <a href="https://agoric.com">
          <img
            className={classes.logoImage}
            src={AGORIC_LOGO_URL}
            alt="Agoric"
            width="200"
          ></img>
        </a>
      </div>
      <IconButton
        className={classes.menuButton}
        color="primary"
        aria-label="menu"
        onClick={handleDrawerToggle}
      >
        <MenuIcon />
      </IconButton>
      {children}
    </div>
  );
}

export default AppHeader;
