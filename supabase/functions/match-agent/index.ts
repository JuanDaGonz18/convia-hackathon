import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createLlm, providersFromEnv } from '../_shared/llm.ts';
import { confirmProposal, type StoredRun } from './confirm.ts';
import { supabaseToolData } from './data.ts';
import { fixtureData, FIXTURE_NOW } from './evalData.ts';
import { createJudge } from './judge.ts';
import { type AgentOutcome, describeSpec, type LoopDeps, newRunState, type RunState, runAgent, type TraceStep } from './loop.ts';
import { buildObjective } from './objective.ts';
import { photonGeocoder } from './places.ts';
import { type StepRow, toStepRow, totals } from './trace.ts';
import { type Judge, ungroundedInRun, type VerifyData, verifyProposal } from './verify.ts';
import type { ToolData } from './tools.ts';

/**
 * match-agent: the ride-matching agent (Muse Spark Open on Baseten, Modal as fallback).
 *
 *   POST /match-agent           { message, language?, run_id?, step? }  → NDJSON progress, then the result
 *   POST /match-agent/confirm   { run_id, proposal_hash }               → the seat request, bound to the proposal
 *   POST /match-agent           { eval: { passenger, text, language } } → service role only: one evaluation case
 *                                                                          on the fixture data (no accounts, no DB)
 *
 * Tools read with the CALLER's session (RLS). The service role only writes the trace.
 */

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const admin = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MODEL_API_KEY = Deno.env.get('MODEL_API_KEY') ?? '';
const RUNS_PER_DAY = Number(Deno.env.get('AGENT_RUNS_PER_DAY')) || 30;
const DEMO_DOMAIN = '@demo.convia.test';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, accept',
  'Content-Type': 'application/json',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'match-agent', event, ...data }));

function isServiceRole(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).role === 'service_role';
  } catch {
    return false;
  }
}

/** The pieces every run shares: the open-weights models, the judge (a different model) and the loop deps. */
function buildDeps(data: ToolData & VerifyData, record: LoopDeps['record'], now: () => number, viewerId: string, geocode = true, onlyProvider?: string): LoopDeps {
  // Eval mode can pin one provider (baseten or modal) to compare them on the same cases.
  const env = (name: string) => (name === 'AGENT_PROVIDERS' && onlyProvider ? onlyProvider : Deno.env.get(name));
  const llm = createLlm({ providers: providersFromEnv(env) });
  const judge = createJudge({ apiKey: MODEL_API_KEY, baseUrl: Deno.env.get('MODEL_API_BASE_URL') || undefined, log });
  let judgeTurn = 0;
  // The judge's verdict is part of the trace ("How the agent decided").
  const tracedJudge: Judge = async (input) => {
    const started = Date.now();
    try {
      const verdict = await judge(input);
      await record({ kind: 'tool', turn: ++judgeTurn, tool: 'judge', plan: 'Check every claim against the trip data (Muse Spark 1.3)', result: { model: 'muse-spark-1.3', request_id: judge.last?.requestId ?? null, ...verdict }, ok: verdict.allSupported, latencyMs: Date.now() - started, kindOverride: 'judge' } as TraceStep);
      return verdict;
    } catch (error) {
      await record({ kind: 'tool', turn: ++judgeTurn, tool: 'judge', ok: false, error: String((error as Error)?.message ?? error).slice(0, 200), latencyMs: Date.now() - started, kindOverride: 'judge' } as TraceStep);
      throw error;
    }
  };
  return {
    chat: llm.chat,
    context: { data, geocode: geocode ? photonGeocoder() : undefined, now: new Date(now()), viewerId },
    verifyProposal: ({ tripId, explanation, state }) => verifyProposal({ tripId, explanation, state }, { data, judge: tracedJudge, now: new Date(now()) }),
    ungroundedNumbers: ungroundedInRun,
    record,
    clock: now,
  };
}

/** What the app receives at the end of a run. */
function resultBody(runId: string | null, outcome: AgentOutcome) {
  return {
    run_id: runId,
    status: outcome.status,
    reply: outcome.reply,
    spec: outcome.spec ? describeSpec(outcome.spec) : null,
    options: outcome.options,
    proposal: outcome.proposal ? {
      hash: outcome.proposal.hash,
      trip_id: outcome.proposal.trip.trip_id,
      seats: outcome.proposal.seats,
      price_cop: outcome.proposal.price,
      departure: outcome.proposal.trip.departure,
      pickup: outcome.proposal.fields.pickup?.label ?? null,
      dropoff: outcome.proposal.fields.dropoff.label,
    } : null,
    error: outcome.error,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return json({ error: 'AUTH_REQUIRED' }, 401);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_BODY' }, 400);
  }

  // ── Evaluation: one case on the fixture, service role only; returns the full trace. ──
  if (body.eval) {
    if (!isServiceRole(token)) return json({ error: 'FORBIDDEN' }, 403);
    const evalCase = body.eval as { passenger?: string; text?: string; language?: 'es' | 'en'; provider?: 'baseten' | 'modal' };
    if (typeof evalCase.passenger !== 'string' || typeof evalCase.text !== 'string') return json({ error: 'INVALID_BODY' }, 400);
    const trace: TraceStep[] = [];
    // Fixture time: "now" is day 0 06:00, moving with the real clock so the deadline still applies.
    const offset = Date.now() - FIXTURE_NOW.getTime();
    const now = () => Date.now() - offset;
    const provider = evalCase.provider === 'modal' || evalCase.provider === 'baseten' ? evalCase.provider : undefined;
    const deps = buildDeps(fixtureData(evalCase.passenger), (step) => { trace.push(step); }, now, `viewer-${evalCase.passenger}`, false, provider);
    const started = Date.now();
    const language = evalCase.language === 'en' ? 'en' : 'es';
    const outcome = await runAgent(newRunState(buildObjective({ text: evalCase.text, language, now: new Date(now()) })), deps, language);
    const rows = trace.map((step, index) => toStepRow('eval', index + 1, step as TraceStep & { kindOverride?: 'judge' }));
    return json({ ...resultBody(null, outcome), turns: outcome.state.turns, spec_rejections: outcome.state.specRejections, propose_attempts: outcome.state.proposeAttempts, latency_ms: Date.now() - started, totals: totals(rows), trace: rows });
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'AUTH_REQUIRED' }, 401);
  const user = authData.user;
  const userClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

  // ── Confirm: the user's tap, bound to the exact proposal. ──
  if (new URL(request.url).pathname.endsWith('/confirm')) {
    if (user.email?.toLowerCase().endsWith(DEMO_DOMAIN)) return json({ error: 'DEMO_CONFIRM_DISABLED' }, 403);
    if (typeof body.run_id !== 'string' || typeof body.proposal_hash !== 'string') return json({ error: 'INVALID_BODY' }, 400);
    const runId = body.run_id;
    const { data: run } = await admin.from('agent_runs').select('user_id, status, proposal_hash, pending_action, pending_action_used_at, finished_at').eq('id', runId).maybeSingle();
    const data = supabaseToolData(userClient);
    const result = await confirmProposal({ run: run as StoredRun | null, callerId: user.id, hashFromClient: body.proposal_hash, now: new Date() }, {
      readTrip: (tripId) => data.availableTrip(tripId),
      claim: async () => {
        const { data: claimed } = await admin.from('agent_runs').update({ pending_action_used_at: new Date().toISOString() }).eq('id', runId).is('pending_action_used_at', null).select('id');
        return !!claimed?.length;
      },
      release: async () => { await admin.from('agent_runs').update({ pending_action_used_at: null }).eq('id', runId); },
      insertRequest: async (fields) => {
        // The user's own session: the database still checks the fresh face check, seats, institution and the 90-minute rule.
        const { data: inserted, error } = await userClient.from('trip_requests').insert({
          trip_id: fields.trip_id,
          passenger_id: user.id,
          direccion: fields.pickup?.label ?? fields.dropoff.label,
          lat: fields.pickup?.lat ?? null,
          lng: fields.pickup?.lng ?? null,
          destino_nombre: fields.dropoff.label,
          destino_lat: fields.dropoff.lat,
          destino_lng: fields.dropoff.lng,
        }).select('id').single();
        if (error) throw new Error(error.message);
        return inserted.id as string;
      },
    });
    if (result.ok) await admin.from('agent_runs').update({ status: 'confirmed', confirmed_request_id: result.requestId }).eq('id', runId);
    log('confirm', { ok: result.ok, code: result.ok ? null : result.code });
    return json(result.ok ? { ok: true, request_id: result.requestId } : { ok: false, error: result.code, detail: result.detail ?? null }, result.ok ? 200 : 409);
  }

  // ── A run: NDJSON progress, then the result. ──
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const resumeId = typeof body.run_id === 'string' ? body.run_id : null;
  const language = body.language === 'en' ? 'en' : 'es';
  const step = body.step === true;
  if (!message && !resumeId) return json({ error: 'INVALID_BODY' }, 400);
  // Step-through debugging is for development (eval and demo accounts).
  if (step && !user.email?.toLowerCase().endsWith(DEMO_DOMAIN)) return json({ error: 'STEP_NOT_ALLOWED' }, 403);

  const { data: profile } = await admin.from('profiles').select('institution_id').eq('id', user.id).single();
  if (!profile?.institution_id) return json({ error: 'INSTITUTION_NOT_VERIFIED' }, 403);

  let runId: string;
  let state: RunState;
  if (resumeId) {
    const { data: run } = await admin.from('agent_runs').select('user_id, status, state').eq('id', resumeId).maybeSingle();
    if (!run || run.user_id !== user.id || run.status !== 'paused' || !run.state) return json({ error: 'NOT_FOUND' }, 404);
    runId = resumeId;
    state = run.state as RunState;
  } else {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await admin.from('agent_runs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since);
    if ((count ?? 0) >= RUNS_PER_DAY) return json({ error: 'TOO_MANY_ATTEMPTS' }, 429);
    const { data: created, error } = await admin.from('agent_runs').insert({ user_id: user.id, role: 'passenger', input: message.slice(0, 1000), language }).select('id').single();
    if (error || !created) return json({ error: 'RUN_NOT_CREATED' }, 500);
    runId = created.id;
    state = newRunState(buildObjective({ text: message, language, now: new Date() }));
  }

  const { count: existingSteps } = await admin.from('agent_steps').select('id', { count: 'exact', head: true }).eq('run_id', runId);
  let n = existingSteps ?? 0;
  const rows: StepRow[] = [];
  const started = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(new TextEncoder().encode(`${JSON.stringify(event)}\n`));
      const record = async (traceStep: TraceStep) => {
        const row = toStepRow(runId, ++n, traceStep as TraceStep & { kindOverride?: 'judge' });
        rows.push(row);
        const { error } = await admin.from('agent_steps').insert(row);
        if (error) log('trace_error', { detail: error.message });
      };
      const deps = { ...buildDeps(supabaseToolData(userClient), record, () => Date.now(), user.id), progress: (event: { step: string; status: string }) => send({ type: 'progress', ...event }), turnsThisCall: step ? 1 : undefined };
      let outcome: AgentOutcome;
      try {
        outcome = await runAgent(state, deps, language);
      } catch (error) {
        log('run_error', { detail: String((error as Error)?.message ?? error).slice(0, 200) });
        outcome = { status: 'failed', reply: null, spec: state.spec, proposal: null, options: [], state, error: 'RUN_FAILED' };
      }
      const sums = totals(rows);
      await admin.from('agent_runs').update({
        status: outcome.status,
        reply: { reply: outcome.reply, options: outcome.options },
        spec: outcome.spec ? describeSpec(outcome.spec) : null,
        state: outcome.status === 'paused' ? outcome.state : null,
        pending_action: outcome.proposal ? { fields: outcome.proposal.fields, explanation: outcome.proposal.explanation, trip: outcome.proposal.trip } : null,
        proposal_hash: outcome.proposal?.hash ?? null,
        steps: n,
        prompt_tokens: sums.prompt_tokens,
        completion_tokens: sums.completion_tokens,
        reasoning_tokens: sums.reasoning_tokens,
        cached_tokens: sums.cached_tokens,
        cost_usd: sums.cost_usd,
        latency_ms: Date.now() - started,
        error: outcome.error,
        finished_at: outcome.status === 'paused' ? null : new Date().toISOString(),
      }).eq('id', runId);
      log('run_done', { status: outcome.status, turns: outcome.state.turns, ms: Date.now() - started, cost: sums.cost_usd });
      send({ type: 'result', ...resultBody(runId, outcome) });
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
});
