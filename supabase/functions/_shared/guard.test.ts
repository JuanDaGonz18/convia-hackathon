/**
 * Fail-closed mock mode and the JSON body size cap. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { modelMode, readJsonBody } from './guard.ts';

describe('modelMode', () => {
  test('a model key always means live, even with ALLOW_MOCK', () => {
    assert.equal(modelMode('key', undefined), 'live');
    assert.equal(modelMode('key', 'true'), 'live');
  });
  test('no key is mock only with ALLOW_MOCK=true', () => {
    assert.equal(modelMode('', 'true'), 'mock');
    assert.equal(modelMode('  ', undefined), 'unavailable');
    assert.equal(modelMode(undefined, '1'), 'unavailable');
    assert.equal(modelMode('', 'TRUE'), 'unavailable');
  });
});

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request('https://example.test/fn', { method: 'POST', body, headers });

/** A body sent in chunks with no Content-Length, as a chunked upload arrives. */
function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let start = 0; start < bytes.length; start += 64) controller.enqueue(bytes.subarray(start, start + 64));
      controller.close();
    },
  });
}

describe('readJsonBody', () => {
  test('parses a body under the cap', async () => {
    assert.deepEqual(await readJsonBody(post('{"id":"a"}'), 100), { ok: true, body: { id: 'a' } });
  });
  test('refuses a declared Content-Length over the cap without reading', async () => {
    const result = await readJsonBody(post('{}', { 'content-length': '5000' }), 100);
    assert.deepEqual(result, { ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE' });
  });
  test('refuses a body over the cap even without Content-Length', async () => {
    const request = new Request('https://example.test/fn', {
      method: 'POST', body: streamed(JSON.stringify({ image: 'x'.repeat(500) })), duplex: 'half',
    } as RequestInit);
    assert.equal((await readJsonBody(request, 100)).ok, false);
  });
  test('invalid JSON and non-objects are INVALID_BODY', async () => {
    assert.deepEqual(await readJsonBody(post('not json'), 100), { ok: false, status: 400, error: 'INVALID_BODY' });
    assert.deepEqual(await readJsonBody(post('42'), 100), { ok: false, status: 400, error: 'INVALID_BODY' });
  });
});
