import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PICKUP_REASONS } from '../../supabase/functions/verify-pickup/decision.ts';
import { PICKUP_TEXTS, retryText } from './pickupVerification.ts';

test('every retry reason the server can return has its own text', () => {
  for (const reason of PICKUP_REASONS.retry) {
    assert.ok(reason in PICKUP_TEXTS.retry, `missing text for ${reason}`);
  }
});

test('every mismatch reason has an explanation', () => {
  for (const reason of PICKUP_REASONS.mismatch) {
    assert.ok(reason in PICKUP_TEXTS.mismatch, `missing text for ${reason}`);
  }
});

test('an unknown reason falls back to a generic text', () => {
  assert.equal(retryText('something_new'), PICKUP_TEXTS.retry.server_error);
});
