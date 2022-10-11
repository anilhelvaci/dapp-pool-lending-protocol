import React from 'react';
import { makeStyles } from '@material-ui/core/styles';
import Paper from '@material-ui/core/Paper';
import { CircularProgress } from '@material-ui/core';

const useStyles = makeStyles((theme) => ({
  progressBar: {
    margin: 'auto',
    display: 'block'
  },
  progressBarContainer: {
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
    marginBottom: theme.spacing(1)
  }
}));

const AppProgressBar = () => {
  const classes = useStyles();

  return (
    <Paper className={classes.progressBarContainer}>
      <CircularProgress className={classes.progressBar}/>
    </Paper>
  )
};

export default AppProgressBar;