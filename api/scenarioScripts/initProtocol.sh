!/bin/zsh

set -x
agoric deploy api/setupFaucets.js && agoric deploy api/deployLendingPool.js && POOL_KWD=VAN agoric deploy api/addNewPool.js