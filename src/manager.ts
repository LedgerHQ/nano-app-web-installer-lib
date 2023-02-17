import axios from 'axios';
import { createSocket } from './socket.js';
import { getDeviceInfo } from './device.js';
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

const getDeviceVersion = async (
  targetId: string | number,
  provider: number,
): Promise<DeviceVersion> => {
  const { data }: { data: DeviceVersion } = await axios("https://manager.api.live.ledger.com/api/get_device_version",
  {
    method: "POST",
    headers: {
      'Content-type': 'application/x-www-form-urlencoded',
    },
    data: JSON.stringify({
      target_id: targetId,
      provider,
    })
  }).catch((error) => {
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
    `https://manager.api.live.ledger.com/api/get_firmware_version`,
  );
  const { data }: {
    data: FinalFirmware;
  } = await axios(url.toString(), {
    method: "POST",
    headers: {
      'Content-type': 'application/x-www-form-urlencoded',
    },
    data: JSON.stringify({
      device_version: deviceId,
      version_name: version,
      provider: 1,
    })
  });
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

/**
 * Helper to install an app to nano using only its name
 * @param appName: string name of your apps
 * @param transport object return by ledgerhq/hw-transport when connected to a Nano device
 * @param isDelete: boolean set to true to uninstall
 */
export const installAppByName = async (
  appName: string,
  transport: Transport,
  isDelete: boolean = false,
): Promise<void> => {

  // get info about the device to fetch its app
  const deviceInfo = await getDeviceInfo(transport);
  // load all app available for device
  const appByDevice = await getAppsListByDevice(deviceInfo, false, 1);
  // find the app using its name
  const app = appByDevice.find( app => app.name == appName);
  if (!app) throw `No app found on this device with the name ${appName}`;

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

const applicationsByDevice = async (
  device_version: Id,
  current_se_firmware_final_version: Id,
  provider: number,
): Promise<ApplicationVersion[]> => {
  const url = new URL(`https://manager.api.live.ledger.com/api/get_apps`);
  const { data } : {
    data: { application_versions: ApplicationVersion[] };
  } = await axios(url.toString(), {
    method: "POST",
    headers: {
      'Content-type': 'application/x-www-form-urlencoded',
    },
    data: JSON.stringify({
      device_version: device_version,
      current_se_firmware_final_version: current_se_firmware_final_version,
      provider: 1,
    })
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
  const firmwareDataP = await deviceVersionP.then((deviceVersion) =>
    getCurrentFirmware(String(deviceInfo.version), deviceVersion.id, provider),
  );
  const applicationsByDeviceP = Promise.all([
    deviceVersionP,
    firmwareDataP,
  ]).then(([deviceVersion, firmwareData]) =>
    applicationsByDevice(deviceVersion.id, firmwareData.id, provider),
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
