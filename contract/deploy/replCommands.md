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

### Borrow
Now let's borrow some money

All board IDs you see here is taken from the console output of the ./deploy.js.

````js
// Get Brands and issuers

// VAN
command[24] E(home.board).getValue("board00443")
history[24] [Object Alleged: VAN issuer]{}
command[25] vanIssuer = history[24]
history[25] [Object Alleged: VAN issuer]{}
command[26] E(vanIssuer).getBrand()
history[26] [Object Alleged: VAN brand]{}
command[27] vanBrand = history[26]
history[27] [Object Alleged: VAN brand]{}

// PAN
command[28] E(home.board).getValue("board01744")
history[28] [Object Alleged: PAN issuer]{}
command[29] panIssuer = history[28]
history[29] [Object Alleged: PAN issuer]{}
command[30] E(panIssuer).getBrand()
history[30] [Object Alleged: PAN brand]{}
command[31] panBrand = history[30]
history[31] [Object Alleged: PAN brand]{}

// Get lendingPoolPublicFacet
command[21] E(home.board).getValue("board02437")
history[21] [Object Alleged: InstanceHandle]{}
command[22] E(home.zoe).getPublicFacet(history[21])
history[22] [Object Alleged: lending pool public facet]{}
command[23] lendingPoolPublicFacet = history[22]
history[23] [Object Alleged: lending pool public facet]{}

// Get the wallet bridge
command[21] wb = E(home.wallet).getBridge()
history[21] [Object Alleged: preapprovedBridge]{}

// Build the proposal
command[8] borrowProposalTemplate = { want: { Debt: { pursePetname: 'PAN Purse', value: 4n * 10n ** 6n, }, }, give: { Collateral: { pursePetname: 'AgVAN Purse', value: 1n * 10n ** 8n * 50n, }, }, arguments: { collateralUnderlyingBrand: vanBrand, }, }
history[8] {"want":{"Debt":{"pursePetname":"PAN Purse","value":4000000n}},"give":{"Collateral":{"pursePetname":"AgVAN Purse","value":5000000000n}},"arguments":{"collateralUnderlyingBrand":[Object Alleged: VAN brand]{}}}

// Prepare other parameters for offerConfig
command[15] id= "421409128"
history[15] "421409128"

command[11] installationHandleBoardId="board06120"
history[11] "board06120"

command[13] instanceHandleBoardId="board04719"
history[13] "board04719"

command[16] offerConfig = {id, installationHandleBoardId, instanceHandleBoardId, proposalTemplate: borrowProposalTemplate}
history[16] {"id":"421409128","installationHandleBoardId":"board06120","instanceHandleBoardId":"board04719","proposalTemplate":{"want":{"Debt":{"pursePetname":"PAN Purse","value":4000000n}},"give":{"Collateral":{"pursePetname":"AgVAN Purse","value":5000000000n}},"arguments":{"collateralUnderlyingBrand":[Object Alleged: VAN brand]{}}}}

// Get the invitation for borrow, the last offerConfig parameter
command[20] E(lendingPoolPublicFacet).makeBorrowInvitation().then(invitation => offerConfig.invitation = invitation)
history[20] [Object Alleged: Zoe Invitation payment]{}

// Send the offer
command[24] E(wb).addOffer(offerConfig)
history[24] "421409128"

// Check offer result
command[25] E(home.wallet).lookup("offerResult", "unknown#421409128")
history[25] {"assetNotifier":[Object Alleged: notifier]{},"invitationMakers":[Object Alleged: invitation makers]{},"vault":[Object Alleged: vault]{},"vaultNotifier":[Object Alleged: notifier]{},"vaultUpdater":[Object Alleged: updater]{}}

// Get PAN Pool Manager
command[30] E(lendPublicFacet).getPool(panBrand)
history[30] [Object Alleged: vault manager]{}
command[31] panPoolMan = history[30]
history[31] [Object Alleged: vault manager]{}

// Check the parameters
command[59] E(panPoolMan).getTotalDebt()
history[59] {"brand":[Object Alleged: PAN brand]{},"value":4003920n}
command[60] E(panPoolMan).getCurrentBorrowingRate()
history[60] {"denominator":{"brand":[Object Alleged: PAN brand]{},"value":10000n},"numerator":{"brand":[Object Alleged: PAN brand]{},"value":259n}}
command[61] E(panPoolMan).getExchangeRate()
history[61] {"denominator":{"brand":[Object Alleged: AgPAN brand]{},"value":10000n},"numerator":{"brand":[Object Alleged: PAN brand]{},"value":201n}}
````