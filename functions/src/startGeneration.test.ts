import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CallableRequest } from 'firebase-functions/https';
import { startGeneration } from './index';

// The emulator never consumes App Check tokens, so this calls the handler directly.
const request = (alreadyConsumed: boolean) =>
  ({ app: { appId: 'app', token: {}, alreadyConsumed }, data: { source: 'text', prompt: 'cube' } }) as unknown as CallableRequest;

test('startGeneration refuses a reused App Check token', async () => {
  await assert.rejects(startGeneration.run(request(true)), { code: 'unauthenticated', message: 'This App Check token was already used.' });
  // A fresh token gets past the replay check to the sign-in check.
  await assert.rejects(startGeneration.run(request(false)), { code: 'unauthenticated', message: 'Sign in first.' });
});
