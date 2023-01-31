#/bin/zsh

agoric deploy --hostport=127.0.0.1:8001 api/addVanToWallet.js &&
agoric deploy --hostport=127.0.0.1:8002 api/addPanToWallet.js &&
agoric deploy api/addVanToWallet.js api/addVanToPool.js