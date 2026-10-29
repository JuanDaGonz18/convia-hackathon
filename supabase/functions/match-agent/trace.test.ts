/**
 * Trace rows: who answered, and no phones or full plates. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { redact, toStepRow, totals } from './trace.ts';

describe('trace rows', () => {
  test('a model step keeps provider, the model as returned, request id, usage and cost', () => {
    const row = toStepRow('run-1', 1, {
      kind: 'model', turn: 1, plan: 'Buscar el lugar de origen',
      model: { provider: 'baseten', model: 'meta-models/muse-spark-open-1026', requestId: 'req-1', responseId: 'resp-1', servedBy: { 'x-baseten-model-version-id': 'v1' }, usage: { promptTokens: 120, completionTokens: 30, reasoningTokens: 10, cachedTokens: 100 }, costUsd: 0.0001234567, latencyMs: 600, attempts: [], finishReason: 'tool_calls' },
    });
    assert.equal(row.model, 'meta-models/muse-spark-open-1026');
    assert.equal(row.request_id, 'req-1');
    assert.equal(row.cost_usd, 0.000123);
    assert.equal(row.latency_ms, 600);
  });

  test('phones and full plates never reach a row, wherever they hide', () => {
    const row = toStepRow('run-1', 2, {
      kind: 'tool', turn: 2, tool: 'trip_details', plan: 'Llamar al 300 123 4567',
      args: { note: 'ABC123' },
      result: { driver_note: 'Escríbeme al +57 310-555-1234, placa XYZ 987', vehicle: { plate_masked: 'E••••1' } },
    });
    const text = JSON.stringify(row);
    assert.ok(!/3\d{2}[\s-]?\d{3}[\s-]?\d{4}/.test(text), text);
    assert.ok(!/ABC123|XYZ 987/.test(text), text);
    assert.match(text, /E••••1/);
  });

  test('redact leaves clean values untouched', () => {
    const value = { price_cop: 5000, departure: '2026-10-30 06:40' };
    assert.equal(redact(value), value);
  });

  test('totals add tokens and cost', () => {
    const rows = [1, 2].map((n) => toStepRow('r', n, { kind: 'model', turn: n, model: { provider: 'baseten', model: 'm', requestId: null, responseId: null, servedBy: {}, usage: { promptTokens: 10, completionTokens: 2, reasoningTokens: 1, cachedTokens: 0 }, costUsd: 0.001, latencyMs: 1, attempts: [], finishReason: null } }));
    assert.deepEqual(totals(rows), { steps: 2, prompt_tokens: 20, completion_tokens: 4, reasoning_tokens: 2, cached_tokens: 0, cost_usd: 0.002 });
  });
});
