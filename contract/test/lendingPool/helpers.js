import { Nat } from '@agoric/nat';
import { E } from '@agoric/eventual-send';
import { AmountMath } from '@agoric/ertp';

/**
 * @param {ZoeService} zoe
 * @param {PoolManager} pm
 * @param {Mint} underlyingMint
 * @param {Amount} amountInUnit
 * @returns {Promise<{amount: Amount, payment: Payment}>}
 */
export const depositMoney = async (zoe, pm, underlyingMint, amountInUnit) => {
  const underlyingIssuer = underlyingMint.getIssuer();
  const underlyingBrand = underlyingIssuer.getBrand();
  const protocolBrand = await E(pm).getProtocolBrand();
  const protocolIssuer = await E(pm).getProtocolIssuer();
  console.log('[BRAND]:', protocolBrand);
  console.log('[ISSUER]:', protocolIssuer);
  const displayInfo = underlyingBrand.getDisplayInfo();
  const decimalPlaces = displayInfo?.decimalPlaces || 0n;
  const underlyingAmountIn = AmountMath.make(underlyingBrand, amountInUnit * 10n ** Nat(decimalPlaces));
  const protocolAmountOut = await E(pm).getProtocolAmountOut(underlyingAmountIn);
  const proposal = harden({
    give: { Underlying: underlyingAmountIn },
    want: { Protocol: protocolAmountOut },
  });

  const paymentKeywordRecord = harden({
    Underlying: underlyingMint.mintPayment(underlyingAmountIn),
  });

  const invitation = await E(pm).makeDepositInvitation();
  const seat = await E(zoe).offer(
    invitation,
    proposal,
    paymentKeywordRecord
  );

  const {
    Protocol: protocolReceived
  } = await E(seat).getPayouts();

  const protocolAmount = await E(protocolIssuer).getAmountOf(protocolReceived);
  return { payment: protocolReceived, amount: protocolAmount };
};

/**
 * Helper function to add a new pool to the protocol
 * @param zoe
 * @param rates
 * @param lendingPool
 * @param underlyingMint
 * @param underlyingKeyword
 * @param underlyingPriceAuthority
 * @returns {Promise<*>}
 */
export const addPool = async (zoe, rates, lendingPool, underlyingMint, underlyingKeyword, underlyingPriceAuthority) => {
  const underlyingIssuer = underlyingMint.getIssuer();
  const pm = await E(lendingPool).addPoolType(underlyingIssuer, underlyingKeyword, rates, underlyingPriceAuthority);

  return pm;
}