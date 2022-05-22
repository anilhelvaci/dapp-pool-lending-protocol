# Bytepitch & Agoric - Lending Protocol

## Setup

Please make sure you install the agoric-sdk first.

> This branch assumes that you are using the Agoric version 0.15.1. If you wish to try this repo
> out in a later time and the sdk version went up from 0.15.1, please check out the below commit hash
> and build the sdk from there. 
> 1. Do this before the third step of the section below
>    1. git checkout `922d4c0bd566d8e8a3918fc9c6696031e130637e`

### IMPORTANT - Agoric SDK
1. Clone the agoric SDK repository (`git clone https://github.com/Agoric/agoric-sdk`)
2. `cd agoric-sdk`
3. Now, do:
   1. `yarn install`
   2. `yarn build`
   3. `yarn link-cli ~/bin/agoric` (or other directory you might prefer)

### Lending Protocol

1. Clone this repository `git clone https://github.com/anilhelvaci/dapp-pool-lending-protocol/`
2. cd `dapp-pool-lending-protocol`
3. Checkout to latest feature branch `git checkout mactech`
4. Install dependencies `agoric install`
5. Verify all went well:
   1. `cd contract`
   2. Run `node node_modules/.bin/ava --verbose test/lendingPool/test-lendingPool.js --match='adjust-balances-no-interest'`. The test should pass

#### Play Around With REPL
In terminal one;

```shell
cd dapp-pool-lending-protocol
agoric start --verbose --reset
```

Now open terminal two. In terminal two;

````shell
cd dapp-pool-lending-protocol
# Once this command returns click the link and open your wallet in the browser
agoric open --repl
# Now deploy the lending protocol
agoric deploy contract/deploy/deploy.js
````

Once the deploy finished execution go the [replCommands.md](contract/deploy/replCommands.md) 
and follow the repl commands there.