import { E } from '@endo/far';

/**
 * This module brings together necessary assertions that are
 * conceptually related to make the tests more readable and maintainable.
 * @param t
 */
export const makeLendingPoolAssertions = t => {
  /**
   *
   * @param {PoolManager} poolManager
   * @param {LendingPoolPublicFacet} lendingPoolPublicFacet
   * @returns {Promise<void>}
   */
  const assertPoolAddedCorrectly = async (poolManager, lendingPoolPublicFacet) => {
    const underlyingBrand = await E(poolManager).getUnderlyingBrand();
    const [hasPool, poolManagerFromLendingPool] = await Promise.all([
      E(lendingPoolPublicFacet).hasPool(underlyingBrand),
      E(lendingPoolPublicFacet).getPool(underlyingBrand)
    ])
    t.truthy(hasPool);
    t.deepEqual(poolManagerFromLendingPool , poolManager);
  };

  /**
   *
   * @param {PoolManager} poolManager
   * @param {Amount} shouldReceviedProtocolAmount
   * @param {Amount} underlyingAmountIn
   * @param {Amount} protocolAmountReceived
   * @param {String} offerResult
   * @returns {Promise<void>}
   */
  const assertDepositedCorrectly = async (poolManager, shouldReceviedProtocolAmount, underlyingAmountIn, protocolAmountReceived, offerResult) => {
    const [actualProtocolAmount, actualUnderlyingAmount] = await Promise.all([
      E(poolManager).getProtocolLiquidity(),
      E(poolManager).getUnderlyingLiquidity(),
    ])

    t.deepEqual(protocolAmountReceived, shouldReceviedProtocolAmount);
    t.deepEqual(actualProtocolAmount, shouldReceviedProtocolAmount); // We know that initial exchange rate is 0,02
    t.deepEqual(actualUnderlyingAmount, underlyingAmountIn);
    t.is(offerResult, 'Finished');
  };

  return harden({
    assertPoolAddedCorrectly,
    assertDepositedCorrectly
  })
}