import React from 'react';
import Typography from '@material-ui/core/Typography';
import Paper from '@material-ui/core/Paper';
import { makeStyles } from '@material-ui/core/styles';
import { floorMultiplyBy } from '@agoric/zoe/src/contractSupport';
import { AmountMath } from '@agoric/ertp';
import { NameValueTable } from './NameValueTable';
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

const MyBalances = ({
  brandToInfo,
  accountState,
  borrowLimit,
  loan,
  debt,
  liened,
  stakeBrand,
}) => {
  const { displayAmount } = makeDisplayFunctions(brandToInfo);
  const classes = useStyles();

  const leftToBorrow =
    borrowLimit &&
    accountState &&
    floorMultiplyBy(accountState.bonded, borrowLimit);

  const rows =
    leftToBorrow && accountState && stakeBrand && loan
      ? [
          [
            'Liened',
            `${displayAmount(liened ?? AmountMath.makeEmpty(stakeBrand))} BLD`,
          ],
          [
            'Borrowed',
            `${displayAmount(
              debt ?? AmountMath.makeEmpty(leftToBorrow.brand),
            )} RUN`,
          ],
          ['Staked', `${displayAmount(accountState.bonded)} BLD`],
          ['Borrow Limit', `${displayAmount(leftToBorrow)} RUN`],
        ]
      : [];

  const values = !rows.length ? (
    <NameValueTable numToLoad={4} />
  ) : (
    <NameValueTable rows={rows} />
  );

  return (
    <Paper className={classes.root} elevation={4}>
      <Typography className={classes.title}>My Wallet</Typography>
      <hr className={classes.break} />
      {values}
    </Paper>
  );
};

export default MyBalances;
