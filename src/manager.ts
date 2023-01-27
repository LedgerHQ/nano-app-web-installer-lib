import axios from 'axios';
import { createSocket } from './socket.js';
import Transport from '@ledgerhq/hw-transport';
import {
  Application,
  ApplicationVersion,
  DeviceInfo,
  DeviceVersion,
  FinalFirmware,
  Id,
} from '@ledgerhq/types-live';
import { FirmwareNotRecognized } from '@ledgerhq/errors';

const getTargetId = async (transport: Transport): Promise<number> => {
  const res = await transport.send(0xe0, 0x01, 0x00, 0x00);
  const data = res.slice(0, res.length - 2);

  // parse the target id of either BL or SE
  const targetId = data.readUIntBE(0, 4);
  return targetId;
};

export const getAppsList = async (): Promise<Application[]> => {
  const { data } = await axios<Application[]>({
    method: 'GET',
    url: 'https://manager.api.live.ledger.com/api/applications',
  });

  if (!data || !Array.isArray(data)) {
    throw new Error('Manager api down');
  }

  return data;
};

export const installApp = async (
  app,
  transport: Transport,
  isDelete: boolean,
): Promise<void> => {
  const url = new URL(`wss://scriptrunner.api.live.ledger.com/update/install`);

  url.searchParams.append('targetId', String(await getTargetId(transport)));
  url.searchParams.append('perso', app.perso);
  url.searchParams.append('deleteKey', app.delete_key);
  url.searchParams.append('firmware', isDelete ? app.delete : app.firmware);
  url.searchParams.append(
    'firmwareKey',
    isDelete ? app.delete_key : app.firmware_key,
  );
  url.searchParams.append('hash', app.hash);

  await createSocket({
    transport,
    url,
  });
};

const getDeviceVersion = async (
  targetId: string | number,
  provider: number,
): Promise<DeviceVersion> => {
  const url = new URL(
    `wss://scriptrunner.api.live.ledger.com/update/get_device_version`,
  );

  const {
    data,
  }: {
    data: DeviceVersion;
  } = await axios
    .post(url.toString(), {
      provider,
      target_id: targetId,
    })
    .catch((error) => {
      const status =
        error && (error.status || (error.response && error.response.status)); // FIXME LLD is doing error remapping already. we probably need to move the remapping in live-common

      if (status === 404) {
        throw new FirmwareNotRecognized(
          'manager api did not recognize targetId=' + targetId,
          {
            targetId,
          },
        );
      }

      throw error;
    });
  return data;
};

const getCurrentFirmware = async (
  version: string,
  deviceId: string | number,
  provider: number,
): Promise<FinalFirmware> => {
  const url = new URL(
    `wss://scriptrunner.api.live.ledger.com/update/get_device_version`,
  );

  const {
    data,
  }: {
    data: FinalFirmware;
  } = await axios.post(url.toString(), {
    device_version: deviceId,
    version_name: version,
    provider: provider,
  });
  return data;
};

const applicationsByDevice = async (
  device_version: Id,
  current_se_firmware_final_version: Id,
  provider: number,
): Promise<ApplicationVersion[]> => {
  const url = new URL(`wss://scriptrunner.api.live.ledger.com/update/get_apps`);

  const {
    data,
  }: {
    data: { application_versions: ApplicationVersion[] };
  } = await axios.post(url.toString(), {
    device_version: device_version,
    current_se_firmware_final_version: current_se_firmware_final_version,
    provider: provider,
  });
  return data.application_versions;
};

export const getAppsListByDevice = async (
  deviceInfo: DeviceInfo,
  isDevMode = false, // TODO getFullListSortedCryptoCurrencies can be a local function.. too much dep for now
  provider: number,
): Promise<ApplicationVersion[]> => {
  if (deviceInfo.isOSU || deviceInfo.isBootloader) return Promise.resolve([]);
  const deviceVersionP = getDeviceVersion(deviceInfo.targetId, provider);
  const firmwareDataP = deviceVersionP.then((deviceVersion) =>
    getCurrentFirmware(String(deviceVersion.id), deviceInfo.version, provider),
  );
  const applicationsByDeviceP = Promise.all([
    deviceVersionP,
    firmwareDataP,
  ]).then(([deviceVersion, firmwareData]) =>
    applicationsByDevice(firmwareData.id, deviceVersion.id, provider),
  );
  const [applicationsList, compatibleAppVersionsList] = await Promise.all([
    getAppsList(),
    applicationsByDeviceP,
  ]);
  const filtered = isDevMode
    ? compatibleAppVersionsList.slice(0)
    : compatibleAppVersionsList.filter((version) => {
        const app = applicationsList.find((e) => e.id === version.app);

        if (app) {
          return app.category !== 2;
        }

        return false;
      });
  return filtered;
};
