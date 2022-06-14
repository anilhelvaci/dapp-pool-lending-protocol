#! /usr/bin/env node
/* global require __dirname */
const fs = require('fs');

const uiConfig = JSON.stringify(
  {
    ON_CHAIN_CONFIG: ['getAgoricNames', ['uiConfig', 'VaultFactory']],
    BRIDGE_URL: 'http://127.0.0.1:8000',
    CONTRACT_NAME: 'VaultFactory',
    RUN_STAKE_ON_CHAIN_CONFIG: ['getAgoricNames', ['instance', 'runStake']],
    RUN_STAKE_NAME: 'GetRUN',
  },
  undefined,
  2,
);

const defaults = `src/generated/defaults.js`;
console.log('configuring', defaults, 'for on-chain vaultFactory');
fs.writeFileSync(`${__dirname}/${defaults}`, `export default ${uiConfig};\n`);
