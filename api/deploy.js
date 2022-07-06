import addPanToWallet from "./addPanToWallet";
import addPanToPool from "./addPanToPool";
import addVanToWallet from "./addVanToWallet";
import addVanToPool from "./addVanToPool";

export default async function deploy(homeP) {
  await Promise.all([
      addPanToWallet(homeP),
      addPanToPool(homeP),
      addVanToWallet(homeP),
      addVanToPool(homeP),
    ],
  );
}