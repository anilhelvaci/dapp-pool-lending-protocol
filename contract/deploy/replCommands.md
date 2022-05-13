## Agoric Wallet REPL Command Reference For LendingPool Protocol
> It is assumed that you have used the ./deploy.js script 
###Deposit
Get the issuer and the brand of the asset you want to deposit. The boardID used here is the value of **VAN_ISSUER_BOARD_ID** in the 
deploy.js console output.
````js
command[0] E(home.board).getValue("board00126")
// get brand
history[0] E(history[0]).getBrand() // history[0] holds what is returned from command[0]
````

Get the Lending Pool Public facet. The boardID used here is the value of **LENDING_POOL_INSTANCE_BOARD_ID** in the
deploy.js console output.
````js
command[3] lendingPoolInstance = E(home.board).getValue("board06120")
// get PoolManager for Van underlying asset using the asset's brand
command[5] vanPoolMan = E(lendingPoolPublicFaucet).getPool(history[2])
// check the methods of the PoolManager
command[6] E(vanPoolMan).afklklf()
history[6] Promise.reject("TypeError: target has no method \"afklklf\", has [\"enoughLiquidityForProposedDebt\",\"getChargingPeriod\",\"getCollateralQuote\",\"getCurrentBorrowingRate\",\"getExchangeRate\",\"getInitialExchangeRate\",\"getInterestRate\",\"getLiquidationMargin\",\"getLoanFee\",\"getPriceAuthorityForBrand\",\"getProtocolAmountOut\",\"getProtocolBrand\",\"getProtocolIssuer\",\"getProtocolLiquidity\",\"getRecordingPeriod\",\"getThirdCurrencyBrand\",\"getTotalDebt\",\"getUnderlyingLiquidity\",\"makeBorrowKit\",\"makeDepositInvitation\",\"makeVaultKit\"]")
````

Start building the offerConfig. installationHandleBoardId = **LENDING_POOL_INSTALL_BOARD_ID** and instanceHandleBoardId = **LENDING_POOL_INSTANCE_BOARD_ID**
from the deploy.js console output. offerConfig.id is set randomly.
````js
// build the proposal template

// the pursePetnames used here are set in the ./deploy.js
command[9] proposalWantKeywordRecord = {Protocol: {pursePetname: 'AgVAN Purse', value: 1n * 10n ** 8n * 50n}}
history[9] {"Protocol":{"pursePetname":"AgVAN Purse","value":5000000000n}}

command[10] proposalGiveKeywordRecord = {Underlying: {pursePetname: 'VAN Purse', value: 1n * 10n ** 8n}}
history[10] {"Underlying":{"pursePetname":"VAN Purse","value":100000000n}}

command[11] proposalTemplate = {want: proposalWantKeywordRecord, give: proposalGiveKeywordRecord }
history[11] {"want":{"Protocol":{"pursePetname":"AgVAN Purse","value":5000000000n}},"give":{"Underlying":{"pursePetname":"VAN Purse","value":100000000n}}}

// the numbers used for give and want keyword records are calculated using the initial excahange rate between
// the underlying asset and its protocol token which is 0.02 for every pool  
command[12] offerConfig = {id: '1652472356759', installationHandleBoardId: 'board02021',  instanceHandleBoardId: 'board06120', proposalTemplate}
history[12] {"id":"1652472356759","installationHandleBoardId":"board02021","instanceHandleBoardId":"board06120","proposalTemplate":{"want":{"Protocol":{"pursePetname":"AgVAN Purse","value":5000000000n}},"give":{"Underlying":{"pursePetname":"VAN Purse","value":100000000n}}}}

// set the invitation for the deposit offer
command[13] E(vanPoolMan).makeDepositInvitation().then(invitation => offerConfig.invitation = invitation)
history[13] [Object Alleged: Zoe Invitation payment]{}

// check offerConfig
command[14] offerConfig
history[14] {"id":"1652472356759","installationHandleBoardId":"board02021","instanceHandleBoardId":"board06120","proposalTemplate":{"want":{"Protocol":{"pursePetname":"AgVAN Purse","value":5000000000n}},"give":{"Underlying":{"pursePetname":"VAN Purse","value":100000000n}}},"invitation":[Object Alleged: Zoe Invitation payment]{}}
````

Send the offer
````js
// get a reference for walletBridge
command[15] wb = E(home.wallet).getBridge()
history[15] [Object Alleged: preapprovedBridge]{}

// make the offer
command[16] E(wb).addOffer(offerConfig)
history[16] "1652472356759" // offerId is returned
````

After command[16] you should see the offer in your dashboard. Accept wait for the transaction to go through.

Below are some methods for intrracting with the pool.
````js
command[20] E(vanPoolMan).getExchangeRate()
history[20] {"denominator":{"brand":[Object Alleged: AgVAN brand]{},"value":10000n},"numerator":{"brand":[Object Alleged: VAN brand]{},"value":200n}}
command[21] E(vanPoolMan).getCurrentBorrowingRate()
history[21] {"denominator":{"brand":[Object Alleged: VAN brand]{},"value":10000n},"numerator":{"brand":[Object Alleged: VAN brand]{},"value":250n}}
command[22] E(vanPoolMan).getRecordingPeriod()
history[22] 604800n
command[23] E(vanPoolMan).getUnderlyingLiquidity()
history[23] 200000000n
command[24] E(vanPoolMan).getProtocolLiquidity()
history[24] 10000000000n
````