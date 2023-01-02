# Sample Scenario
Below is sample scenario that showcases the new features described in [Work Plan](https://github.com/anilhelvaci/dapp-pool-lending-protocol/wiki/Work-Plan-For-Expand-Specification).

## Setup
Make sure you follow the [installation steps](https://github.com/anilhelvaci/dapp-pool-lending-protocol/tree/feature/expanded-demonstrate#setup) before 
you move on.

## Actors
* Creator
* Alice
* Bob
* Maggie

## Overview
1. Creator deploys lending pool contract
2. Creator adds VAN Pool
     * Col limit = 1k Units
3. Creator sends gov invitations to Alice, Bob and Maggie
     * Alice gets 2 invitations
     * Bob gets 2 invitations
     * Maggie gets 1 invitation
4. Alice, Bob and Maggie fetch their gov tokens
5. Alice asks a question to add PAN Pool
     * Votes
     * Locks 40k LPT tokens
6. Bob votes 'Against' 
     * Locks 40k LPT tokens
7. Maggie votes 'For'
     * Locks 20k LPT tokens
8. Time passes and voting deadline is reached
9. Outcome is positive
10. Everybody redeems their POP tokens
11. Alice tries to borrow from new pool, fail.
     * Allowed collateral limit is exceeded.
12. Creator increases the collateral limit to 7_001n units.
13. Alice tries to borrow again, fail again.
     * PAN is not marked as BORROWABLE
14. Creator marks PAN as BORROWABLE.
15. Alice tries to borrow again, fail again.
16. VAN is not marked USABLE_AS_COLLATERAL
17. Creator marks the collateral brand USABLE_AS_COLLATERAL.
18. Alice tries to borrow again, success!
19. Bob tries to borrow, fails. Collateral limit exceeded.
20. Alice adjusts her loan by paying some debt and receiving some collateral.
21. Bob tries to borrow again, success.
22. Maggie tries to borrow, fail. Collateral limit exceeded.
23. Alice closes her loan.
24. Maggie tries again, success.
25. Bob tries to adjust his loan by giving some more collateral and asking for some debt, fail. Collateral limit exceeded.
26. Maggie gets liquidated.
27. Bob tries to adjust again, success!











