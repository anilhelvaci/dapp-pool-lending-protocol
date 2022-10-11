import React from 'react';

import { CssBaseline } from '@material-ui/core';
import { createTheme, ThemeProvider } from '@material-ui/core/styles';

import Top from './Top';

const theme = createTheme({
  palette: {
    primary: {
      main: 'rgb(215, 50, 82)', // pink-red
    },
    secondary: {
      main: '#3BC7BE', // baby-blue
    },
    error: { main: '#bb2947' }, // deep-red
    warning: { main: '#bb2947' }, // golden
    info: {
      main: '#FFE798', // yellow
    },
    success: {
      main: '#00b1a6', // green
    },
    background: {
      default: '#ffffff00',
    },
  },
  overrides: {
    MuiStepIcon: {
      root: {
        '&$active': {
          color: '#3BC7BE',
        },
        '&$completed': {
          color: '#3BC7BE',
        },
      },
    },
  },
  typography: {
    fontFamily: [
      '"Inter"',
      '"Roboto"',
      '"Helvetica"',
      '"Arial"',
      'sans-serif',
    ].join(','),
    fontWeightRegular: 500,
  },
});

function App() {
  return (
    <>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Top />
      </ThemeProvider>
    </>
  );
}

export default App;
