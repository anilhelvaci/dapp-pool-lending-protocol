!/bin/zsh

set -x
agoric deploy api/askPoolQuestion/addNewPriceAuthToMan.js
sleep 3
set -x
agoric deploy --hostport=127.0.0.1:8001 api/askPoolQuestion/addQuestionNewPool.js