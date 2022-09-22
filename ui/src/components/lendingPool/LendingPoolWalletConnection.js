import { makeAsyncIterableFromNotifier as iterateNotifier } from "@agoric/notifier";
import React, { useEffect } from "react";
import { setApproved, setConnected } from "../../store";

import {
  activateWebSocket,
  deactivateWebSocket,
  getActiveSocket,
} from "./fetch-websocket";
import { makeCapTP } from "@endo/captp";
import { Far } from "@endo/far";

const LendingPoolWalletConnection = ({ setWalletP, dispatch }) => {
  useEffect(() => {
    // Receive callbacks from the wallet connection.
    const otherSide = Far("otherSide", {
      needDappApproval(_dappOrigin, _suggestedDappPetname) {
        dispatch(setApproved(false));
      },
      dappApproved(_dappOrigin) {
        dispatch(setApproved(true));
      },
    });

    let walletAbort;
    let walletDispatch;

    const onConnect = async () => {
      dispatch(setConnected(true));
      const socket = getActiveSocket();
      const {
        abort: ctpAbort,
        dispatch: ctpDispatch,
        getBootstrap,
      } = makeCapTP(
        "Lending Pool",
        (obj) => socket.send(JSON.stringify(obj)),
        otherSide,
      );
      walletAbort = ctpAbort;
      walletDispatch = ctpDispatch;
      const walletP = getBootstrap();
      setWalletP(walletP);

    };

    const onDisconnect = () => {
      dispatch(setConnected(false));
      walletAbort && walletAbort();
    };

    const onMessage = (data) => {
      const obj = JSON.parse(data);
      walletDispatch && walletDispatch(obj);
    };

    activateWebSocket({
      onConnect,
      onDisconnect,
      onMessage,
    });
    return deactivateWebSocket;
  }, []);

  return(
    <div style={{ display: "none" }}></div>
  )
};

export default LendingPoolWalletConnection;