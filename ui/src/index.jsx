/* eslint-disable import/no-extraneous-dependencies */
import '@endo/eventual-send/shim.js';
import React from 'react';
import { createRoot } from 'react-dom/client';

import ApplicationContextProvider from './contexts/Application';
import App from './pages/App';

const container = document.getElementById('root');
const root = createRoot(container);

root.render(
  <ApplicationContextProvider>
    <App />
  </ApplicationContextProvider>,
);
