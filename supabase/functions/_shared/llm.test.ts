/**
 * Open-weights chat client: provider order, fallback, empty replies, usage and cost.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { costUsd, createLlm, LlmUnavailableError, providersFromEnv, readUsage, type ProviderConfig } from './llm.ts';

const env = (values: Record<string, string>) => (name: string) => values[name];
const SECRETS = { BASETEN_API_KEY: 'b-key', MODAL_ENDPOINT_URL: 'https://example.modal.direct/', MODAL_PROXY_TOKEN_ID: 'wk-1', MODAL_PROXY_TOKEN_SECRET: 'ws-2' };

/** A fake provider: answers per base URL, and records what was sent. */
function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
  const calls: { url: string; body: Record<string, unknown>; authorization: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)), authorization: String((init.headers as Record<string, string>).Authorization) });
    const answer = Object.entries(answers).find(([prefix]) => url.startsWith(prefix));
    if (!answer) throw new TypeError('fetch failed');
    return answer[1]();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const completion = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

const reply = (content: string | null, extra: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-1',
  model: 'meta-models/muse-spark-open-1026',
  choices: [{ finish_reason: 'stop', message: { content } }],
  usage: { prompt_tokens: 152, completion_tokens: 60, prompt_tokens_details: { cached_tokens: 128 }, completion_tokens_details: { reasoning_tokens: 49 } },
  ...extra,
});

describe('providersFromEnv', () => {
  test('Baseten then Modal, with the ids and request-id headers seen in the real calls', () => {
    const [baseten, modal] = providersFromEnv(env(SECRETS));
    assert.equal(baseten.name, 'baseten');
    assert.equal(baseten.model, 'meta-models/muse-spark-open-1026');
    assert.equal(baseten.requestIdHeader, 'x-baseten-request-id');
    assert.equal(modal.name, 'modal');
    assert.equal(modal.baseUrl, 'https://example.modal.direct/v1');
    assert.equal(modal.authorization, 'Bearer wk-1.ws-2');
    assert.equal(modal.model, 'meta-models/Muse-Spark-Open-816B-A42B');
    assert.equal(modal.requestIdHeader, null);
  });

  test('a provider without its secrets is skipped; AGENT_PROVIDERS sets the order', () => {
    assert.deepEqual(providersFromEnv(env({ BASETEN_API_KEY: 'b' })).map((p) => p.name), ['baseten']);
    assert.deepEqual(providersFromEnv(env({ ...SECRETS, AGENT_PROVIDERS: 'modal,baseten' })).map((p) => p.name), ['modal', 'baseten']);
    assert.deepEqual(providersFromEnv(env({ ...SECRETS, AGENT_PROVIDERS: 'baseten' })).map((p) => p.name), ['baseten']);
    assert.equal(providersFromEnv(env({ MODAL_ENDPOINT_URL: 'https://x/v1' })).length, 0);
  });
});

describe('usage and cost', () => {
  test('Baseten keeps reasoning and cache in *_details, Modal reasoning at the top level', () => {
    assert.deepEqual(readUsage(reply('ok').usage), { promptTokens: 152, completionTokens: 60, reasoningTokens: 49, cachedTokens: 128 });
    assert.deepEqual(readUsage({ prompt_tokens: 151, completion_tokens: 216, reasoning_tokens: 209, prompt_tokens_details: null }), { promptTokens: 151, completionTokens: 216, reasoningTokens: 209, cachedTokens: 0 });
  });

  test('cached input at the cached price; reasoning is part of the billed output', () => {
    const usage = { promptTokens: 152, completionTokens: 60, reasoningTokens: 49, cachedTokens: 128 };
    assert.ok(Math.abs(costUsd('baseten', usage) - (24 * 1.25 + 128 * 0.15 + 60 * 4.25) / 1e6) < 1e-12);
  });
});

describe('chat', () => {
  const providers = providersFromEnv(env(SECRETS));
  const BASETEN = 'https://inference.baseten.co';
  const MODAL = 'https://example.modal.direct';

  test('records provider, the model the response named, request id and serving deployment', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [BASETEN]: () => completion(reply('ok'), { 'x-baseten-request-id': 'req-1', 'x-baseten-model-version-id': 'wpgy40e' }),
    });
    const result = await createLlm({ providers, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.provider, 'baseten');
    assert.equal(result.model, 'meta-models/muse-spark-open-1026');
    assert.equal(result.requestId, 'req-1');
    assert.deepEqual(result.servedBy, { 'x-baseten-model-version-id': 'wpgy40e' });
    assert.equal(result.content, 'ok');
    assert.equal(result.attempts.length, 1);
    assert.equal(calls[0].body.max_tokens, 1024);
    assert.equal(calls[0].body.temperature, 0);
    assert.equal(calls.length, 1);
  });

  test('an empty reply (all tokens spent reasoning) is a failed step: Modal answers instead', async () => {
    const { fetchImpl, calls } = fakeFetch({
      [BASETEN]: () => completion(reply('', { choices: [{ finish_reason: 'length', message: { content: '' } }] })),
      [MODAL]: () => completion(reply('ok', { id: 'modal-resp-9', model: 'meta-models/Muse-Spark-Open-816B-A42B' })),
    });
    const result = await createLlm({ providers, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.provider, 'modal');
    assert.equal(result.model, 'meta-models/Muse-Spark-Open-816B-A42B');
    // No request-id header on Modal: the body's id.
    assert.equal(result.requestId, 'modal-resp-9');
    assert.deepEqual(result.attempts.map((a) => [a.provider, a.ok, a.failure, a.finishReason]), [['baseten', false, 'empty_reply', 'length'], ['modal', true, null, 'stop']]);
    // The failed attempt's tokens were still billed and are kept.
    assert.ok(result.attempts[0].costUsd > 0);
    assert.equal(calls[1].authorization, 'Bearer wk-1.ws-2');
  });

  test('a tool call without text is a valid answer', async () => {
    const toolCall = { id: 'call_1', type: 'function', function: { name: 'search_trips', arguments: '{}' } };
    const { fetchImpl } = fakeFetch({ [BASETEN]: () => completion(reply(null, { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [toolCall] } }] })) });
    const result = await createLlm({ providers, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }], tools: [] });
    assert.deepEqual(result.toolCalls, [toolCall]);
    assert.equal(result.content, null);
  });

  test('tool choice: required, or one named tool in the OpenAI shape', async () => {
    const tool = { type: 'function' as const, function: { name: 'submit_request_spec', description: 'x', parameters: { type: 'object', properties: {} } } };
    const { fetchImpl, calls } = fakeFetch({ [BASETEN]: () => completion(reply('ok')) });
    const llm = createLlm({ providers, fetch: fetchImpl });
    await llm.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [tool], toolChoice: 'required' });
    await llm.chat({ messages: [{ role: 'user', content: 'hi' }], tools: [tool], toolChoice: { name: 'submit_request_spec' } });
    assert.equal(calls[0].body.tool_choice, 'required');
    assert.deepEqual(calls[1].body.tool_choice, { type: 'function', function: { name: 'submit_request_spec' } });
  });

  test('HTTP errors, network errors and invalid JSON fall back, and are kept in the attempts', async () => {
    for (const [answer, failure] of [
      [() => new Response('busy', { status: 429 }), 'http_429'],
      [() => new Response('oops', { status: 503 }), 'http_5xx'],
      [() => new Response('bad model', { status: 404 }), 'http_4xx'],
      [() => new Response('<html>', { status: 200 }), 'invalid_json'],
      [() => { throw new TypeError('fetch failed'); }, 'network'],
    ] as const) {
      const { fetchImpl } = fakeFetch({ [BASETEN]: answer, [MODAL]: () => completion(reply('ok')) });
      const result = await createLlm({ providers, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
      assert.equal(result.provider, 'modal', failure);
      assert.equal(result.attempts[0].failure, failure);
    }
  });

  test('a timeout falls back', async () => {
    const { fetchImpl } = fakeFetch({
      [BASETEN]: () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
      [MODAL]: () => completion(reply('ok')),
    });
    const result = await createLlm({ providers, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(result.attempts[0].failure, 'timeout');
  });

  test('when every provider fails, the error carries all attempts', async () => {
    const { fetchImpl } = fakeFetch({ [BASETEN]: () => new Response('x', { status: 500 }), [MODAL]: () => new Response('x', { status: 500 }) });
    await assert.rejects(
      createLlm({ providers, fetch: fetchImpl }).chat({ messages: [{ role: 'user', content: 'hi' }] }),
      (error: unknown) => error instanceof LlmUnavailableError && error.attempts.length === 2,
    );
  });

  test('with no provider configured it fails at once', async () => {
    await assert.rejects(createLlm({ providers: [] as ProviderConfig[] }).chat({ messages: [] }), LlmUnavailableError);
  });
});
