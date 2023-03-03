# Nano web installer library

This library is a helper to install an app to a Nano device on the web.
It exposes a few function to install an App using its name, check the list of all apps installed on a device

## Requirements

A hw-transport library is required to communicate with the device, for instance

- @ledgerhq/hw-transport-webusb

## Installation

    npm install --save @ledgerhq/nano-app-web-installer-lib

## Usage

```javascript
import { installAppByName, getAllAppInstalled, getDeviceInfo } from '@ledgerhq/nano-app-web-installer-lib';
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";

const myAppName = "Cosmos";

// create connection to nano device
const transport = await TransportWebUSB.create();
const info = await getDeviceInfo(transport);
switch (transport.deviceModel.id) {
    case "nanoX":
        if(info.version === '2.1.0') {
            await installAppByName(appName, transport, isDelete, 4);
        } else {
            throw "Device is not up to date"
        }
        break;
    case "nanoSP":
        if(info.version === '1.1.0') {
            await installAppByName(appName, transport, isDelete, 4);
        } else {
            throw "Device is not up to date"
        }
        break;
    case "nanoS":
        if(info.version === '2.1.0') {
            await installAppByName(appName, transport, isDelete, 4);
        } else {
            throw "Device is not up to date"
        }
        break;
    default:
        throw "Device not recognized"
}

// check if apps already exists
const apps = await getAllAppInstalled(transport);
const isInstalled = !!apps.find(app => app.name == myAppName);

// Note this function returns when the installation starts, not finishes
// Optionnal parameters: 
// delete: boolean set to true to uninstall the app instead
// provider: number. Catalog of apps. default to 1 (production and tested)  
await installAppByName(myAppName, transport, false, 4);
```


## Get all apps for a device (to find its name for example)

An app name is Capitalized.
- Ethereum
- Cosmos
- Bitcoin
- staRknet

If you need to know all apps name for a device run 

```javascript

import { getDeviceInfo, getAppsListByDevice } from '@ledgerhq/nano-app-web-installer-lib';

// Catalog of apps. 1 is production and tested
const provider = 1;  
// get all device info to know its available apps
const deviceInfo = await getDeviceInfo(transport);
// load all app available for device. Second param is dev mode. set to false
const appByDevice = await getAppsListByDevice(deviceInfo, false, provider);
```
