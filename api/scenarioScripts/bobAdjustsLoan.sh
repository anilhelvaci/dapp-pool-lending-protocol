#/bin/zsh

set -x
LOAN_ID= DEBT_VAL=2000000 COL_VAL=2500000000 agoric deploy --hostport=127.0.0.1:8002 api/adjust/giveColGetDebt.js