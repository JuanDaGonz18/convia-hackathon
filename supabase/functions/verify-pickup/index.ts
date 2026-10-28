import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { isCarPlate, normalizePlate } from '../verify-vehicle/decision.ts';
import { pickupRetry } from './decision.ts';
import { createMockClient, mockOutcome } from './mock.ts';
import { createModelClient } from './model.ts';
import { analyzeClip, DEFAULT_PIPELINE_CONFIG, type FrameSource, type PipelineResult, type ProgressStep } from './pipeline.ts';

/**
 * verify-pickup: the passenger films the arriving car for up to 5 s and we
 * check it is the trip's car (see pipeline.ts). Only the trip's accepted
 * passenger can call it, while the trip is active, which is also when the
 * full plate is revealed to them. The clip and its frames are deleted from
 * Storage and from the model provider when the check ends; only the result
 * is stored. The response carries reason codes, never text: the app
 * translates them. Without MODEL_API_KEY it runs in mock mode.
 */

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MODEL_API_KEY = Deno.env.get('MODEL_API_KEY') ?? '';
const MOCK = !MODEL_API_KEY.trim();
const BUCKET = 'pickup-clips';
const MIN_CONFIDENCE = Number(Deno.env.get('PICKUP_MIN_CONFIDENCE')) || DEFAULT_PIPELINE_CONFIG.minConfidence;
const REASONING_EFFORT = (['minimal', 'low', 'medium', 'high'] as const).find((effort) => effort === Deno.env.get('PICKUP_REASONING_EFFORT')) ?? 'minimal';
/** Each real attempt costs 2 SAM calls (≥ 50 frames each) + 1 Muse call. */
const MAX_ATTEMPTS_PER_REQUEST = Number(Deno.env.get('PICKUP_MAX_ATTEMPTS')) || 6;
const MAX_FRAMES = 12;
const CLIP_NAME = /^clip-[A-Za-z0-9-]{8,64}\.(mp4|mov)$/;
const FRAME_NAME = /^frame-[A-Za-z0-9-]{8,64}-\d{1,5}\.jpg$/;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'verify-pickup', event, ...data }));
}

type FrameInput = { path: string; time_ms: number; width: number; height: number };

function parseFrames(value: unknown, folder: string): FrameInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_FRAMES) return null;
  const frames: FrameInput[] = [];
  for (const item of value) {
    const { path, time_ms: timeMs, width, height } = (item ?? {}) as Record<string, unknown>;
    if (typeof path !== 'string' || typeof timeMs !== 'number' || typeof width !== 'number' || typeof height !== 'number') return null;
    const [owner, request, name, ...rest] = path.split('/');
    if (`${owner}/${request}` !== folder || !FRAME_NAME.test(name ?? '') || rest.length) return null;
    if (timeMs < 0 || timeMs > 10_000 || width < 16 || height < 16 || width > 8000 || height > 8000) return null;
    frames.push({ path, time_ms: timeMs, width, height });
  }
  return frames;
}

// ─── Demo samples ───────────────────────────────────────────────────────────
// Demo accounts (judges) can't film the demo driver's car, so they pick one of
// three sample clips of fictional cars (generated with Muse Image). The clip
// and its frames come from a private bucket and go through the same real
// SAM + Muse pipeline; only the source of the files changes.
const SAMPLE_BUCKET = 'pickup-samples';
const SAMPLES = ['match', 'other', 'covered'] as const;
const DEMO_EMAIL_DOMAIN = '@demo.convia.test';
/** Real sample checks (about $0.04 each) in the last 24 h: per demo account, and for all demo accounts together. */
const DEMO_MAX_PER_ACCOUNT = Number(Deno.env.get('PICKUP_DEMO_MAX_PER_ACCOUNT')) || 60;
const DEMO_MAX_TOTAL = Number(Deno.env.get('PICKUP_DEMO_MAX_TOTAL')) || 300;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A demo account may run another sample check while under its own limit and the shared one. */
async function demoCheckAllowed(userId: string) {
  const { data: demoUsers, error } = await admin.from('profiles').select('id').ilike('email', `%${DEMO_EMAIL_DOMAIN}`);
  if (error) throw error;
  const { data: checks, error: checksError } = await admin
    .from('pickup_verifications')
    .select('passenger_id')
    .in('passenger_id', demoUsers.map((user) => user.id))
    .gte('created_at', new Date(Date.now() - DAY_MS).toISOString());
  if (checksError) throw checksError;
  const own = checks.filter((check) => check.passenger_id === userId).length;
  log('demo_quota', { own, total: checks.length });
  return own < DEMO_MAX_PER_ACCOUNT && checks.length < DEMO_MAX_TOTAL;
}

/** Real checks of filmed clips, per request. */
async function requestCheckAllowed(requestId: string) {
  const { count, error } = await admin.from('pickup_verifications').select('id', { count: 'exact', head: true }).eq('request_id', requestId);
  if (error) throw error;
  return (count ?? 0) < MAX_ATTEMPTS_PER_REQUEST;
}

/** The sample's clip and frames (pickup-samples/<sample>/frames.json lists them). */
async function loadSample(sample: (typeof SAMPLES)[number]): Promise<{ clipPath: string; frames: FrameInput[] }> {
  const manifest = JSON.parse(new TextDecoder().decode(await download(`${sample}/frames.json`, SAMPLE_BUCKET))) as FrameInput[];
  return { clipPath: `${sample}/clip.mp4`, frames: manifest.slice(0, MAX_FRAMES) };
}

async function download(path: string, bucket = BUCKET) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`download failed: ${path}`);
  return new Uint8Array(await data.arrayBuffer());
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const started = performance.now();

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'AUTH_REQUIRED' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return response({ error: 'AUTH_REQUIRED' }, 401);
  const userId = authData.user.id;

  let body: { request_id?: unknown; clip_path?: unknown; frames?: unknown; sample?: unknown; mock_outcome?: unknown };
  try {
    body = await request.json();
  } catch {
    return response({ error: 'INVALID_BODY' }, 400);
  }
  const requestId = typeof body.request_id === 'string' ? body.request_id : '';
  let args: VerifyArgs;
  if (body.sample !== undefined) {
    const sample = SAMPLES.find((name) => name === body.sample);
    if (!requestId || !sample) return response({ error: 'INVALID_BODY' }, 400);
    if (!authData.user.email?.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) return response({ error: 'SAMPLES_DEMO_ONLY' }, 403);
    let sampleFiles;
    try {
      sampleFiles = await loadSample(sample);
    } catch {
      return response({ error: 'SAMPLE_NOT_FOUND' }, 404);
    }
    const { clipPath, frames } = sampleFiles;
    // Sample files are shared and kept: nothing to delete afterwards.
    args = { userId, requestId, clipPath, frames, uploaded: [], bucket: SAMPLE_BUCKET, demo: true, mockOutcome: body.mock_outcome, started };
  } else {
    const parsed = parseUpload(body, userId, requestId);
    if (!parsed) return response({ error: 'INVALID_BODY' }, 400);
    args = { userId, requestId, ...parsed, bucket: BUCKET, demo: false, mockOutcome: body.mock_outcome, started };
  }
  return answerRequest(request, args);
});

/** The caller's own uploaded clip and frames for this request, or null if the paths are not theirs. */
function parseUpload(body: { clip_path?: unknown; frames?: unknown }, userId: string, requestId: string) {
  const clipPath = typeof body.clip_path === 'string' ? body.clip_path : '';
  const folder = `${userId}/${requestId}`;
  const [owner, requestFolder, clipName, ...rest] = clipPath.split('/');
  const frames = parseFrames(body.frames, folder);
  // Files must be in the caller's own folder for this request.
  if (!requestId || `${owner}/${requestFolder}` !== folder || !CLIP_NAME.test(clipName ?? '') || rest.length || !frames) return null;
  return { clipPath, frames, uploaded: [clipPath, ...frames.map((frame) => frame.path)] };
}

async function answerRequest(request: Request, args: VerifyArgs) {
  // The app asks for NDJSON to show real progress; anything else gets one JSON answer.
  if (!request.headers.get('accept')?.includes('application/x-ndjson')) {
    const outcome = await verify(args, () => undefined);
    await outcome.after();
    return response(outcome.body, outcome.status);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      const outcome = await verify(args, (step) => send({ type: 'progress', step }));
      // The passenger gets the answer first; saving the row and deleting the files happen after.
      send({ type: 'result', status: outcome.status, body: outcome.body });
      await outcome.after();
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}

type VerifyArgs = {
  userId: string;
  requestId: string;
  clipPath: string;
  frames: FrameInput[];
  uploaded: string[];
  /** Where the clip and frames are: the caller's uploads, or the demo samples. */
  bucket: string;
  /** A demo account using a sample: limited per day instead of per request. */
  demo: boolean;
  mockOutcome: unknown;
  started: number;
};

type Outcome = { status: number; body: Record<string, unknown>; after: () => Promise<void> };

async function verify(args: VerifyArgs, onProgress: (step: ProgressStep | 'analyzing') => void): Promise<Outcome> {
  const { userId, requestId, clipPath, frames, uploaded, bucket, demo, started } = args;
  // No video or frame is ever kept: they may show the plate, the street and people.
  const cleanup = async () => {
    if (!uploaded.length) return;
    const { error } = await admin.storage.from(BUCKET).remove(uploaded);
    if (error) log('cleanup_error', { detail: error.message });
  };
  const finish = (status: number, body: Record<string, unknown>, save?: () => Promise<void>): Outcome => ({
    status,
    body,
    after: async () => {
      await Promise.all([save?.(), cleanup()]);
    },
  });

  try {
    const { data: tripRequest, error: requestError } = await admin
      .from('trip_requests')
      .select('id, trip_id, passenger_id, estado, trips!inner(id, estado, driver_id, vehicle_id)')
      .eq('id', requestId)
      .maybeSingle();
    if (requestError) throw requestError;
    const trip = tripRequest?.trips as unknown as { id: string; estado: string; driver_id: string; vehicle_id: string } | undefined;
    // Someone else's request looks the same as a missing one.
    if (!tripRequest || !trip || tripRequest.passenger_id !== userId) return finish(404, { error: 'REQUEST_NOT_FOUND' });
    // The plate is only revealed after the request is accepted, and only while the trip is active.
    if (tripRequest.estado !== 'aceptado' || !['por_empezar', 'en_curso'].includes(trip.estado)) {
      return finish(409, { error: 'REQUEST_NOT_ACCEPTED' });
    }

    // Everything the check needs, at once.
    const downloadStarted = performance.now();
    const videoDownload = download(clipPath, bucket).then((bytes) => ({ bytes, ms: Math.round(performance.now() - downloadStarted) }));
    videoDownload.catch(() => undefined);
    const [{ data: vehicle, error: vehicleError }, { data: driver, error: driverError }, allowed] = await Promise.all([
      admin.from('vehicles').select('placa, marca, color').eq('id', trip.vehicle_id).single(),
      admin.from('profiles').select('nombre, telefono').eq('id', trip.driver_id).single(),
      demo ? demoCheckAllowed(userId) : requestCheckAllowed(requestId),
    ]);
    if (vehicleError) throw vehicleError;
    if (driverError) throw driverError;
    const registered = { plate: normalizePlate(vehicle.placa), brand: vehicle.marca, color: vehicle.color };
    // Motorcycle plates (ABC12D) can't be checked with this flow.
    if (!isCarPlate(registered.plate)) return finish(422, { error: 'UNSUPPORTED_VEHICLE' });

    const answer = (result: PipelineResult, verificationId: string | null) => {
      const { decision, report } = result;
      return {
        verification_id: verificationId,
        status: decision.status,
        reason: decision.reason,
        plate_read: decision.plateRead,
        confidence: decision.confidence,
        brand_match: decision.brandMatch,
        color_match: decision.colorMatch,
        brand_read: report?.brand ?? null,
        color_read: report?.color ?? null,
        // What the passenger compares with the car in front of them, and how to reach the driver.
        vehicle: { plate: registered.plate, brand: registered.brand, color: registered.color },
        driver: { name: driver.nombre, phone: driver.telefono ?? null },
        mock: MOCK,
      };
    };
    if (!allowed) {
      return finish(200, answer({ decision: pickupRetry('too_many_attempts'), report: null, framesProcessed: null, timings: {}, debug: {} }, null));
    }

    onProgress('analyzing');
    const { bytes: video, ms: downloadMs } = await videoDownload;
    const sources: FrameSource[] = frames.map((frame) => ({
      timeMs: frame.time_ms,
      width: frame.width,
      height: frame.height,
      load: () => download(frame.path, bucket),
    }));
    const client = MOCK
      ? createMockClient(registered, mockOutcome(registered.plate, args.mockOutcome))
      : createModelClient({ apiKey: MODEL_API_KEY, baseUrl: Deno.env.get('MODEL_API_BASE_URL') || undefined, reasoningEffort: REASONING_EFFORT, log });
    const result = await analyzeClip({ video, frames: sources }, registered, client, { ...DEFAULT_PIPELINE_CONFIG, minConfidence: MIN_CONFIDENCE }, onProgress);
    result.timings.download = downloadMs;
    const latencyMs = Math.round(performance.now() - started);
    const { decision, report } = result;
    // Chosen here so the answer can carry it before the row is saved.
    const verificationId = crypto.randomUUID();
    log('done', { status: decision.status, reason: decision.reason, mock: MOCK, demo, ms: latencyMs, timings: result.timings, frames: result.framesProcessed, debug: result.debug });

    return finish(200, answer(result, verificationId), async () => {
      const { error: saveError } = await admin.from('pickup_verifications').insert({
        id: verificationId,
        trip_id: trip.id,
        request_id: requestId,
        passenger_id: userId,
        driver_id: trip.driver_id,
        status: decision.status,
        reason: decision.reason,
        plate_read: decision.plateRead,
        brand_read: report?.brand ?? null,
        color_read: report?.color ?? null,
        confidence: decision.confidence,
        brand_match: decision.brandMatch,
        color_match: decision.colorMatch,
        frames_processed: result.framesProcessed,
        latency_ms: latencyMs,
        timings: result.timings,
        mock: MOCK,
      });
      if (saveError) log('save_error', { detail: saveError.message });
    });
  } catch (error) {
    log('error', { detail: error instanceof Error ? error.message : String(error) });
    return finish(200, {
      verification_id: null,
      status: 'retry',
      reason: 'server_error',
      plate_read: null,
      confidence: null,
      brand_match: null,
      color_match: null,
      brand_read: null,
      color_read: null,
      vehicle: null,
      driver: null,
      mock: MOCK,
    });
  }
}
