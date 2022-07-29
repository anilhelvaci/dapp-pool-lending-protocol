import React, { useState } from "react";
import PropTypes from 'prop-types';
import { makeStyles } from '@material-ui/core/styles';
import AppBar from '@material-ui/core/AppBar';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';
import { makeNatAmountInput } from '@agoric/ui-components';
import { TextField } from '@material-ui/core';
import Supply from "./Supply";
import Borrow from "./Borrow.js";

function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`simple-tabpanel-${index}`}
      aria-labelledby={`simple-tab-${index}`}
      {...other}
    >
      {value === index && (
        <Box p={3} style={{paddingTop: 0}}>
          <Typography component={"span"}>{children}</Typography>
        </Box>
      )}
    </div>
  );
}

TabPanel.propTypes = {
  children: PropTypes.node,
  index: PropTypes.any.isRequired,
  value: PropTypes.any.isRequired,
};

function a11yProps(index) {
  return {
    id: `simple-tab-${index}`,
    'aria-controls': `simple-tabpanel-${index}`,
  };
}

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

const NatAmountInput = makeNatAmountInput({ React, TextField });

const PoolTabsLayout = ({ market, handleClose }) => {
  const classes = useStyles();
  const [value, setValue] = React.useState(0);
  const [test, setTest] = useState(BigInt(1))

  const handleChange = (event, newValue) => {
    setValue(newValue);
  };

  if (!market) return null;

  const underlyingBrand = market.underlyingBrand;
  const protocolBrand = market.protocolBrand;

  const [underlyingInput, setUndelyingInput] = useState(null);

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
          {/*<NatAmountInput value={test} onChange={setTest}/>*/}
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
