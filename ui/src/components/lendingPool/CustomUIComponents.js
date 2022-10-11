import { withStyles } from '@material-ui/core/styles';
import MuiDivider from '@material-ui/core/Divider';

export const DividerColorPrimary = withStyles((theme) => ({
  root: {
    backgroundColor: theme.palette.primary.main,
    opacity: 0.5,
  }
}))(MuiDivider);