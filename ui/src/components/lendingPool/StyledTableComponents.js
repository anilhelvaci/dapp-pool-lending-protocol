import { withStyles } from "@material-ui/styles";
import { TableCell, TableRow } from "@material-ui/core";

export const StyledTableCell = withStyles((theme) => ({
  head: {
    backgroundColor: theme.palette.primary.main,
    color: theme.palette.common.white,
    fontWeight: 'bold',
    fontFamily: theme.typography.fontFamily[2],
    fontSize: 18,
  },
  body: {
    '&:hover': {
      cursor: 'pointer',
    },
  },
}))(TableCell);

export const StyledTableRow = withStyles(() => ({
  root: {
    '&:hover': {
      cursor: 'pointer',
    },
  },
}))(TableRow);