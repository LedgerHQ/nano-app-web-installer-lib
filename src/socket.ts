import { StatusCodes } from '@ledgerhq/hw-transport';
import WS from 'isomorphic-ws';


export const createSocket = async ({ url, transport }): Promise<void> => {
  const ws = new WS(url);
  let inBulkMode = false;

  const onDisconnect = (e): void => {
    transport.off('disconnect', onDisconnect);
    throw Error(e);
  };

  const onUnresponsiveDevice = (): void => {
    // Nb Don't consider the device as locked if we are in a blocking apdu exchange, ie
    // one that requires user confirmation to complete.
    if (inBulkMode) return;

    throw new Error('ManagerDeviceLockedError');
  };

  transport.on('disconnect', onDisconnect);
  transport.on('unresponsive', onUnresponsiveDevice);

  ws.onerror = (e: WS.ErrorEvent): void => {
    if (inBulkMode) return; // in bulk case,
    throw new Error(String(e));
  };

  ws.onclose = (): void => {
    if (inBulkMode) return; // in bulk case, we ignore any network events because we just need to unroll APDUs with the device
  };

  ws.onmessage = async (e): Promise<void> => {
    try {
      const input = JSON.parse(String(e.data));
      switch (input.query) {
        case 'exchange': {
          // a single ping-pong apdu with the HSM
          const { nonce } = input;
          const apdu = Buffer.from(input.data, 'hex');
          // Detect the specific exchange that triggers the allow secure channel request.
          let pendingUserAllowSecureChannel = false;

          if (apdu.slice(0, 2).toString('hex') === 'e051') {
            pendingUserAllowSecureChannel = true;
          }

          const r = await transport.exchange(apdu);
          //   if (unsubscribed) return;
          const status = r.readUInt16BE(r.length - 2);

          let response;
          switch (status) {
            case StatusCodes.OK:
              response = 'success';
              break;

            case StatusCodes.LOCKED_DEVICE:
              throw new Error(`new TransportStatusError(${status})`);

            case StatusCodes.USER_REFUSED_ON_DEVICE:
            case StatusCodes.CONDITIONS_OF_USE_NOT_SATISFIED:
              if (pendingUserAllowSecureChannel) {
                throw new Error(`new UserRefusedAllowManager()`);
              }
            break;
            default:
              // Nb Other errors may not throw directly, we will instead keep track of
              // them and throw them if the next event from the ws connection is a disconnect
              // otherwise, we clear them.
              response = 'error';
              throw new Error(
                `deviceError = new TransportStatusError(${status})`,
              );
          }
          const data = r.slice(0, r.length - 2);

          const msg = {
            nonce,
            response,
            data: data.toString('hex'),
          };

          const strMsg = JSON.stringify(msg);
          ws.send(strMsg);
          break;
        }

        case 'bulk': {
          // in bulk, we just have to unroll a lot of apdus, we no longer need the WS
          //   ws.close();
          const { data } = input;
          inBulkMode = true;

          for (let i = 0; i < data.length; i++) {
            const r = await transport.exchange(Buffer.from(data[i], 'hex'));
            const status = r.readUInt16BE(r.length - 2);
            if (status !== StatusCodes.OK) {
              throw new Error(status);
            }
          }

          break;
        }

        case 'success': {
          break;
        }

        case 'error': {
          throw new Error(input.data);
        }

        case 'warning': {
          // a warning from HSM
          console.warn({
            type: 'warning',
            message: input.data,
          });
          break;
        }

        default:
          console.warn(`Cannot handle msg of type ${input.query}`, {
            query: input.query,
            url,
          });
      }
    } catch (e) {
      console.log(e);
    }
  };
};
