import { withStyles } from '@material-ui/styles';
import { Divider as MuiDivider } from '@material-ui/core';

export const DividerColorPrimary = withStyles((theme) => ({
  root: {
    backgroundColor: theme.palette.primary.main,
    opacity: 0.5,
  }
}))(MuiDivider);