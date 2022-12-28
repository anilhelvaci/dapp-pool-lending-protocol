!/bin/zsh

echo 'Sending first invitation to Alice'
set -x
DEST_ADDR=$ALICE_ADDR INV_INDEX=0 agoric deploy api/sendGovInvitation.js

echo 'Sending second invitation to Alice'
set -x
DEST_ADDR=$ALICE_ADDR INV_INDEX=1 agoric deploy api/sendGovInvitation.js