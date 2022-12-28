!/bin/zsh

set -x
agoric deploy --hostport=127.0.0.1:8001 api/fetchGovTokens.js

set -x
agoric deploy --hostport=127.0.0.1:8001 api/fetchGovTokens.js

set -x
agoric deploy --hostport=127.0.0.1:8002 api/fetchGovTokens.js

set -x
agoric deploy --hostport=127.0.0.1:8002 api/fetchGovTokens.js

set -x
agoric deploy --hostport=127.0.0.1:8003 api/fetchGovTokens.js