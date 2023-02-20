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
import { installAppByName, getAllAppInstalled } from 'nano-app-web-installer-lib-test';
import TransportWebUSB from "@ledgerhq/hw-transport-webusb";

const myAppName = "Cosmos";

// create connection to nano device
transport = await TransportWebUSB.create();

// check if apps already exists
const apps = await getAllAppInstalled(transport);
const isInstalled = !!apps.find(app => app.name == myAppName);

// Note this function returns when the installation starts, not finishes
// Optionnal parameters: 
// delete: boolean set to true to uninstall the app instead
// provider: number. Catalog of apps. default to 1 (production and tested)  
await installAppByName(myAppName, transport);
```
