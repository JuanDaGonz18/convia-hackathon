/**
 * The eval path only opens for the exact service key. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isServiceKey } from './auth.ts';

const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll('=', '');
const SERVICE_KEY = `${encode({ alg: 'HS256' })}.${encode({ role: 'service_role', iss: 'supabase' })}.real-signature`;

describe('service key', () => {
  test('the exact key opens it', () => {
    assert.equal(isServiceKey(SERVICE_KEY, SERVICE_KEY), true);
  });

  test('a forged token that only claims service_role does not', () => {
    const forged = `${encode({ alg: 'none' })}.${encode({ role: 'service_role' })}.`;
    assert.equal(isServiceKey(forged, SERVICE_KEY), false);
    assert.equal(isServiceKey(SERVICE_KEY.replace('real-signature', 'fake-signature'), SERVICE_KEY), false);
  });

  test('missing token or key never opens it', () => {
    assert.equal(isServiceKey('', SERVICE_KEY), false);
    assert.equal(isServiceKey(SERVICE_KEY, undefined), false);
    assert.equal(isServiceKey(SERVICE_KEY, ''), false);
  });
});
