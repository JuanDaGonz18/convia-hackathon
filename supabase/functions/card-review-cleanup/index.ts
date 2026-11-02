import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * card-review-cleanup: deletes the student-card images kept for manual review once they are
 * 7 days old (face-verifications/<user_id>/student-card-review-*). Called daily by pg_cron
 * (private.dispatch_card_review_cleanup). It takes no input and only deletes files that have
 * already expired, so it needs no caller authentication (verify_jwt = false in config.toml).
 */

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const BUCKET = 'face-verifications';
const headers = { 'Content-Type': 'application/json' };
const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ fn: 'card-review-cleanup', event, ...data }));

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }), { status: 405, headers });
  try {
    const { data, error } = await admin.rpc('service_expired_card_review_files');
    if (error) throw error;
    const names = (data ?? []) as string[];
    let removed = 0;
    for (let i = 0; i < names.length; i += 100) {
      const { data: gone, error: removeError } = await admin.storage.from(BUCKET).remove(names.slice(i, i + 100));
      if (removeError) throw removeError;
      removed += gone?.length ?? 0;
    }
    log('cleaned', { expired: names.length, removed });
    return new Response(JSON.stringify({ removed }), { headers });
  } catch (error) {
    log('error', { detail: String((error as Error)?.message ?? error).slice(0, 200) });
    return new Response(JSON.stringify({ error: 'CLEANUP_FAILED' }), { status: 500, headers });
  }
});
