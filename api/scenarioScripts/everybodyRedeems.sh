!/bin/zsh

set -x
echo 'Bob is redeeming 40k units of LPT Tokens...' &&
 REDEEM_VAL_UNIT=40000 agoric deploy --hostport=127.0.0.1:8002 api/redeemPop.js

set -x
echo 'Alice is redeeming 40k units of LPT Tokens...' &&
  REDEEM_VAL_UNIT=40000 agoric deploy --hostport=127.0.0.1:8001 api/redeemPop.js

set -x
echo 'Maggie is redeeming 20k units of LPT Tokens...' &&
  REDEEM_VAL_UNIT=20000 agoric deploy --hostport=127.0.0.1:8003 api/redeemPop.js
