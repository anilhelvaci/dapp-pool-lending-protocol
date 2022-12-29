!/bin/zsh

set -x
echo 'Sending first invitation to Alice' &&
DEST_ADDR=$ALICE_ADDR INV_INDEX=0 agoric deploy api/sendGovInvitation.js

set -x
echo 'Sending second invitation to Alice' &&
DEST_ADDR=$ALICE_ADDR INV_INDEX=1 agoric deploy api/sendGovInvitation.js

set -x
echo 'Sending first invitation to Bob' &&
DEST_ADDR=$BOB_ADDR INV_INDEX=2 agoric deploy api/sendGovInvitation.js

set -x
echo 'Sending second invitation to Bob' &&
DEST_ADDR=$BOB_ADDR INV_INDEX=3 agoric deploy api/sendGovInvitation.js

set -x
echo 'Sending first invitation to Maggie' &&
DEST_ADDR=$MAGGIE_ADDR INV_INDEX=4 agoric deploy api/sendGovInvitation.js
