/* eslint-disable no-bitwise */
import {
  DeviceOnDashboardExpected,
  TransportStatusError,
} from '@ledgerhq/errors';
import Transport from '@ledgerhq/hw-transport';
import type { DeviceInfo, FirmwareInfo } from '@ledgerhq/types-live';
import { DeviceModelId, identifyTargetId } from '@ledgerhq/devices';
import { satisfies as versionSatisfies, coerce as semverCoerce } from 'semver';

const ManagerAllowedFlag = 0x08;
const PinValidatedFlag = 0x80;

const PROVIDERS: Record<string, number> = {
    das: 2,
    club: 3,
    shitcoins: 4,
    ee: 5,
  };

const deviceVersionRangesForBootloaderVersion: {
  [key in DeviceModelId]?: string;
} = {
  nanoS: '>=2.0.0',
  nanoX: '>=2.0.0',
  nanoSP: '>=1.0.0',
};

const deviceVersionRangesForHardwareVersion: {
  [key in DeviceModelId]?: string;
} = {
  nanoX: '>=2.0.0',
};

const deviceVersionRangesForLocalization: { [key in DeviceModelId]?: string } =
  {
    nanoX: '>=2.1.0',
    nanoSP: '>=1.1.0',
  };

const isDashboardName = (name: string): boolean =>
  ['BOLOS', 'OLOS\u0000'].includes(name);

const isDeviceLocalizationSupported = (
  seVersion: string,
  modelId?: DeviceModelId,
): boolean =>
  !!modelId &&
  !!deviceVersionRangesForLocalization[modelId] &&
  !!versionSatisfies(
    semverCoerce(seVersion) || seVersion,
    deviceVersionRangesForLocalization[modelId] as string,
  );

const isBootloaderVersionSupported = (
  seVersion: string,
  modelId?: DeviceModelId,
): boolean =>
  !!modelId &&
  !!deviceVersionRangesForBootloaderVersion[modelId] &&
  !!versionSatisfies(
    semverCoerce(seVersion) || seVersion,
    deviceVersionRangesForBootloaderVersion[modelId] as string,
  );

/**
 * @returns whether the Hardware Version bytes are included in the result of the
 * getVersion APDU
 * */
const isHardwareVersionSupported = (
  seVersion: string,
  modelId?: DeviceModelId,
): boolean =>
  !!modelId &&
  !!deviceVersionRangesForHardwareVersion[modelId] &&
  !!versionSatisfies(
    semverCoerce(seVersion) || seVersion,
    deviceVersionRangesForHardwareVersion[modelId] as string,
  );

export async function getVersion(transport: Transport): Promise<FirmwareInfo> {
  const res = await transport.send(0xe0, 0x01, 0x00, 0x00);
  const data = res.slice(0, res.length - 2);
  let i = 0;

  // parse the target id of either BL or SE
  const targetId = data.readUIntBE(0, 4);
  i += 4;

  // parse the version of either BL or SE
  const rawVersionLength = data[i++];
  let rawVersion = data.slice(i, i + rawVersionLength).toString();
  i += rawVersionLength;

  // flags. gives information about manager allowed in SE mode.
  const flagsLength = data[i++];
  let flags = data.slice(i, i + flagsLength);
  i += flagsLength;

  if (!rawVersionLength) {
    // To support old firmware like bootloader of 1.3.1
    rawVersion = '0.0.0';
    flags = Buffer.allocUnsafeSlow(0);
  }

  let mcuVersion = '';
  let mcuBlVersion: string | undefined;
  let seVersion: string | undefined;
  let bootloaderVersion: string | undefined;
  let hardwareVersion: number | undefined;
  let mcuTargetId: number | undefined;
  let seTargetId: number | undefined;
  let languageId: number | undefined;

  const isBootloader = (targetId & 0xf0000000) !== 0x30000000;

  if (isBootloader) {
    mcuBlVersion = rawVersion;
    mcuTargetId = targetId;

    if (i < data.length) {
      // se part 1
      const part1Length = data[i++];
      const part1 = data.slice(i, i + part1Length);
      i += part1Length;

      // at this time, this is how we branch old & new format
      if (part1Length >= 5) {
        seVersion = part1.toString();
        // se part 2
        const part2Length = data[i++];
        const part2 = data.slice(i, i + part2Length);
        i += flagsLength;
        seTargetId = part2.readUIntBE(0, 4);
      } else {
        seTargetId = part1.readUIntBE(0, 4);
      }
    }
  } else {
    seVersion = rawVersion;
    seTargetId = targetId;

    // if SE: mcu version
    const mcuVersionLength = data[i++];
    let mcuVersionBuf: Buffer = Buffer.from(
      data.slice(i, i + mcuVersionLength),
    );
    i += mcuVersionLength;

    if (mcuVersionBuf[mcuVersionBuf.length - 1] === 0) {
      mcuVersionBuf = mcuVersionBuf.slice(0, mcuVersionBuf.length - 1);
    }
    mcuVersion = mcuVersionBuf.toString();

    const isOSU = rawVersion.includes('-osu');

    if (!isOSU) {
      const deviceModel = identifyTargetId(targetId);

      if (isBootloaderVersionSupported(seVersion, deviceModel?.id)) {
        const bootloaderVersionLength = data[i++];
        let bootloaderVersionBuf: Buffer = Buffer.from(
          data.slice(i, i + bootloaderVersionLength),
        );
        i += bootloaderVersionLength;

        if (bootloaderVersionBuf[bootloaderVersionBuf.length - 1] === 0) {
          bootloaderVersionBuf = bootloaderVersionBuf.slice(
            0,
            bootloaderVersionBuf.length - 1,
          );
        }
        bootloaderVersion = bootloaderVersionBuf.toString();
      }

      if (isHardwareVersionSupported(seVersion, deviceModel?.id)) {
        const hardwareVersionLength = data[i++];
        hardwareVersion = data
          .slice(i, i + hardwareVersionLength)
          .readUIntBE(0, 1); // ?? string? number?
        i += hardwareVersionLength;
      }

      if (isDeviceLocalizationSupported(seVersion, deviceModel?.id)) {
        const languageIdLength = data[i++];
        languageId = data.slice(i, i + languageIdLength).readUIntBE(0, 1);
      }
    }
  }

  return {
    isBootloader,
    rawVersion,
    targetId,
    seVersion,
    mcuVersion,
    mcuBlVersion,
    mcuTargetId,
    seTargetId,
    flags,
    bootloaderVersion,
    hardwareVersion,
    languageId,
  };
}

export const getAppAndVersion = async (
  transport: Transport,
): Promise<{
  name: string;
  version: string;
  flags: number | Buffer;
}> => {
  const r = await transport.send(0xb0, 0x01, 0x00, 0x00);
  let i = 0;
  const format = r[i++];

  if (format !== 1) {
    throw new Error("GetAppAndVersionUnsupportedFormat: format not supported'");
  }

  const nameLength = r[i++];
  const name = r.slice(i, (i += nameLength)).toString('ascii');
  const versionLength = r[i++];
  const version = r.slice(i, (i += versionLength)).toString('ascii');
  const flagLength = r[i++];
  const flags = r.slice(i, (i += flagLength));
  return {
    name,
    version,
    flags,
  };
};

export async function getDeviceInfo(
  transport: Transport,
): Promise<DeviceInfo> {
  const probablyOnDashboard = await getAppAndVersion(transport)
    .then(({ name }) => isDashboardName(name))
    .catch((e) => {
      if (e instanceof TransportStatusError) {
        // @ts-expect-error typescript not checking agains the instanceof
        if (e.statusCode === 0x6e00) {
          return true;
        }

        // @ts-expect-error typescript not checking agains the instanceof
        if (e.statusCode === 0x6d00) {
          return false;
        }
      }

      throw e;
    });

  if (!probablyOnDashboard) {
    throw new DeviceOnDashboardExpected();
  }

  const res = await getVersion(transport).catch((e) => {
    if (e instanceof TransportStatusError) {
      // @ts-expect-error typescript not checking agains the instanceof
      if (e.statusCode === 0x6d06 || e.statusCode === 0x6d07) {
        throw new Error('DeviceNotOnboarded');
      }
    }
    throw e;
  });

  const {
    isBootloader,
    rawVersion,
    targetId,
    seVersion,
    seTargetId,
    mcuBlVersion,
    mcuVersion,
    mcuTargetId,
    flags,
    bootloaderVersion,
    hardwareVersion,
    languageId,
  } = res;
  const isOSU = rawVersion.includes('-osu');
  const version = rawVersion.replace('-osu', '');
  const m = rawVersion.match(/([0-9]+.[0-9]+)(.[0-9]+)?(-(.*))?/);
  const [, majMin, , , postDash] = m || [];
  const providerName = PROVIDERS[postDash] ? postDash : null;
  const flag = flags.length > 0 ? flags[0] : 0;
  const managerAllowed = !!(flag & ManagerAllowedFlag);
  const pinValidated = !!(flag & PinValidatedFlag);

  let isRecoveryMode = false;
  let onboarded = true;
  if (flags.length === 4) {
    // Nb Since LNS+ unseeded devices are visible + extra flags
    isRecoveryMode = !!(flags[0] & 0x01);
    onboarded = !!(flags[0] & 0x04);
  }

  const hasDevFirmware = isDevFirmware(seVersion);

  return {
    version,
    mcuVersion,
    seVersion,
    mcuBlVersion,
    majMin,
    providerName: providerName || null,
    targetId,
    hasDevFirmware,
    seTargetId,
    mcuTargetId,
    isOSU,
    isBootloader,
    isRecoveryMode,
    managerAllowed,
    pinValidated,
    onboarded,
    bootloaderVersion,
    hardwareVersion,
    languageId,
  };
}

const isDevFirmware = (seVersion: string | undefined): boolean => {
  if (!seVersion) return false;

  const knownDevSuffixes = ['lo', 'rc', 'il', 'tr']; // FW can't guarantee non digits in versions
  return knownDevSuffixes.some((suffix) => seVersion.includes('-' + suffix));
};
