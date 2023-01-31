import React from 'react';
import { makeStyles } from '@material-ui/styles';
import { NotInterested as NotInterestedIcon } from '@material-ui/icons';
import { Typography, Paper } from '@material-ui/core';

const useStyles = makeStyles((theme) => ({
  container: {
    textAlign: 'center',
    padding: theme.spacing(2),
  },
  icon: {
    color: theme.palette.primary.main,
    opacity: 0.5
  }
}));

const NothingToShow = ({message}) => {
  const classes = useStyles();

  return (
    <Paper className={classes.container}>
      <NotInterestedIcon className={classes.icon}/>
      <Typography>{message}</Typography>
    </Paper>
  )
};

export default NothingToShow;