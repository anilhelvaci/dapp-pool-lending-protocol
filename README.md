# Bytepitch & Agoric - Lending Protocol Cosomoverse Workshop

## Setup

Please make sure you install the agoric-sdk first.

### IMPORTANT - Agoric SDK
1. Clone the agoric SDK repository (`git clone https://github.com/Agoric/agoric-sdk`)
2. `cd agoric-sdk`
3. `git checkout 75965ee3ba8e4ef42b55a710cc743ea8a874c4ef`
4. Now, do:
   1. `yarn install`
   2. `yarn build`
   3. `yarn link-cli ~/bin/agoric` (or other directory you might prefer)
5. Build the `cosmic-swingset` package. Follow the first [two steps here](https://docs.agoric.com/guides/agoric-cli/starting-multiuser-dapps.html#usage). 

### Lending Protocol

1. Clone this repository `git clone https://github.com/anilhelvaci/dapp-pool-lending-protocol/`
2. cd `dapp-pool-lending-protocol`
3. Checkout to latest feature branch `git checkout feature/cosmoverse`
4. Install dependencies `agoric install`
5. Verify all went well:
   > Due to some problem related to ava setup we can only run test when we're in the contract/ directory.
   > So you should cd to contract/ directory until this issue is resolved.
   1. `cd contract`
   2. Run `npx ava --verbose test/lendingPool/test-lendingPool.js`.

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
   export USE_MANUAL_TIMER=true
   agoric deploy contract/deploy/deploy.js
   ```
7. UI
   ```shell
   cd dapp-pool-lending-protocol/ui
   yarn start
   ```

>Wait for the deploy script to finish before you move on!

### Sources
Here is a google sheet demonstrating the protocol math => [Lending Pool Protocol Math - Cosmoverse](https://docs.google.com/spreadsheets/d/1w5MSjfWutnkDM0jkCHUewgKxAVfbsl2tUouXfrMivkc/edit?usp=sharing)
   
### Prepare Alice's Profile
1. Open a new profile from chrome
2. Copy and paste the output after running this command;
   ```shell
   agoric open --no-browser --hostport=127.0.0.1:8001 --repl
   ```
3. Open another tab and go to `local.agoric.com`, enter `http://localhost:8001` in the openin UI
4. Open a third tab and go to `http://localhost:3000`
5. Go to wallet tab and approve the LendingPool Dapp

### Prepare Bob's Profile
1. Open another new profile from chrome
2. Copy and paste the output after running this command;
   ```shell
   agoric open --no-browser --hostport=127.0.0.1:8002 --repl
   ```
3. Open another tab and go to `local.agoric.com`, enter `http://localhost:8002` in the openin UI this time
4. Open a third tab and go to `http://localhost:3000`
5. Go to wallet tab and approve the LendingPool Dapp

Once you see the purses starting with the prefix `LendingPool` you can move on.

### Steps to create the demo scenrio
1. First put some `VAN` to Alice's wallet so she can deposit into LendingPool.
   ```shell
   cd dapp-pool-lending-protocol
   agoric deploy --hostport=127.0.0.1:8001 api/addVanToWallet.js
   ```
   Check the purse balance.

2. Add some liquidity to VAN pool so that Alice can withdraw her profits when
   ```shell
   cd dapp-pool-lending-protocol
   agoric deploy api/addVanToPool.js
   ```
3. Check the pool balance on both profiles.
4. Alice deposit some `1 VAN` using the Dapp UI.
5. Check VAN Pool Balance on both tabs and ALice's profile balance in her tab.
6. Bob needs to borrow `VAN` and needs some type of protocol token to use as collateral. So he'll put some `PAN` into PAN Pool.
To do that he needs PAN in his wallet. Let's put some PAN to Bob's wallet.
   ```shell
   cd dapp-pool-lending-protocol
   agoric deploy --hostport=127.0.0.1:8002 api/addPanToWallet.js
   ```
   Check purse balance.
7. Bob deposit some `1 PAN` using the Dapp UI.
8. Check PAN Pool Balance in both tabs and Bob's profile balance in his tab.
9. Bob now borrows `VAN` against his `AgPAN`.
10. Check balances and activity tab.
     11. APY for VAN Pool should go up
11. Accrue interest. Use `ManualTimer` for that.
    ```js
    // 8000 REPL
    timer = E(home.scratch).get('timer_id')
    E(timer).tick()
    ```
12. After insterest accrued `Total Borrow`, `Exchange Rate` and `APY` of VAN Pool should go up. Also 
`Redeem Balance` of Alice should go up.
13. Bob adjusts his loan by putting `0.1 PAN` more worth of Collateral and requesting
`0.2 VAN` more.
14. `% Of Limit` on the Bob's loan should go up with this new state.
15. Bob makes a `Close Loan` offer to finish pay all his debt and receive his collateral.
16. This transaction should not go through because the interest accrued to Bob's loan made his
debt balance greater than the balance he has in his VAN purse.
17. Bob gets some VAN from the faucet. This step in real life can be anything but the most straightforward 
way to get liquidity is throguh some market like AMM.
    ```shell
    cd dapp-pool-lending-protocol
    ## Add 1 Unit of VAN
    export LIQUIDITY_AMOUNT=1 
    agoric deploy --hostport=127.0.0.1:8002 api/addVanToWallet.js
    ```
18. He tries again to close his loan
19. This time he succeeds and the total liquidity in the VAN Pool is now increased
after this closed loan.
20. Alice redeems her `VAN`
21. Creator adds a new pool to the protocol.
    ```shell
    cd dapp-pool-lending-protocol
    export USE_MANUAL_TIMER=true
    agoric deploy api/addNewPool.js
    ```
22. Bob borrows from this new pool.
23. The price of the new pool's underlyingAsset underlying asset goes up which is Bob's debt.
    ```shell
    cd dapp-pool-lending-protocol
    ## Remember to make NEW_PRICE_VAL=240n!
    agoric deploy api/setAssetPrice.js
    ```
24. Bob's loan gets liquidated. So he lost his collateral and kept the debt.











