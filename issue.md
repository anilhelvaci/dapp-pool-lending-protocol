## Describe the bug
Say we have two pools in the multipoolMarketMaker.js like Moola/CentralBrand and Simolean/CentralBrand. 
When I try to find out how much Moola I need to put in order to extract 4000 Simoleans by 
doing `E(amm.ammPublicFacet).getOutputPrice(AmountMath.makeEmpty(moolaR.brand), simoleans(4000n))` I get this error message: 
```shell
RangeError {
message: 'Brands in left "[Alleged: simoleans brand]" and right "[Alleged: moola brand]" should match but do not',
}
``` 

`provideVPool` method of the `multipoolMarketMaker.js` returns a `doublePool.js` instance if both the amountIn.brand and amountOut.brand
are secondary brands. The error only occurs when we call the `getPriceForOutput` method of the `doublePool.js` instance 
and not occur if we are to call `getPriceForOutput` of `singlePool` instance. Below is the stack trace:

```
Temporary logging of sent error (RangeError#1)
RangeError#1: Brands in left Object [Alleged: simoleans brand] {} and right Object [Alleged: moola brand] {} should match but do not
  at checkLRAndGetHelpers (.../ertp/src/amountMath.js:161:8)
  at Object.isGTE (.../ertp/src/amountMath.js:303:9)
  at isWantedAvailable (.../run-protocol/src/vpool-xyk-amm/constantProduct/swap.js:109:13)
  at swap (.../run-protocol/src/vpool-xyk-amm/constantProduct/swap.js:197:5)
  at eval (.../run-protocol/src/vpool-xyk-amm/constantProduct/calcSwapPrices.js:27:14)
  at pricesForStatedOutput (.../run-protocol/src/vpool-xyk-amm/constantProduct/calcSwapPrices.js:73:8)
  at Alleged: double pool.getPriceForOutput (.../run-protocol/src/vpool-xyk-amm/doublePool.js:145:20)
  at Alleged: publicFacet.getOutputPrice (.../run-protocol/src/vpool-xyk-amm/multipoolMarketMaker.js:212:26)
```

## To Reproduce
Steps to reproduce the behavior:
1. `cd agoric-sdk/packages/run-protocol`
2. open `./test/amm/vpool-xyk-amm/test-xyk-amm-swap.js`
3. Find the test named: `amm doubleSwap`
4. Add below code to the line 555
    > The line number here is correct for the commit hash `922d4c0bd566d8e8a3918fc9c6696031e130637e` if you test in another
    > version line numbers might not hold. 
   ````js
    const prices = await E(amm.ammPublicFacet).getOutputPrice(
    AmountMath.makeEmpty(moolaR.brand),
    simoleans(4000n),
    );
    ````

5. Or add a ``stopAfter`` to the `swapIn` offer, for instance:
    ```js
    const bobSeat1 = await E(zoe).offer(
    bobInvitation,
    bobSimsForMoolaProposal,
    simsForMoolaPayments,
    {stopAfter: moola(2000n)}
    );
    ```

6. Run ``npx ava test/amm/vpool-xyk-amm/test-xyk-amm-swap.js --match="amm doubleSwap"``
7. See the error 


## Expected behavior
I want to know exactly how much I should put in order to receive a certain amount of fungible asset where both 
amountIn.brand and amountOut.brand are secondary brands. Therefore I expect `getPriceForOutput` method of the `doublePool.js` instance
should work without throwing an error.

## Platform Environment
 - OS: MacOs Monterey Version 12.2.1
 - Node.js Version 14.19.2
 - Agoric-SDK Version: agoricdev-12-73-g922d4c0bd

## Additional context
I opened this issue on behalf of the conversation we had wiht @dckc on the discord #dev channel.


