import Button from '@material-ui/core/Button';
import CircularProgress from '@material-ui/core/CircularProgress';
import { makeStyles } from '@material-ui/core/styles';

const useStyles = makeStyles(theme => ({
  getStarted: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'column',
    margin: 'auto',
    height: '450px',
    overflow: 'hidden',
  },
  graphicContainer: {
    height: theme.spacing(45),
    width: theme.spacing(45),
  },
  graphic: {
    opacity: 0.6,
    objectFit: 'none',
    width: '200%',
    height: '200%',
    transform: 'scale(0.5) translateX(-50%) translateY(-50%)',
  },
  getStartedAction: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    fontSize: '20px',
    '& > *': {
      marginBottom: theme.spacing(2),
    },
  },
}));

const GetStarted = ({ onGetStarted, pendingApproval }) => {
  console.log('pending approval', pendingApproval);
  const classes = useStyles();

  const message =
    onGetStarted && !pendingApproval ? (
      <>
        <div>No loans open</div>
        <Button
          onClick={() => onGetStarted()}
          className={classes.button}
          variant="contained"
          color="primary"
        >
          Get Started
        </Button>
      </>
    ) : (
      <>
        {pendingApproval ? (
          <div>Pending wallet approval</div>
        ) : (
          <>
            <div>Fetching loan data</div>
            <CircularProgress />
          </>
        )}
      </>
    );

  return (
    <div className={classes.getStarted}>
      <div className={classes.graphicContainer}>
        <img className={classes.graphic} src="/assets/boats.png" />
      </div>
      <div className={classes.getStartedAction}>{message}</div>
    </div>
  );
};

export default GetStarted;
