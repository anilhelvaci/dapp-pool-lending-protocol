import Table from '@material-ui/core/Table';
import TableBody from '@material-ui/core/TableBody';
import TableCell from '@material-ui/core/TableCell';
import TableContainer from '@material-ui/core/TableContainer';
import TableRow from '@material-ui/core/TableRow';
import { makeStyles } from '@material-ui/core/styles';

import LoadingShimmer from './LoadingShimmer';

const useStyles = makeStyles(_ => ({
  table: {
    '& > .MuiTableCell-root': {
      borderBottom: 'none',
    },
  },
  row: {
    '& > td': {
      borderBottom: 'none',
      fontSize: '18px',
      lineHeight: '24px',
    },
    '& > td:first-child': {
      color: '#707070',
    },
  },
}));

export const NameValueTable = ({ rows, numToLoad }) => {
  const classes = useStyles();

  let content;
  if (rows) {
    content = rows.map(([name, value]) => (
      <TableRow key={name} className={classes.row}>
        <TableCell align="left">{name}</TableCell>
        <TableCell align="right">{value}</TableCell>
      </TableRow>
    ));
  } else if (numToLoad) {
    content = [...Array(numToLoad).keys()].map(i => (
      <TableRow key={i} className={classes.row}>
        <TableCell>
          <LoadingShimmer />
        </TableCell>
      </TableRow>
    ));
  }
  return (
    <TableContainer>
      <Table className={classes.table} size="small">
        <TableBody>{content}</TableBody>
      </Table>
    </TableContainer>
  );
};
