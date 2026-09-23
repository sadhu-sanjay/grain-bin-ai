// lib/eeInitialization.js
import ee from '@google/earthengine';

let isInitialized = false;

export async function initializeEarthEngine() {
  if (isInitialized) return ee;

  const keyJson = process.env.EE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    throw new Error('EE_SERVICE_ACCOUNT_KEY environment variable is not defined.');
  }

  const credentials = JSON.parse(keyJson);

  return new Promise((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      credentials,
      () => {
        ee.initialize(
          null,
          null,
          () => {
            isInitialized = true;
            resolve(ee);
          },
          (err) => reject(new Error(`EE Initialization Failed: ${err}`))
        );
      },
      (err) => reject(new Error(`EE Auth Failed: ${err}`))
    );
  });
}