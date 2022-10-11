import React, { useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import { makeNatAmountInput } from '@agoric/ui-components';
import { TextField } from '@material-ui/core';
import Supply from './Supply';
import Borrow from './Borrow.js';
import { a11yProps, TabPanel } from '../TabPanelHelper.js';

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.background.paper,
  },
  container: {
    display: "flex",
  },
  item: {
    flexGrow: 1,
    margin: theme.spacing(1)
  }
}));

const PoolTabsLayout = ({ market, handleClose }) => {
  const classes = useStyles();
  const [value, setValue] = React.useState(0);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  if (!market) return null;

  return (
    <div className={classes.root}>
      <AppBar position="static">
        <Tabs
          value={value}
          onChange={handleChange}
          aria-label="simple tabs example"
          centered>
          <Tab label="Supply" {...a11yProps(0)} />
          <Tab label="Borrow" {...a11yProps(1)} />
        </Tabs>
      </AppBar>
      <TabPanel value={value} index={0}>
        <div className={classes.container}>
          <Supply market={market} handleClose={handleClose}/>
        </div>
      </TabPanel>
      <TabPanel value={value} index={1}>
        <div className={classes.container}>
          <Borrow market={market} handleClose={handleClose}/>
        </div>
      </TabPanel>
    </div>
  );
};

export default PoolTabsLayout;
