import addPanToWallet from "./addPanToWallet.js";
import addPanToPool from "./addPanToPool.js";
import addVanToWallet from "./addVanToWallet.js";
import addVanToPool from "./addVanToPool.js";

export default async function deploy(homeP) {
  await Promise.all([
      addPanToWallet(homeP),
      addPanToPool(homeP),
      addVanToWallet(homeP),
      addVanToPool(homeP),
    ],
  );
}