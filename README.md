# Bytepitch & Agoric - Lending Protocol Cosomoverse Workshop

## Setup

Please make sure you install the agoric-sdk first.

### IMPORTANT - Agoric SDK
1. Clone the agoric SDK repository (`git clone https://github.com/Agoric/agoric-sdk`)
2. `cd agoric-sdk`
3. `git checkout beta`
4. Now, do:
   1. `yarn install`
   2. `yarn build`
   3. `yarn link-cli ~/bin/agoric` (or other directory you might prefer)

### Lending Protocol

1. Clone this repository `git clone https://github.com/anilhelvaci/dapp-pool-lending-protocol/`
2. cd `dapp-pool-lending-protocol`
3. Checkout to latest feature branch `git checkout feature/cosmoverse`
4. Install dependencies `agoric install`
5. Verify all went well:
   > Due to some problem related to ava setup we can only run test when we're in the contract/ directory.
   > So you should cd to contract/ directory until this issue is resolved.
   1. `cd contract`
   2. Run `npx ava --verbose test/lendingPool/test-lendingPool.js`. 17 tests should pass

## Demo

### Running the demo

Open 7 terminal windows

1. Start the local chain
   ```shell
   cd agoric-sdk/packages/cosmic-swingset
   make scenario2-setup BASE_PORT=8000 NUM_SOLOS=3
   make scenario2-run-chain
   ```
   Wait until you see `commit` messages in the console. Then move to the second terminal window. 
2. Start the first `ag-solo`
   ```shell
   cd agoric-sdk/packages/cosmic-swingset
   make scenario2-run-client BASE_PORT=8000
   ```
3. Start the second `ag-solo`
   ```shell
   cd agoric-sdk/packages/cosmic-swingset
   make scenario2-run-client BASE_PORT=8001 SOLO_OTEL_EXPORTER_PROMETHEUS_PORT=9466
   ```
4. Start the third `ag-solo`
   ```shell
   cd agoric-sdk/packages/cosmic-swingset
   make scenario2-run-client BASE_PORT=8002 SOLO_OTEL_EXPORTER_PROMETHEUS_PORT=9467
   ```
5. CLI for opening the wallets
   ```shell
   cd agoric-sdk/packages/cosmic-swingset/t1
   agoric open --no-browser --repl
   agoric open --no-browser --hostport=127.0.0.1:8001 --repl
   agoric open --no-browser --hostport=127.0.0.1:8002 --repl
   ```
6. CLI for deploying the contracts
   ```shell
   cd dapp-pool-lending-protocol
   agoric deploy contract/deploy/deploy.js
   ```
7. UI
   ```shell
   cd dapp-pool-lending-protocol/ui
   yarn start
   ```















