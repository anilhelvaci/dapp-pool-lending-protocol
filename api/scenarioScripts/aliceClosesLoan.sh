#/bin/zsh

set -x
LOAN_ID= DEBT_VAL=2000000 COL_VAL=3000000000 agoric deploy --hostport=127.0.0.1:8001 api/closeLoan.js