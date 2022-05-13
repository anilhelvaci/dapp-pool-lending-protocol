# Bytepitch & Agoric - Lending Protocol

## Setup

You may have already installed the Agoric SDK. Unfortunately the newest version currently has an incompatibility with the lending protocol code, so we will need some extra steps to get the right version. If you don't have the agoric SDK installed, you can skip steps 1 and 2.

### IMPORTANT - Agoric SDK
1. If you have already ran `yarn install` and `yarn build` in the `agoric-sdk` directory, please delete your `agoric-sdk` directory (`sudo rm -r agoric-sdk`).
2. Delete the `cli-link` to agoric's CLI, if you have linked it, `sudo rm <path to agoric binary>` (e.g: `sudo rm ~/bin/agoric`)
3. Clone the agoric SDK repository (`git clone https://github.com/Agoric/agoric-sdk`)
4. `cd agoric-sdk`
5. Check out to the commit hash with the version we need: `git checkout 0ef67d04da3610ea1777b961589a396e835fe637`
6. Now, do:
   1. `yarn install`
   2. `yarn build`
   3. `yarn link-cli ~/bin/agoric` (or other directory you might prefer)

**NOTE:** If, after the workshop, you wish to return to the latest beta version, just do the same as we did above but checkout to `beta` instead of `0ef67d04da3610ea1777b961589a396e835fe637`

### Lending protocol

1. Clone this repository `git clone https://github.com/anilhelvaci/dapp-pool-lending-protocol/`
2. cd `dapp-pool-lending-protocol`
3. Checkout to latest feature branch `git checkout feature/bootstrap-protocol`
4. Install dependencies `agoric install`
5. Verify all went well:
   1. `cd contract`
   2. Run `node node_modules/.bin/ava --verbose test/lendingPool/test-lendingPool.js --match='adjust-balances-no-interest'`. The test should pass
