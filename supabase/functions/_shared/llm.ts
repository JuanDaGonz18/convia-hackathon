/**
 * Chat with Muse Spark Open (open weights) through OpenAI-compatible providers, in order:
 * Baseten Model APIs first, then a Modal Shared Endpoint. A call that fails on one provider
 * (timeout, network, any HTTP error, invalid JSON, or an empty reply) goes to the next one.
 *
 * Every answer says who produced it: the provider, the model name as the provider's response
 * returned it (not our config), the provider's request id and, for Baseten, which deployment
 * served it. Failed attempts are returned too, so the trace shows every fallback.
 *
 * No Deno globals here: the Edge Function passes its environment (providersFromEnv) and
 * `npm run test:functions` runs this module under Node with a fake fetch.
 */

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; content: string; tool_call_id: string };

export type ToolSpec = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatRequest = {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** 'required': the model must call a tool (the agent loop); default 'auto'. */
  toolChoice?: 'auto' | 'required';
  /** Tokens per call, reasoning included: the model reasons before answering, so leave room. */
  maxTokens?: number;
  temperature?: number;
  /** Per provider attempt. */
  timeoutMs?: number;
};

export type ProviderName = 'baseten' | 'modal';

export type ProviderConfig = {
  name: ProviderName;
  baseUrl: string;
  authorization: string;
  model: string;
  /** Header with the provider's request id; without one, the response body's `id` is used. */
  requestIdHeader: string | null;
  /** Headers that identify the deployment that answered, stored with each step. */
  servedByHeaders: string[];
};

export type Usage = { promptTokens: number; completionTokens: number; reasoningTokens: number; cachedTokens: number };

export type FailureKind = 'timeout' | 'network' | 'http_429' | 'http_5xx' | 'http_4xx' | 'invalid_json' | 'empty_reply';

export type Attempt = {
  provider: ProviderName;
  ok: boolean;
  failure: FailureKind | null;
  status: number | null;
  latencyMs: number;
  /** Model name in the provider's response (null when there was no valid response). */
  returnedModel: string | null;
  requestId: string | null;
  finishReason: string | null;
  usage: Usage | null;
  costUsd: number;
  detail: string | null;
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string | null;
  provider: ProviderName;
  model: string;
  requestId: string | null;
  responseId: string | null;
  servedBy: Record<string, string>;
  usage: Usage;
  costUsd: number;
  latencyMs: number;
  /** Every attempt, failed ones first and the successful one last. */
  attempts: Attempt[];
};

export class LlmUnavailableError extends Error {
  readonly attempts: Attempt[];

  constructor(attempts: Attempt[]) {
    super(`No provider answered: ${attempts.map((attempt) => `${attempt.provider}=${attempt.failure}`).join(', ') || 'none configured'}`);
    this.name = 'LlmUnavailableError';
    this.attempts = attempts;
  }
}

export const DEFAULT_MAX_TOKENS = 1024;
export const DEFAULT_TIMEOUT_MS = 12_000;

/** USD per 1M tokens, checked October 28, 2026 (same on both providers). Reasoning tokens bill as output. */
export const PRICES: Record<ProviderName, { input: number; cachedInput: number; output: number }> = {
  baseten: { input: 1.25, cachedInput: 0.15, output: 4.25 },
  modal: { input: 1.25, cachedInput: 0.15, output: 4.25 },
};

export function costUsd(provider: ProviderName, usage: Usage) {
  const price = PRICES[provider];
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  return ((usage.promptTokens - cached) * price.input + cached * price.cachedInput + usage.completionTokens * price.output) / 1_000_000;
}

/** Baseten puts reasoning and cache counts in *_details; Modal puts reasoning_tokens at the top level. */
export function readUsage(raw: unknown): Usage {
  const usage = (raw ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    reasoning_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  };
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens ?? 0,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Providers from the environment, in AGENT_PROVIDERS order (default "baseten,modal").
 * A provider without its secrets is skipped, so removing Modal is one config change.
 */
export function providersFromEnv(env: (name: string) => string | undefined): ProviderConfig[] {
  const order = (env('AGENT_PROVIDERS') ?? 'baseten,modal').split(',').map((name) => name.trim()).filter(Boolean);
  const providers: ProviderConfig[] = [];
  for (const name of order) {
    if (name === 'baseten') {
      const key = env('BASETEN_API_KEY');
      if (!key) continue;
      providers.push({
        name,
        baseUrl: 'https://inference.baseten.co/v1',
        authorization: `Bearer ${key}`,
        model: env('BASETEN_MODEL') ?? 'meta-models/muse-spark-open-1026',
        requestIdHeader: 'x-baseten-request-id',
        servedByHeaders: ['x-baseten-model-id', 'x-baseten-model-version-id'],
      });
    } else if (name === 'modal') {
      const url = env('MODAL_ENDPOINT_URL')?.trim().replace(/\/+$/, '');
      const id = env('MODAL_PROXY_TOKEN_ID');
      const secret = env('MODAL_PROXY_TOKEN_SECRET');
      if (!url || !id || !secret) continue;
      providers.push({
        name,
        // The Shared Endpoint answers under /v1 (the bare URL is a 404).
        baseUrl: url.endsWith('/v1') ? url : `${url}/v1`,
        authorization: `Bearer ${id}.${secret}`,
        model: env('MODAL_MODEL') ?? 'meta-models/Muse-Spark-Open-816B-A42B',
        // Modal sends no request-id header: the response body's id is stored instead.
        requestIdHeader: null,
        servedByHeaders: [],
      });
    }
  }
  return providers;
}

type ChatCompletion = {
  id?: string;
  model?: string;
  choices?: { finish_reason?: string | null; message?: { content?: string | null; tool_calls?: ToolCall[] | null } }[];
  usage?: unknown;
};

function failureForStatus(status: number): FailureKind {
  if (status === 429) return 'http_429';
  return status >= 500 ? 'http_5xx' : 'http_4xx';
}

export function createLlm({ providers, fetch: fetchImpl = globalThis.fetch }: { providers: ProviderConfig[]; fetch?: typeof fetch }) {
  async function attempt(provider: ProviderConfig, request: ChatRequest): Promise<{ attempt: Attempt; result?: ChatResult }> {
    const started = performance.now();
    const base = { provider: provider.name, returnedModel: null, requestId: null, finishReason: null, usage: null, costUsd: 0 };
    const failed = (failure: FailureKind, status: number | null, detail: string | null) => ({
      attempt: { ...base, ok: false, failure, status, latencyMs: Math.round(performance.now() - started), detail: detail?.slice(0, 300) ?? null },
    });
    let response: Response;
    try {
      response = await fetchImpl(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: provider.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          messages: request.messages,
          ...(request.tools?.length ? { tools: request.tools, tool_choice: request.toolChoice ?? 'auto' } : {}),
          max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: request.temperature ?? 0,
        }),
        signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as { name?: string })?.name;
      return failed(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', null, String(error));
    }
    const headerRequestId = provider.requestIdHeader ? response.headers.get(provider.requestIdHeader) : null;
    if (!response.ok) {
      const result = failed(failureForStatus(response.status), response.status, await response.text().catch(() => null));
      return { attempt: { ...result.attempt, requestId: headerRequestId } };
    }
    let body: ChatCompletion;
    try {
      body = await response.json() as ChatCompletion;
    } catch (error) {
      return failed('invalid_json', response.status, String(error));
    }
    const choice = body.choices?.[0];
    const content = choice?.message?.content?.trim() ? choice.message.content : null;
    const toolCalls = choice?.message?.tool_calls ?? [];
    const usage = readUsage(body.usage);
    const cost = costUsd(provider.name, usage);
    const latencyMs = Math.round(performance.now() - started);
    const requestId = headerRequestId ?? body.id ?? null;
    const finishReason = choice?.finish_reason ?? null;
    const returnedModel = body.model ?? null;
    // No text and no tool call (e.g. every token spent on reasoning): a failed step, try the next provider.
    if (!content && !toolCalls.length) {
      return { attempt: { ...base, ok: false, failure: 'empty_reply', status: response.status, latencyMs, returnedModel, requestId, finishReason, usage, costUsd: cost, detail: null } };
    }
    const servedBy: Record<string, string> = {};
    for (const name of provider.servedByHeaders) {
      const value = response.headers.get(name);
      if (value) servedBy[name] = value;
    }
    const done: Attempt = { ...base, ok: true, failure: null, status: response.status, latencyMs, returnedModel, requestId, finishReason, usage, costUsd: cost, detail: null };
    return {
      attempt: done,
      result: {
        content,
        toolCalls,
        finishReason,
        provider: provider.name,
        model: returnedModel ?? provider.model,
        requestId,
        responseId: body.id ?? null,
        servedBy,
        usage,
        costUsd: cost,
        latencyMs,
        attempts: [],
      },
    };
  }

  return {
    providers: providers.map((provider) => provider.name),
    /** One model step: the first provider that answers with text or a tool call. */
    async chat(request: ChatRequest): Promise<ChatResult> {
      const attempts: Attempt[] = [];
      for (const provider of providers) {
        const { attempt: tried, result } = await attempt(provider, request);
        attempts.push(tried);
        if (result) return { ...result, attempts };
      }
      throw new LlmUnavailableError(attempts);
    },
  };
}
