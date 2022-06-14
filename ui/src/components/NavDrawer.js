import React from 'react';

import { makeStyles } from '@material-ui/core/styles';
import { NavLink } from 'react-router-dom';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import ListItemText from '@material-ui/core/ListItemText';
import MonetizationIcon from '@material-ui/icons/MonetizationOn';
import AccountBalanceIcon from '@material-ui/icons/AccountBalance';
import AccountBalanceWallet from '@material-ui/icons/AccountBalanceWallet';

import { AGORIC_LOGO_URL } from '../constants';

const useStyles = makeStyles(_theme => ({
  selected: {
    fontWeight: 'bold',
    textDecoration: 'underline',
  },
  logo: {
    margin: '8px 8px 0 8px',
    display: 'flex',
    padding: '4px 4px 0 4px',
    alignItems: 'center',
    flexDirection: 'row',
    height: '60px',
    [_theme.breakpoints.down('xs')]: {
      display: 'none',
    },
  },
  logoImage: {
    transform: 'scale(0.85)',
  },
  sectionHeader: {
    padding: '16px',
    fontSize: '16px',
    fontFamily: 'Montserrat,Arial,sans-serif',
    fontWeight: 700,
    letterSpacing: '0.15px',
  },
  divider: {
    width: '80%',
    margin: 'auto',
    padding: 0,
    height: '1px',
    backgroundColor: '#eee',
    [_theme.breakpoints.down('sm')]: {
      display: 'none',
    },
  },
}));

function ListItemLink(props) {
  const { icon, primary, to, replace } = props;

  const classes = useStyles();

  const renderLink = React.useMemo(() => {
    const listRouterLink = (itemProps, ref) => (
      <NavLink
        to={to}
        ref={ref}
        exact
        replace={replace}
        {...itemProps}
        activeClassName={classes.selected}
      />
    );
    listRouterLink.displayName = `listRouterLink(RouterLink)`;
    return React.forwardRef(listRouterLink);
  }, [to, replace]);

  return (
    <ListItem button component={renderLink}>
      {icon ? <ListItemIcon>{icon}</ListItemIcon> : null}
      <ListItemText primary={primary} />
    </ListItem>
  );
}

function NavDrawer() {
  const classes = useStyles();

  return (
    <div>
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
      <List>
        <div className={classes.divider} />
        <div className={classes.sectionHeader}>Core Economy</div>
        <ListItemLink
          icon={<MonetizationIcon />}
          primary="New Vault"
          to="/"
          replace
        />
        <ListItemLink
          icon={<AccountBalanceIcon />}
          primary="Vaults"
          to="/vaults"
          replace
        />
        <ListItemLink
          icon={<AccountBalanceWallet />}
          primary="RUN Stake"
          to="/run-stake"
          replace
        />
      </List>
    </div>
  );
}

export default NavDrawer;
