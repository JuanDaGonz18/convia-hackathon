import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { createTransport, ModelError, museStructured } from '../verify-pickup/model.ts';
import { isSuggestionReport, SUGGESTION_INSTRUCTIONS, SUGGESTION_SCHEMA, type SuggestionOutcome, toSuggestion } from './suggest.ts';

/**
 * suggest-vehicle: the driver adds a photo of their vehicle and Muse Spark
 * proposes brand, line, color and plate to prefill the form (suggest.ts).
 * Nothing is saved: the photo travels inline to the model and back, and the
 * driver confirms or corrects every field before saving the vehicle, which
 * goes through the usual vehicleService and RLS. The response has codes and
 * data, never text: the app translates it. Without MODEL_API_KEY it answers
 * with a fixed mock suggestion.
 */

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MODEL_API_KEY = Deno.env.get('MODEL_API_KEY') ?? '';
const MOCK = !MODEL_API_KEY.trim();
/** The app sends the photo resized to 1024 px; this leaves room without accepting arbitrary payloads. */
const MAX_IMAGE_CHARS = 3_000_000;
const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
/** Suggestions per user per hour, counted by this instance (each one is a Muse call, about $0.004). */
const MAX_PER_HOUR = 20;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function log(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: 'suggest-vehicle', event, ...data }));
}

const recent = new Map<string, number[]>();

/** true when the user still has suggestions left this hour (and records this one). */
function allow(userId: string) {
  const now = Date.now();
  const calls = (recent.get(userId) ?? []).filter((at) => now - at < 60 * 60 * 1000);
  if (calls.length >= MAX_PER_HOUR) return false;
  recent.set(userId, [...calls, now]);
  return true;
}

const transport = MOCK ? null : createTransport({ apiKey: MODEL_API_KEY, baseUrl: Deno.env.get('MODEL_API_BASE_URL') || undefined, log });

async function suggest(imageDataUrl: string): Promise<SuggestionOutcome> {
  if (!transport) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    return { status: 'ok', suggestion: { brand: 'Renault', line: 'Logan', color: 'Gris', plate: null } };
  }
  const report = await museStructured(transport, {
    label: 'muse:suggest_vehicle',
    system: SUGGESTION_INSTRUCTIONS,
    text: 'Describe the main vehicle in this photo.',
    imageDataUrl,
    schemaName: 'VehicleSuggestion',
    schema: SUGGESTION_SCHEMA,
    reasoningEffort: 'minimal',
  });
  if (!isSuggestionReport(report)) throw new ModelError('malformed', 'Muse JSON does not match the schema');
  return toSuggestion(report);
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

  let image = '';
  try {
    const body = await request.json() as { image?: unknown };
    image = typeof body.image === 'string' ? body.image : '';
  } catch {
    return response({ error: 'INVALID_BODY' }, 400);
  }
  if (!image || image.length > MAX_IMAGE_CHARS || !IMAGE_DATA_URL.test(image)) return response({ error: 'INVALID_BODY' }, 400);

  if (!allow(userId)) return response({ status: 'retry', reason: 'too_many_attempts', mock: MOCK });

  try {
    const outcome = await suggest(image);
    // Which fields were suggested, never their values (the plate is personal data).
    const filled = outcome.status === 'ok'
      ? Object.entries(outcome.suggestion).filter(([, value]) => value !== null).map(([key]) => key)
      : [];
    log('done', { status: outcome.status, reason: 'reason' in outcome ? outcome.reason : null, filled, mock: MOCK, ms: Math.round(performance.now() - started) });
    return response({ ...outcome, mock: MOCK });
  } catch (error) {
    const kind = error instanceof ModelError ? error.kind : 'server_error';
    log('error', { kind, detail: error instanceof Error ? error.message.slice(0, 200) : String(error) });
    return response({ status: 'retry', reason: kind, mock: MOCK });
  }
});
