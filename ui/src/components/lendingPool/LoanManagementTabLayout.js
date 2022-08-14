import React, { useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import { makeNatAmountInput } from '@agoric/ui-components';
import { TextField } from '@material-ui/core';
import AdjustForm from './AdjustForm.js';
import { a11yProps, TabPanel } from '../TabPanelHelper.js';

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
    backgroundColor: theme.palette.background.paper,
  },
  container: {
    display: "flex",
    paddingTop: theme.spacing(1),
  },
  item: {
    // flexGrow: 1,
    marginTop: theme.spacing(1)
  }
}));

const NatAmountInput = makeNatAmountInput({ React, TextField });

const LoanManagementTabLayout = ({ loanMetadata, handleClose }) => {
  const classes = useStyles();
  const [value, setValue] = React.useState(0);

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  const {
    loan,
    debtMarket,
    collateralUnderlyingMarket,
    debtToCollateralRatioLimit,
  } = loanMetadata;

  return (
    <div className={classes.root}>
      <AppBar position="static">
        <Tabs
          value={value}
          onChange={handleChange}
          aria-label="simple tabs example"
          centered>
          <Tab label="Close" {...a11yProps(0)} />
          <Tab label="Adjust" {...a11yProps(1)} />
        </Tabs>
      </AppBar>
      <TabPanel value={value} index={0}>
        <div className={classes.container}>
          Close Loan
        </div>
      </TabPanel>
      <TabPanel value={value} index={1}>
        <div className={classes.container}>
          <AdjustForm loan={loan} debtMarket={debtMarket} collateralUnderlyingMarket={collateralUnderlyingMarket}
                      debtToCollateralRatioLimit={debtToCollateralRatioLimit} handleClose={handleClose} />
        </div>
      </TabPanel>
    </div>
  );
};

export default LoanManagementTabLayout;
