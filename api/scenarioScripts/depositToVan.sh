!/bin/zsh

set -x
agoric deploy --hostport=127.0.0.1:8001 api/addVanToWallet.js
sleep 5
set -x
VAN_UNIT=2 agoric deploy --hostport=127.0.0.1:8001 api/depositVan.js

set -x
agoric deploy --hostport=127.0.0.1:8002 api/addVanToWallet.js
sleep 5
set -x
VAN_UNIT=1 agoric deploy --hostport=127.0.0.1:8002 api/depositVan.js

set -x
agoric deploy --hostport=127.0.0.1:8003 api/addVanToWallet.js
sleep 5
set -x
VAN_UNIT=1 agoric deploy --hostport=127.0.0.1:8003 api/depositVan.js