// verify-pickup in MOCK mode against the LOCAL stack only (never production):
// who can call it, the three outcomes, files deleted, stored rows + RLS,
// reporting a mismatch and the per-request attempt limit.
// Creates throwaway @unisabana.edu.co users in the local database.
//
// Run:
//   npx supabase start
//   npx supabase functions serve verify-pickup      (no MODEL_API_KEY → mock)
//   npm run test:verify-pickup
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const ANON = process.env.LOCAL_ANON;
const SERVICE = process.env.LOCAL_SERVICE;
if (!ANON || !SERVICE) {
  console.error('Faltan LOCAL_ANON / LOCAL_SERVICE (usa npm run test:verify-pickup).');
  process.exit(1);
}
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const BUCKET = 'pickup-clips';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

async function makeUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Test-12345!', email_confirm: true, user_metadata: { nombre: 'ZZ Prueba', rol: 'usuario', terms_accepted: true, terms_version: '1.0' } });
  if (error) throw error;
  const client = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: 'Test-12345!' });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

const CLIP = readFileSync(new globalThis.URL('../functions/verify-pickup/fixtures/square-faststart.mp4', import.meta.url));
// Minimal valid JPEG (1x1).
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

/** Uploads a clip and two frames as the app does; returns the function body. */
async function upload(user, requestId) {
  const attempt = crypto.randomUUID();
  const folder = `${user.id}/${requestId}`;
  const clipPath = `${folder}/clip-${attempt}.mp4`;
  const frames = [0, 500].map((ms) => ({ path: `${folder}/frame-${attempt}-${ms}.jpg`, time_ms: ms, width: 640, height: 360 }));
  const { error } = await user.client.storage.from(BUCKET).upload(clipPath, CLIP, { contentType: 'video/mp4' });
  if (error) throw error;
  for (const frame of frames) {
    const { error: frameError } = await user.client.storage.from(BUCKET).upload(frame.path, JPEG, { contentType: 'image/jpeg' });
    if (frameError) throw frameError;
  }
  return { request_id: requestId, clip_path: clipPath, frames };
}

async function invoke(user, body) {
  const { data, error } = await user.client.functions.invoke('verify-pickup', { body });
  if (error) return { httpStatus: error.context?.status, data: null };
  return { httpStatus: 200, data };
}

async function leftFiles(user, requestId) {
  const { data } = await admin.storage.from(BUCKET).list(`${user.id}/${requestId}`);
  return data?.length ?? 0;
}

const stamp = Date.now();
const driver = await makeUser(`zz.pkdriver${stamp}@unisabana.edu.co`);
const passenger = await makeUser(`zz.pkpass${stamp}@unisabana.edu.co`);
const stranger = await makeUser(`zz.pkother${stamp}@unisabana.edu.co`);

// Only approved drivers can publish trips.
const { error: approveError } = await admin.from('driver_profiles').upsert({ user_id: driver.id, status: 'aprobado' });
if (approveError) throw approveError;

const plate = `PKP${String(stamp % 100).padStart(2, '0')}1`; // ends in 1 → verified by default
const { data: vehicle, error: vehicleError } = await admin
  .from('vehicles').insert({ driver_id: driver.id, placa: plate, marca: 'Renault Logan', color: 'Gris', puestos: 4 }).select('id').single();
if (vehicleError) throw vehicleError;
await admin.from('profiles').update({ telefono: '3001234567' }).eq('id', driver.id);
const { data: trip, error: tripError } = await admin.from('trips').insert({
  driver_id: driver.id, vehicle_id: vehicle.id, origen_nombre: 'Campus', destino_nombre: 'Chía',
  salida_at: new Date(Date.now() + 3600_000).toISOString(), precio: 5000, cupos_totales: 3,
}).select('id').single();
if (tripError) throw tripError;
// Requesting a seat needs a recent face check (done on the phone in the app).
const { error: faceError } = await admin.from('face_verifications').insert({ user_id: passenger.id, status: 'verificado', provider: 'on_device_sface', purpose: 'trip_request', template_kind: 'selfie' });
if (faceError) throw faceError;
const { data: tripRequest, error: requestError } = await admin.from('trip_requests')
  .insert({ trip_id: trip.id, passenger_id: passenger.id, direccion: 'Puente del Común', estado: 'pendiente' }).select('id').single();
if (requestError) throw requestError;
const requestId = tripRequest.id;

// Not accepted yet → 409, and the uploaded files are still cleaned up.
{
  const r = await invoke(passenger, await upload(passenger, requestId));
  check('pending request → 409', r.httpStatus === 409, String(r.httpStatus));
  check('files deleted even when refused', (await leftFiles(passenger, requestId)) === 0);
}
await admin.from('trip_requests').update({ estado: 'aceptado' }).eq('id', requestId);

// Default outcome by plate digit, and what the passenger gets back
{
  const r = await invoke(passenger, await upload(passenger, requestId));
  check('accepted, plate ends in 1 → verified', r.data?.status === 'verified' && r.data?.reason === 'plate_match' && r.data?.mock === true, JSON.stringify(r.data));
  check('returns the trip car and the driver to compare and call', r.data?.vehicle?.plate === plate && r.data?.driver?.name === 'ZZ Prueba' && r.data?.driver?.phone === '3001234567');
  check('no free text, only reason codes', r.data && !('message' in r.data));
  check('clip and frames deleted after the check', (await leftFiles(passenger, requestId)) === 0);
}
let mismatchId = null;
for (const outcome of ['verified', 'mismatch', 'retry']) {
  const r = await invoke(passenger, { ...(await upload(passenger, requestId)), mock_outcome: outcome });
  check(`mock_outcome=${outcome}`, r.data?.status === outcome, r.data?.reason);
  if (outcome === 'mismatch') mismatchId = r.data?.verification_id;
}

// Security
{
  const r = await invoke(stranger, await upload(stranger, requestId));
  check("someone else's request → 404", r.httpStatus === 404);
  const body = await upload(passenger, requestId);
  const r2 = await invoke(passenger, { ...body, clip_path: `${stranger.id}/${requestId}/clip-${crypto.randomUUID()}.mp4` });
  check("clip outside the caller's folder → 400", r2.httpStatus === 400);
  const r3 = await invoke(passenger, { ...body, frames: [] });
  check('no frames → 400', r3.httpStatus === 400);
  await admin.storage.from(BUCKET).remove([body.clip_path, ...body.frames.map((frame) => frame.path)]);
  const res = await fetch(`${URL}/functions/v1/verify-pickup`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: '{}' });
  check('no JWT → 401', res.status === 401);
  const { data: peek } = await stranger.client.storage.from(BUCKET).list(`${passenger.id}/${requestId}`);
  check("nobody else can list a passenger's clips", (peek ?? []).length === 0);
}

// Stored rows + RLS + report
{
  const { data: rows } = await passenger.client.from('pickup_verifications').select('status, reason, latency_ms, timings, frames_processed').eq('request_id', requestId);
  check('passenger reads the results (4 saved)', rows?.length === 4, JSON.stringify(rows?.map((row) => row.status)));
  check('latency and per-step timings stored', rows?.every((row) => row.latency_ms > 0 && typeof row.timings?.total === 'number'));
  const { data: driverRows } = await driver.client.from('pickup_verifications').select('id').eq('request_id', requestId);
  check('driver of the trip reads them too', driverRows?.length === 4);
  const { data: foreign } = await stranger.client.from('pickup_verifications').select('id').eq('request_id', requestId);
  check("anyone else can't", (foreign ?? []).length === 0);
  const { error: insertError } = await passenger.client.from('pickup_verifications').insert({
    trip_id: trip.id, request_id: requestId, passenger_id: passenger.id, driver_id: driver.id, status: 'verified', reason: 'fake', latency_ms: 1,
  });
  check("passenger can't self-insert a verified row", !!insertError, insertError?.message);

  const { error: strangerReport } = await stranger.client.rpc('report_pickup_mismatch', { p_verification_id: mismatchId });
  check("someone else can't report it", !!strangerReport);
  const { error: reportError } = await passenger.client.rpc('report_pickup_mismatch', { p_verification_id: mismatchId });
  check('passenger reports the mismatch', !reportError, reportError?.message);
  const { error: againError } = await passenger.client.rpc('report_pickup_mismatch', { p_verification_id: mismatchId });
  check('only once', !!againError);
}

// Progress as NDJSON (what the app uses): real steps in order, then the result
{
  const { data: session } = await passenger.client.auth.getSession();
  const res = await fetch(`${URL}/functions/v1/verify-pickup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.session.access_token}`, apikey: ANON, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
    body: JSON.stringify({ ...(await upload(passenger, requestId)), mock_outcome: 'verified' }),
  });
  const events = (await res.text()).trim().split('\n').map((line) => JSON.parse(line));
  const steps = events.filter((event) => event.type === 'progress').map((event) => event.step);
  const last = events.at(-1);
  check('NDJSON: progress steps in order', JSON.stringify(steps) === JSON.stringify(['analyzing', 'car_found', 'plate_found', 'reading_plate']), JSON.stringify(steps));
  check('NDJSON: ends with the result', last?.type === 'result' && last.status === 200 && last.body?.status === 'verified' && !!last.body?.verification_id);
  check('NDJSON: files deleted after the stream ends', (await leftFiles(passenger, requestId)) === 0);
}

// Attempt limit: 6 per request (5 already + 1 more allowed)
{
  let last;
  for (let i = 0; i < 2; i++) last = await invoke(passenger, await upload(passenger, requestId));
  check('7th attempt → retry too_many_attempts', last.data?.status === 'retry' && last.data?.reason === 'too_many_attempts', last.data?.reason);
  check('files deleted when the limit is hit', (await leftFiles(passenger, requestId)) === 0);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
