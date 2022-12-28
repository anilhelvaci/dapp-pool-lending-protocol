!/bin/zsh

echo 'Sending first invitation to Alice'
set -x
DEST_ADDR=$MAGGIE_ADDR INV_INDEX=4 agoric deploy api/sendGovInvitation.js
