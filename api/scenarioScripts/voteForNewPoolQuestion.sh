!/bin/zsh

set -x
echo 'Bob votes Against by locking 40k' &&
LOCK_VAL_UNIT=40000 POSITION=0 agoric deploy --hostport=127.0.0.1:8002 api/voteOnQuestion.js

set -x
echo 'Maggie votes For by locking 20k' &&
LOCK_VAL_UNIT=20000 POSITION=1 agoric deploy --hostport=127.0.0.1:8003 api/voteOnQuestion.js