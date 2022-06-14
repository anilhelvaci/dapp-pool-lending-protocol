/* eslint-disable no-unused-vars */
import React from 'react';
import Typography from '@material-ui/core/Typography';
import Paper from '@material-ui/core/Paper';
import { makeStyles } from '@material-ui/core/styles';
import { NameValueTable, makeRow } from './NameValueTable';
import { makeDisplayFunctions } from '../helpers';

const useStyles = makeStyles(theme => ({
  root: {
    backgroundColor: '#FFFFFF',
    marginBottom: theme.spacing(4),
    borderRadius: '20px',
    color: '#707070',
    fontSize: '22px',
    lineHeight: '27px',
    padding: theme.spacing(4),
    minWidth: 360,
  },
  title: {
    fontSize: '22px',
  },
  break: {
    border: 0,
    height: '1px',
    background: '#E5E5E5',
  },
  loadingPlaceholder: {
    height: '126px',
    display: 'flex',
    alignItems: 'center',
    margin: 'auto',
    width: 'fit-content',
  },
}));

const MarketDetails = ({ brandToInfo, borrowLimit, interestRate }) => {
  const classes = useStyles();
  const { displayPercent, displayRatio } = makeDisplayFunctions(brandToInfo);

  const rows =
    borrowLimit && interestRate
      ? [
          /* makeRow('BLD Price', `${displayRatio(collateralPrice)} RUN`),
          makeRow(
            'Min BLD:RUN Ratio',
            `${displayPercent(collateralizationRatio)}%`,
          ), */
          makeRow('Interest Rate', `${displayPercent(interestRate, 2)}%`),
          makeRow('Borrow Limit per BLD', `${displayRatio(borrowLimit)} RUN`),
        ]
      : [];
  const values =
    !borrowLimit || !interestRate ? (
      <NameValueTable rowsToLoad={2} />
    ) : (
      <NameValueTable rows={rows} />
    );

  return (
    <Paper className={classes.root} elevation={4}>
      <Typography className={classes.title}>Economy Details</Typography>
      <hr className={classes.break} />
      {values}
    </Paper>
  );
};

export default MarketDetails;
