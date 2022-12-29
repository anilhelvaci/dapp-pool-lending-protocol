# Bytepitch & Agoric - Lending Protocol

## Setup

Please make sure you install the agoric-sdk first.

### IMPORTANT - Agoric SDK
1. Clone the agoric SDK repository (`git clone https://github.com/Agoric/agoric-sdk`)
2. `cd agoric-sdk`
3. `git checkout 65d3f14c8102993168d2568eed5e6acbcba0c48a`
4. Now, do:
   1. `yarn install`
   2. `yarn build`
   3. `yarn link-cli ~/bin/agoric` (or other directory you might prefer)
5. Build the `cosmic-swingset` package.
     ```shell
     cd agoric-sdk/packages/cosmic-swingset && make
     # Display the directory that should be in your $PATH.
     echo ${GOBIN-${GOPATH-$HOME/go}/bin}
     # Attempt to run a binary that was installed there.
     ag-cosmos-helper version --long
    ```
    
### Lending Protocol

1. Clone this repository `git clone https://github.com/anilhelvaci/dapp-pool-lending-protocol/`
2. cd `dapp-pool-lending-protocol`
3. Install dependencies `agoric install`
4. Verify all went well:
   > Due to some problem related to ava setup we can only run test when we're in the contract/ directory.
   > So you should cd to contract/ directory until this issue is resolved.
   1. `cd contract`
   2. Run `npx ava --verbose test/lendingPool/test-lendingPool.js`.

## Demo
For the demo showcased in Cosmoverse 2022, `git checkout feature/cosmoverse` and follow the steps there.
