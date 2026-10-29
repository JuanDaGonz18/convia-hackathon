import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createTransport } from '../verify-pickup/model.ts';
import { type CardReport, decideCard, decideDocument, type DocumentReport, type InstitutionRef } from './decide.ts';

/**
 * verify-student-id: the user's student card says they belong to the institution they chose.
 *
 * The phone (or browser) never sends the whole photo: only crops of the card AROUND the face,
 * so no face pixels reach the server or Meta. Muse Spark 1.3 reads the crops as strict JSON;
 * decide.ts decides. The face is compared on the phone (embedding vs the user's selfie, stored
 * by submit_student_card_face), on the phone and in the browser alike. Nothing is stored but the
 * result: no image, no name, last 4 ID digits only.
 */

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const MODEL_API_KEY = Deno.env.get('MODEL_API_KEY') ?? '';
const MODEL = 'muse-spark-1.3';
const MAX_CROPS = 4;
/** About 1.5 MB of JPEG per crop once decoded. */
const MAX_CROP_BASE64 = 2_000_000;
const MAX_CHECKS_PER_DAY = Number(Deno.env.get('STUDENT_ID_MAX_PER_DAY')) || 5;
/** The face comparison must be this recent (same rule as seat requests). */
const FACE_WINDOW_MS = 10 * 60 * 1000;
const MUSE_TIMEOUT_MS = 30_000;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'verify-student-id', event, ...data }));

const CARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_student_id_card', 'looks_like_screen_or_printout', 'readable', 'full_name', 'institution_name', 'id_number', 'expiry_date', 'confidence'],
  properties: {
    is_student_id_card: { type: 'boolean' },
    looks_like_screen_or_printout: { type: 'boolean' },
    readable: { type: 'boolean' },
    full_name: { type: ['string', 'null'] },
    institution_name: { type: ['string', 'null'] },
    id_number: { type: ['string', 'null'] },
    expiry_date: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
};

const SYSTEM = [
  'You read Colombian university student ID cards for a carpooling app.',
  'You receive crops of ONE card photo; the area around the person\'s photo was removed on purpose. Read all crops together.',
  'Return JSON only. Copy text exactly as printed; use null for anything you cannot read with certainty. Never guess.',
  'is_student_id_card: the crops show a student (or university) ID card.',
  'looks_like_screen_or_printout: the card is shown on a screen, or is a photocopy/printout, not the physical card (moiré, pixels, screen glare, flat paper).',
  'readable: the main text (name, institution) can be read.',
  'expiry_date: the validity/expiry ("Vigencia", "Válido hasta", "Vence") as printed; if only a year or month/year, give that.',
  'confidence: 0..1, how sure you are of the fields you returned.',
].join(' ');

/** Card without photo: the whole front (the device checked it has no face) and a cropped account screenshot. */
const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['card', 'screenshot', 'readable', 'confidence'],
  properties: {
    card: {
      type: 'object',
      additionalProperties: false,
      required: ['is_student_id_card', 'has_person_photo', 'looks_like_screen_or_printout', 'full_name', 'institution_name', 'expiry_date'],
      properties: {
        is_student_id_card: { type: 'boolean' },
        has_person_photo: { type: 'boolean' },
        looks_like_screen_or_printout: { type: 'boolean' },
        full_name: { type: ['string', 'null'] },
        institution_name: { type: ['string', 'null'] },
        expiry_date: { type: ['string', 'null'] },
      },
    },
    screenshot: {
      type: 'object',
      additionalProperties: false,
      required: ['looks_like_institutional_account', 'full_name', 'email', 'signs_of_editing'],
      properties: {
        looks_like_institutional_account: { type: 'boolean' },
        full_name: { type: ['string', 'null'] },
        email: { type: ['string', 'null'] },
        signs_of_editing: { type: 'boolean' },
      },
    },
    readable: { type: 'boolean' },
    confidence: { type: 'number' },
  },
};

const DOCUMENT_SYSTEM = [
  'You check documents for a Colombian university carpooling app.',
  'Image 1 is the FRONT of a student ID card without a photo of the person. Image 2 is a screenshot of the person\'s institutional account profile (Microsoft Teams, Outlook or a student portal), cropped to the name and e-mail.',
  'Return JSON only. Copy text exactly as shown; use null for anything you cannot read with certainty. Never guess.',
  'card.has_person_photo: the card shows a photo of a person. card.looks_like_screen_or_printout: the card is shown on a screen or is a copy, not the physical card.',
  'card.expiry_date: validity/expiry ("Vigencia", "Válido hasta", "Vence") as printed.',
  'screenshot.looks_like_institutional_account: it looks like a real Teams/Outlook/portal profile screen. screenshot.signs_of_editing: mismatched fonts, misaligned or pasted text, artifacts around the name or e-mail, or anything suggesting the screenshot was edited.',
  'readable: the card name and the screenshot name and e-mail can be read. confidence: 0..1 for the fields returned.',
].join(' ');

type Body = { mode?: unknown; crops?: unknown; card?: unknown; screenshot?: unknown };

const isImage = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_CROP_BASE64 && /^[A-Za-z0-9+/=]+$/.test(value);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const started = performance.now();

  const token = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response({ error: 'AUTH_REQUIRED' }, 401);
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return response({ error: 'AUTH_REQUIRED' }, 401);
  const userId = authData.user.id;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return response({ error: 'INVALID_BODY' }, 400);
  }
  const documentMode = body.mode === 'document';
  // No crops: the phone couldn't find or exclude the face, so nothing was sent → manual review.
  const crops = Array.isArray(body.crops) ? body.crops : [];
  if (documentMode
    ? !isImage(body.card) || !isImage(body.screenshot)
    : crops.length > MAX_CROPS || crops.some((crop) => !isImage(crop))) {
    return response({ error: 'INVALID_BODY' }, 400);
  }

  const { data: membership } = await admin.from('institution_memberships').select('institution_id, status').eq('user_id', userId).maybeSingle();
  if (!membership) return response({ error: 'NO_INSTITUTION_CHOSEN' }, 409);
  if (membership.status === 'verified') return response({ error: 'ALREADY_VERIFIED' }, 409);

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin.from('student_id_checks').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since);
  if ((count ?? 0) >= MAX_CHECKS_PER_DAY) return response({ error: 'TOO_MANY_ATTEMPTS' }, 429);

  const record = async (row: Record<string, unknown>, status: 'review' | 'verified' | null) => {
    const { error } = await admin.from('student_id_checks').insert({ user_id: userId, institution_id: membership.institution_id, latency_ms: Math.round(performance.now() - started), ...row });
    if (error) throw error;
    if (status) {
      const { error: statusError } = await admin.rpc('service_set_membership_status', { p_user: userId, p_status: status, p_method: status === 'verified' ? 'student_card_photo' : null });
      if (statusError) throw statusError;
    }
  };

  try {
    if (documentMode) {
      if (!MODEL_API_KEY.trim()) return response({ error: 'MODEL_UNAVAILABLE' }, 503);
      const result = await readDocument(userId, membership.institution_id, body.card as string, body.screenshot as string);
      // Never verified automatically: a person approves documents (private.approve_membership).
      await record({
        kind: 'document',
        decision: result.decision.decision,
        reasons: result.decision.reasons,
        institution_read: result.decision.institutionRead,
        expires_on: result.decision.expiresOn,
        email_domain: result.decision.emailDomain,
        review_summary: result.decision.summary,
        looks_real: !result.lookedLikeScreen,
        model: MODEL,
        request_id: result.requestId,
      }, result.decision.decision === 'review' ? 'review' : null);
      log('decided', { kind: 'document', decision: result.decision.decision, reasons: result.decision.reasons, ms: Math.round(performance.now() - started) });
      return response({ decision: result.decision.decision, reasons: result.decision.reasons });
    }
    if (!crops.length) {
      await record({ decision: 'review', reasons: ['face_not_found'] }, 'review');
      log('decided', { decision: 'review', reasons: ['face_not_found'] });
      return response({ decision: 'review', reasons: ['face_not_found'] });
    }
    if (!MODEL_API_KEY.trim()) return response({ error: 'MODEL_UNAVAILABLE' }, 503);

    const [{ data: profile }, { data: institution }, { data: domains }, { data: faces }] = await Promise.all([
      admin.from('profiles').select('nombre').eq('id', userId).single(),
      admin.from('institutions').select('nombre, nombre_corto').eq('id', membership.institution_id).single(),
      admin.from('institution_domains').select('dominio').eq('institution_id', membership.institution_id),
      admin.from('face_verifications').select('status').eq('user_id', userId).eq('purpose', 'student_card')
        .gte('created_at', new Date(Date.now() - FACE_WINDOW_MS).toISOString()).order('created_at', { ascending: false }).limit(1),
    ]);
    if (!profile || !institution) return response({ error: 'NOT_FOUND' }, 404);
    const institutionRef: InstitutionRef = { nombre: institution.nombre, nombre_corto: institution.nombre_corto, dominios: (domains ?? []).map((row) => row.dominio) };
    // null = never compared (web); false = compared and different.
    const faceMatch = faces?.length ? faces[0].status === 'verificado' : null;

    const transport = createTransport({ apiKey: MODEL_API_KEY, baseUrl: Deno.env.get('MODEL_API_BASE_URL') || undefined, log });
    const data = await transport.json('read_card', '/chat/completions', {
      model: MODEL,
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: [
          { type: 'text', text: `The user chose: ${institution.nombre}. Read the card crops.` },
          ...crops.map((crop) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${crop}` } })),
        ] },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'student_card', schema: CARD_SCHEMA, strict: true } },
    }, MUSE_TIMEOUT_MS) as { id?: string; choices?: { message?: { content?: unknown } }[] };
    const content = data.choices?.[0]?.message?.content;
    const report = JSON.parse(typeof content === 'string' ? content : '{}') as CardReport;

    const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const decision = decideCard(report, { profileName: profile.nombre, institution: institutionRef, faceMatch, today });
    await record({
      decision: decision.decision,
      reasons: decision.reasons,
      name_similarity: decision.nameSimilarity,
      institution_read: decision.institutionRead,
      id_last4: decision.idLast4,
      expires_on: decision.expiresOn,
      looks_real: !report.looks_like_screen_or_printout,
      face_match: faceMatch,
      model: MODEL,
      request_id: data.id ?? null,
    }, decision.decision === 'retry' ? null : decision.decision);
    // Reason codes only, never the name or numbers read.
    log('decided', { decision: decision.decision, reasons: decision.reasons, crops: crops.length, ms: Math.round(performance.now() - started) });
    return response({ decision: decision.decision, reasons: decision.reasons });
  } catch (error) {
    log('error', { detail: String((error as Error)?.message ?? error).slice(0, 200) });
    return response({ error: 'CHECK_FAILED' }, 502);
  }
});

/** Muse Spark reads the card front and the cropped account screenshot; decideDocument compares. */
async function readDocument(userId: string, institutionId: string, card: string, screenshot: string) {
  const [{ data: profile }, { data: institution }, { data: domains }] = await Promise.all([
    admin.from('profiles').select('nombre').eq('id', userId).single(),
    admin.from('institutions').select('nombre, nombre_corto').eq('id', institutionId).single(),
    admin.from('institution_domains').select('dominio').eq('institution_id', institutionId),
  ]);
  if (!profile || !institution) throw new Error('NOT_FOUND');
  const institutionRef: InstitutionRef = { nombre: institution.nombre, nombre_corto: institution.nombre_corto, dominios: (domains ?? []).map((row) => row.dominio) };

  const transport = createTransport({ apiKey: MODEL_API_KEY, baseUrl: Deno.env.get('MODEL_API_BASE_URL') || undefined, log });
  const data = await transport.json('read_document', '/chat/completions', {
    model: MODEL,
    reasoning_effort: 'low',
    messages: [
      { role: 'system', content: DOCUMENT_SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: `The user chose: ${institution.nombre}. Image 1: card front. Image 2: account screenshot.` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${card}` } },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot}` } },
      ] },
    ],
    response_format: { type: 'json_schema', json_schema: { name: 'student_document', schema: DOCUMENT_SCHEMA, strict: true } },
  }, MUSE_TIMEOUT_MS) as { id?: string; choices?: { message?: { content?: unknown } }[] };
  const content = data.choices?.[0]?.message?.content;
  const report = JSON.parse(typeof content === 'string' ? content : '{}') as DocumentReport;
  const today = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    decision: decideDocument(report, { profileName: profile.nombre, institution: institutionRef, today }),
    lookedLikeScreen: report.card?.looks_like_screen_or_printout === true,
    requestId: data.id ?? null,
  };
}
