/**
 * The agent loop: plan → tool call → observation, at most MAX_TURNS model turns and a hard
 * deadline. Two phases (SPEC, SEARCH) with a tool allowlist each; checkpoint 1 (spec.ts) gates
 * the search, checkpoint 2 (verifyProposal, injected) runs inside propose_request_seat. Every
 * model turn and tool call is reported to `record` (the trace). All dependencies are injected,
 * so the loop is tested with a scripted model and in-memory data.
 */
import type { ChatMessage, ChatRequest, ChatResult, ToolCall } from '../_shared/llm.ts';
import { LlmUnavailableError } from '../_shared/llm.ts';
import type { ProposalFields } from './proposal.ts';
import { type Phase, PHASE_TOOLS, toolsFor } from './agentTools.ts';
import { AGENT_INSTRUCTIONS } from './instructions.ts';
import type { ResolvedPlace } from './places.ts';
import type { SearchResult, TripOption } from './search.ts';
import { type AcceptedSpec, checkSearchMatchesSpec, checkSpec, type PlaceRef } from './spec.ts';
import { runReadTool, type ToolContext, validateSearchArgs } from './tools.ts';

export const MAX_TURNS = 8;
export const DEADLINE_MS = 40_000;
export const MAX_SPEC_REJECTIONS = 3;
export const MAX_PROPOSE_ATTEMPTS = 3;
/** resolve_place calls per run: more means the model is guessing places instead of asking. */
export const MAX_PLACE_LOOKUPS = 4;

export type RunStatus = 'proposed' | 'clarify' | 'no_match' | 'answered' | 'unverified' | 'limit' | 'failed' | 'paused';

/** Plain JSON, so a step-through run can be stored and resumed. */
export type RunState = {
  messages: ChatMessage[];
  phase: Phase;
  turns: number;
  places: Record<string, PlaceRef>;
  nextPlace: number;
  spec: AcceptedSpec | null;
  /** Every trip option search_trips returned in this run, by id. */
  searched: Record<string, TripOption>;
  lastSearch: SearchResult | null;
  /** The accepted spec is frozen, so a second search would return the same: one per run. */
  searchDone?: boolean;
  /** Trips checkpoint 2 found can't be proposed at all (already requested, full, clash…), with why. */
  blocked?: Record<string, string>;
  /** Every tool output of this run, for number grounding. */
  outputs: unknown[];
  specRejections: number;
  proposeAttempts: number;
  placeLookups?: number;
};

/** A verified proposal: the trip card, and the exact fields its hash covers (what Confirm binds to). */
export type Proposal = { trip: TripOption; seats: number; explanation: string; hash: string; departureIso: string; price: number; fields: ProposalFields };

export type ProposalVerdict =
  | { verified: true; proposal: Proposal; checks: string[] }
  | { verified: false; failures: string[]; checks: string[]; tripBlocked?: boolean };

export type Progress = 'understanding' | 'searching' | 'checking' | 'verifying';
export type ProgressEvent = { step: Progress; status: 'active' | 'done' };

export type TraceStep = {
  kind: 'model' | 'tool';
  turn: number;
  /** Model turn: who answered. */
  model?: Pick<ChatResult, 'provider' | 'model' | 'requestId' | 'responseId' | 'servedBy' | 'usage' | 'costUsd' | 'latencyMs' | 'attempts' | 'finishReason'>;
  /** Tool step. */
  tool?: string;
  plan?: string | null;
  args?: unknown;
  result?: unknown;
  ok?: boolean;
  error?: string | null;
  latencyMs?: number;
};

export type LoopDeps = {
  chat: (request: ChatRequest) => Promise<ChatResult>;
  context: ToolContext;
  verifyProposal: (input: { tripId: string; explanation: string; state: RunState }) => Promise<ProposalVerdict>;
  /** Deterministic grounding for answers that propose nothing (answer_no_match): numbers not found. */
  ungroundedNumbers?: (text: string, state: RunState) => string[];
  record: (step: TraceStep) => Promise<void> | void;
  progress?: (event: ProgressEvent) => void;
  clock?: () => number;
  deadlineMs?: number;
  /** Step-through debugging: stop after this many model turns in this call ('paused'). */
  turnsThisCall?: number;
};

export type AgentOutcome = {
  status: RunStatus;
  /** What the user reads (model text for answers and proposals, fixed text for limits/failures). */
  reply: string | null;
  spec: AcceptedSpec | null;
  proposal: Proposal | null;
  /** Options shown to the user; `verified: false` when the run ended without a verified proposal. */
  options: (TripOption & { verified: boolean })[];
  state: RunState;
  error: string | null;
};

export function newRunState(objective: string): RunState {
  return {
    messages: [{ role: 'system', content: AGENT_INSTRUCTIONS }, { role: 'user', content: objective }],
    phase: 'spec',
    turns: 0,
    places: {},
    nextPlace: 1,
    spec: null,
    searched: {},
    lastSearch: null,
    outputs: [],
    specRejections: 0,
    proposeAttempts: 0,
  };
}

const FIXED_REPLIES = {
  es: {
    limit: 'No alcancé a terminar la búsqueda. Estas son las opciones más cercanas, sin verificar.',
    limitEmpty: 'No alcancé a terminar la búsqueda. Intenta de nuevo o usa la búsqueda de viajes.',
    unverified: 'No pude verificar una opción. Estas son las más cercanas, sin verificar: revísalas antes de pedir cupo.',
    failed: 'El asistente no está disponible en este momento. Usa la búsqueda de viajes.',
    clarify: 'No logré entender tu solicitud. ¿Me dices de dónde sales, a dónde vas y a qué hora?',
  },
  en: {
    limit: "I couldn't finish the search. These are the closest options, not verified.",
    limitEmpty: "I couldn't finish the search. Try again or use the trip search.",
    unverified: "I couldn't verify an option. These are the closest ones, not verified: check them before requesting a seat.",
    failed: 'The assistant is unavailable right now. Use the trip search.',
    clarify: "I couldn't understand your request. Where are you leaving from, where are you going, and at what time?",
  },
} as const;

/** Arguments arrive as JSON text; the plan note is taken out before validation. */
function parseCall(call: ToolCall): { args: Record<string, unknown> | null; plan: string | null } {
  try {
    const parsed = call.function.arguments?.trim() ? JSON.parse(call.function.arguments) : {};
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { args: null, plan: null };
    const { plan, ...rest } = parsed as Record<string, unknown>;
    return { args: rest, plan: typeof plan === 'string' ? plan.slice(0, 300) : null };
  } catch {
    return { args: null, plan: null };
  }
}

export async function runAgent(state: RunState, deps: LoopDeps, language: 'es' | 'en'): Promise<AgentOutcome> {
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const deadline = started + (deps.deadlineMs ?? DEADLINE_MS);
  const progress = deps.progress ?? (() => undefined);
  const texts = FIXED_REPLIES[language];
  let callTurns = 0;

  const blocked = () => state.blocked ?? {};
  const unverifiedOptions = () => (state.lastSearch ? [...state.lastSearch.options, ...state.lastSearch.alternatives] : [])
    .filter((option) => !blocked()[option.trip_id]).map((option) => ({ ...option, verified: false }));
  const openOptions = () => (state.lastSearch?.options ?? []).filter((option) => !blocked()[option.trip_id]);
  const nextAfterBlock = () => openOptions().length
    ? 'Propose another option from the search with propose_request_seat.'
    : 'No other option is left: call answer_no_match and tell the user why this trip was not proposed.';
  const end = (status: RunStatus, reply: string | null, extra: Partial<AgentOutcome> = {}): AgentOutcome => ({
    status, reply, spec: state.spec, proposal: null, options: [], state, error: null, ...extra,
  });

  if (!state.turns) progress({ step: 'understanding', status: 'active' });

  while (state.turns < MAX_TURNS) {
    if (clock() >= deadline) break;
    if (deps.turnsThisCall !== undefined && callTurns >= deps.turnsThisCall) return end('paused', null);
    state.turns += 1;
    callTurns += 1;
    const turn = state.turns;

    let result: ChatResult;
    try {
      result = await deps.chat({ messages: state.messages, tools: toolsFor(state.phase), toolChoice: 'required', timeoutMs: Math.min(12_000, Math.max(1_000, deadline - clock())) });
    } catch (error) {
      const attempts = error instanceof LlmUnavailableError ? error.attempts : [];
      await deps.record({ kind: 'model', turn, ok: false, error: error instanceof Error ? error.message : String(error), result: { attempts } });
      return end('failed', texts.failed, { error: 'LLM_UNAVAILABLE', options: unverifiedOptions() });
    }
    const call = result.toolCalls[0];
    const { args, plan } = call ? parseCall(call) : { args: null, plan: null };
    await deps.record({
      kind: 'model', turn, ok: !!call, plan,
      model: { provider: result.provider, model: result.model, requestId: result.requestId, responseId: result.responseId, servedBy: result.servedBy, usage: result.usage, costUsd: result.costUsd, latencyMs: result.latencyMs, attempts: result.attempts, finishReason: result.finishReason },
      error: call ? null : 'NO_TOOL_CALL',
    });

    if (!call) {
      // Every turn must be a tool call: a plain reply is a failed turn, with feedback.
      state.messages.push({ role: 'assistant', content: result.content });
      state.messages.push({ role: 'user', content: `You must call one of these tools: ${PHASE_TOOLS[state.phase].join(', ')}.` });
      continue;
    }
    // Only the first call of a turn is processed; the history shows exactly that one.
    state.messages.push({ role: 'assistant', content: result.content, tool_calls: [call] });
    const reply = async (output: unknown, ok: boolean, error: string | null = null, started = clock()) => {
      state.outputs.push(output);
      state.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
      await deps.record({ kind: 'tool', turn, tool: call.function.name, plan, args, result: output, ok, error, latencyMs: clock() - started });
    };

    const name = call.function.name;
    if (!PHASE_TOOLS[state.phase].includes(name)) {
      await reply({ error: { code: 'NOT_ALLOWED', message: `${name} is not available now. Allowed: ${PHASE_TOOLS[state.phase].join(', ')}.` } }, false, 'NOT_ALLOWED');
      continue;
    }
    if (!args) {
      await reply({ error: { code: 'INVALID_ARGS', message: 'arguments must be a JSON object' } }, false, 'INVALID_ARGS');
      continue;
    }
    const toolStarted = clock();

    switch (name) {
      case 'resolve_place': {
        state.placeLookups = (state.placeLookups ?? 0) + 1;
        if (state.placeLookups > MAX_PLACE_LOOKUPS) {
          await reply({ error: { code: 'TOO_MANY_LOOKUPS', message: 'Stop looking up places: ask the user (ask_clarification), or decline if the request is not about finding a ride.' } }, false, 'TOO_MANY_LOOKUPS', toolStarted);
          break;
        }
        const outcome = await runReadTool(name, JSON.stringify(args), deps.context);
        if (!outcome.ok) { await reply(outcome, false, outcome.error.code, toolStarted); break; }
        // Each candidate gets a reference the spec must use ("place:3"): no free text, no made-up coordinates.
        const resolved = outcome.result as ResolvedPlace;
        const candidates = resolved.candidates.map((candidate) => {
          const ref = `place:${state.nextPlace++}`;
          state.places[ref] = { ref, label: candidate.label, lat: candidate.lat, lng: candidate.lng, query: resolved.query, ambiguous: resolved.ambiguous };
          return { ref, ...candidate };
        });
        await reply({ query: resolved.query, ambiguous: resolved.ambiguous, candidates, ...(candidates.length ? {} : { hint: 'No place found: ask the user where exactly (ask_clarification); do not guess other places.' }) }, true, null, toolStarted);
        break;
      }
      case 'submit_request_spec': {
        const check = checkSpec(args, new Map(Object.entries(state.places)), new Date(clock()));
        if (check.ok) {
          state.spec = check.spec;
          state.phase = 'search';
          progress({ step: 'understanding', status: 'done' });
          progress({ step: 'searching', status: 'active' });
          await reply({ accepted: true, spec: describeSpec(check.spec) }, true, null, toolStarted);
        } else {
          state.specRejections += 1;
          await reply({ accepted: false, errors: check.errors }, false, 'SPEC_REJECTED', toolStarted);
          if (state.specRejections >= MAX_SPEC_REJECTIONS) return end('clarify', texts.clarify);
        }
        break;
      }
      case 'search_trips': {
        // Place references ("place:2") become the candidate's coordinates; unknown references stay invalid.
        for (const key of ['origin', 'destination'] as const) {
          const value = args[key];
          if (typeof value === 'string' && state.places[value]) args[key] = { lat: state.places[value].lat, lng: state.places[value].lng, label: state.places[value].label };
        }
        const parsed = validateSearchArgs(args);
        const errors = parsed.ok ? checkSearchMatchesSpec(parsed.value, state.spec!) : [parsed.message];
        if (errors.length) { await reply({ error: { code: 'INVALID_ARGS', message: errors.join('; ') } }, false, 'INVALID_ARGS', toolStarted); break; }
        if (state.searchDone) {
          const next = state.lastSearch?.options.length ? 'propose the best option with propose_request_seat' : 'call answer_no_match (the user sees the nearby alternatives)';
          await reply({ error: { code: 'ALREADY_SEARCHED', message: `The accepted request was already searched and the result would be the same: ${next}.` } }, false, 'ALREADY_SEARCHED', toolStarted);
          break;
        }
        const outcome = await runReadTool(name, JSON.stringify(args), deps.context);
        if (!outcome.ok) { await reply(outcome, false, outcome.error.code, toolStarted); break; }
        const search = outcome.result as SearchResult;
        state.lastSearch = search;
        state.searchDone = true;
        for (const option of [...search.options, ...search.alternatives]) state.searched[option.trip_id] = option;
        progress({ step: 'searching', status: 'done' });
        progress({ step: 'checking', status: 'active' });
        await reply(search.options.length ? search : { ...search, next: 'No option in the accepted window, and the search cannot be widened: call answer_no_match now.' }, true, null, toolStarted);
        break;
      }
      case 'trip_details': {
        if (typeof args.trip_id !== 'string' || !state.searched[args.trip_id]) {
          await reply({ error: { code: 'INVALID_ARGS', message: 'trip_id must be one returned by search_trips in this run' } }, false, 'INVALID_ARGS', toolStarted);
          break;
        }
        const outcome = await runReadTool(name, JSON.stringify(args), deps.context);
        await reply(outcome.ok ? outcome.result : outcome, outcome.ok, outcome.ok ? null : outcome.error.code, toolStarted);
        break;
      }
      case 'ask_clarification': {
        const question = typeof args.question === 'string' ? args.question.trim().slice(0, 500) : '';
        if (!question) { await reply({ error: { code: 'INVALID_ARGS', message: 'question is required' } }, false, 'INVALID_ARGS', toolStarted); break; }
        await reply({ ended: 'clarify' }, true, null, toolStarted);
        return end('clarify', question);
      }
      case 'decline': {
        const message = typeof args.message === 'string' ? args.message.trim().slice(0, 500) : '';
        if (!message) { await reply({ error: { code: 'INVALID_ARGS', message: 'message is required' } }, false, 'INVALID_ARGS', toolStarted); break; }
        await reply({ ended: 'answered' }, true, null, toolStarted);
        return end('answered', message);
      }
      case 'answer_no_match': {
        const explanation = typeof args.explanation === 'string' ? args.explanation.trim().slice(0, 800) : '';
        if (!explanation || !state.lastSearch) {
          await reply({ error: { code: 'INVALID_ARGS', message: !explanation ? 'explanation is required' : 'search_trips first' } }, false, 'INVALID_ARGS', toolStarted);
          break;
        }
        if (openOptions().length) {
          await reply({ error: { code: 'HAS_OPTIONS', message: `${openOptions().length} option(s) can still be proposed; propose the best one with propose_request_seat` } }, false, 'HAS_OPTIONS', toolStarted);
          break;
        }
        const ungrounded = deps.ungroundedNumbers?.(explanation, state) ?? [];
        if (ungrounded.length) {
          await reply({ error: { code: 'UNGROUNDED', message: `these numbers are not in any tool result: ${ungrounded.join(', ')}; remove or correct them` } }, false, 'UNGROUNDED', toolStarted);
          break;
        }
        await reply({ ended: 'no_match' }, true, null, toolStarted);
        progress({ step: 'checking', status: 'done' });
        return end('no_match', explanation, { options: state.lastSearch.alternatives.filter((option) => !blocked()[option.trip_id]).map((option) => ({ ...option, verified: false })) });
      }
      case 'propose_request_seat': {
        const tripId = typeof args.trip_id === 'string' ? args.trip_id : '';
        const explanation = typeof args.explanation === 'string' ? args.explanation.trim().slice(0, 800) : '';
        if (!tripId || !explanation) { await reply({ error: { code: 'INVALID_ARGS', message: 'trip_id and explanation are required' } }, false, 'INVALID_ARGS', toolStarted); break; }
        if (blocked()[tripId]) { await reply({ error: { code: 'TRIP_BLOCKED', message: `This trip can't be proposed (${blocked()[tripId]}). ${nextAfterBlock()}` } }, false, 'TRIP_BLOCKED', toolStarted); break; }
        progress({ step: 'checking', status: 'done' });
        progress({ step: 'verifying', status: 'active' });
        state.proposeAttempts += 1;
        // Checkpoint 2 runs here, inside the tool: there is no way to propose without it.
        const verdict = await deps.verifyProposal({ tripId, explanation, state });
        if (verdict.verified) {
          await reply({ verified: true, checks: verdict.checks }, true, null, toolStarted);
          progress({ step: 'verifying', status: 'done' });
          return end('proposed', explanation, { proposal: verdict.proposal, options: [{ ...verdict.proposal.trip, verified: true }] });
        }
        if (verdict.tripBlocked) {
          // Not the explanation's fault: drop the trip and don't spend an attempt on it.
          state.proposeAttempts -= 1;
          state.blocked = { ...blocked(), [tripId]: verdict.failures.join('; ') };
          await reply({ verified: false, trip_blocked: true, failures: verdict.failures, next: nextAfterBlock() }, false, 'TRIP_BLOCKED', toolStarted);
          break;
        }
        await reply({ verified: false, failures: verdict.failures, attempts_left: MAX_PROPOSE_ATTEMPTS - state.proposeAttempts }, false, 'VERIFICATION_FAILED', toolStarted);
        if (state.proposeAttempts >= MAX_PROPOSE_ATTEMPTS) return end('unverified', texts.unverified, { options: unverifiedOptions() });
        break;
      }
    }
  }
  const options = unverifiedOptions();
  return end('limit', options.length ? texts.limit : texts.limitEmpty, { options });
}

/** What the trace and the screen show of the accepted spec. */
export function describeSpec(spec: AcceptedSpec) {
  return {
    origin: spec.origin ? { ref: spec.origin.ref, label: spec.origin.label } : null,
    destination: { ref: spec.destination.ref, label: spec.destination.label },
    date: spec.date,
    time: spec.time,
    flex_minutes: spec.flexMinutes,
    seats: spec.seats,
    max_price_cop: spec.maxPrice,
  };
}
