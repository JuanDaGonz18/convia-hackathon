// Reads the local stack's keys from `supabase status` and runs the verify-pickup e2e test.
import { execSync } from 'node:child_process';

const status = JSON.parse(execSync('npx supabase status -o json', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
execSync('node supabase/tests/verify_pickup_e2e.mjs', {
  stdio: 'inherit',
  env: { ...process.env, LOCAL_ANON: status.ANON_KEY, LOCAL_SERVICE: status.SERVICE_ROLE_KEY },
});
