import React from 'react';
import { makeStyles } from '@material-ui/core/styles';

const useStyles = makeStyles(_ => ({
  root: {
    display: 'inline-block',
    height: '18px',
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#e9e9e9',

    '&::after': {
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      transform: 'translateX(-100%)',
      backgroundImage:
        'linear-gradient(90deg, #fff0 0, #fff2 20%, #fff8 60%, #fff0)',
      animation: `$shimmer 2.4s infinite`,
      content: '""',
    },
  },
  '@keyframes shimmer': {
    '100%': {
      transform: 'translateX(100%)',
    },
  },
}));

const LoadingShimmer = () => {
  const classes = useStyles();

  return <div className={classes.root}></div>;
};

export default LoadingShimmer;
