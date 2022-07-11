# Bytepitch & Agoric - Lending Protocol

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
3. Checkout to latest feature branch `git checkout review`
4. Install dependencies `agoric install`
5. Verify all went well:
   > Due to some problem related to ava setup we can only run test when we're in the contract/ directory.
   > So you should cd to contract/ directory until this issue is resolved.
   1. `cd contract`
   2. Run `npx ava --verbose test/lendingPool/test-lendingPool.js`. 17 tests should pass

> UI Client is under development in another branch. The UI code in this branch
> is the one inherited from the dapp-treasury. 