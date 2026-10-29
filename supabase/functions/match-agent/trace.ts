/**
 * Trace rows for agent_steps, from the loop's TraceStep. The trace keeps what the model saw and
 * who answered (provider, model as returned, request id), never more: tool outputs carry masked
 * plates and no phones by construction, and redact() removes anything that still looks like one.
 * Pure TypeScript, unit-tested.
 */
import type { TraceStep } from './loop.ts';

/** Colombian mobile numbers (3xx xxx xxxx, with or without +57) and full car plates (ABC123 / ABC 123). */
const PHONE = /(?:\+?57[\s-]?)?\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g;
const PLATE = /\b[A-Z]{3}[\s-]?\d{3}\b/g;

/** Masks phone numbers and full plates anywhere in a JSON-able value. */
export function redact<T>(value: T): T {
  if (value === null || value === undefined) return value;
  const text = JSON.stringify(value);
  const clean = text.replace(PHONE, '[phone]').replace(PLATE, (plate) => `${plate[0]}••••${plate.at(-1)}`);
  return (clean === text ? value : JSON.parse(clean)) as T;
}

export type StepRow = {
  run_id: string;
  n: number;
  kind: 'model' | 'tool' | 'judge';
  plan: string | null;
  provider: string | null;
  model: string | null;
  request_id: string | null;
  response_id: string | null;
  served_by: Record<string, string> | null;
  attempts: unknown[];
  finish_reason: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  cached_tokens: number | null;
  cost_usd: number | null;
  tool_name: string | null;
  args: unknown;
  result: unknown;
  latency_ms: number | null;
  error: string | null;
};

export function toStepRow(runId: string, n: number, step: TraceStep & { kindOverride?: 'judge' }): StepRow {
  const model = step.model;
  return {
    run_id: runId,
    n,
    kind: step.kindOverride ?? step.kind,
    plan: step.plan ? redact(step.plan).slice(0, 300) : null,
    provider: model?.provider ?? null,
    model: model?.model ?? null,
    request_id: model?.requestId ?? null,
    response_id: model?.responseId ?? null,
    served_by: model?.servedBy ?? null,
    attempts: model?.attempts ?? [],
    finish_reason: model?.finishReason ?? null,
    prompt_tokens: model?.usage.promptTokens ?? null,
    completion_tokens: model?.usage.completionTokens ?? null,
    reasoning_tokens: model?.usage.reasoningTokens ?? null,
    cached_tokens: model?.usage.cachedTokens ?? null,
    cost_usd: model ? Math.round(model.costUsd * 1e6) / 1e6 : null,
    tool_name: step.tool ?? null,
    args: redact(step.args ?? null),
    result: redact(step.result ?? null),
    latency_ms: step.latencyMs ?? model?.latencyMs ?? null,
    error: step.error ?? null,
  };
}

/** Totals for agent_runs from the step rows. */
export function totals(rows: StepRow[]) {
  const sum = (key: 'prompt_tokens' | 'completion_tokens' | 'reasoning_tokens' | 'cached_tokens' | 'cost_usd') => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    steps: rows.length,
    prompt_tokens: sum('prompt_tokens'),
    completion_tokens: sum('completion_tokens'),
    reasoning_tokens: sum('reasoning_tokens'),
    cached_tokens: sum('cached_tokens'),
    cost_usd: Math.round(sum('cost_usd') * 1e6) / 1e6,
  };
}
