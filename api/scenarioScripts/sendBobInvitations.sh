!/bin/zsh

echo 'Sending first invitation to Alice'
set -x
DEST_ADDR=$BOB_ADDR INV_INDEX=2 agoric deploy api/sendGovInvitation.js

echo 'Sending second invitation to Alice'
set -x
DEST_ADDR=$BOB_ADDR INV_INDEX=3 agoric deploy api/sendGovInvitation.js