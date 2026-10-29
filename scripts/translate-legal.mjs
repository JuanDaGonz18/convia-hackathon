// English version of the Terms and the Privacy Policy (src/content/legal.ts), with the same checked
// Muse Spark pipeline as the app's texts (scripts/translate-locale.mjs): every string keeps its
// position and placeholders. The Spanish text in legal.ts stays the binding one; the app says so
// above the English version.
//
// Usage: node scripts/translate-legal.mjs        (re-translates everything: run it after editing legal.ts)
// Needs MODEL_API_KEY in supabase/functions/.env.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LEGAL_UPDATED_AT, PRIVACY, TERMS } from '../src/content/legal.ts';

const dir = mkdtempSync(join(tmpdir(), 'legal-'));
const source = join(dir, 'legal.es.json');
try {
  writeFileSync(source, JSON.stringify({ updatedAt: LEGAL_UPDATED_AT, terms: TERMS, privacy: PRIVACY }, null, 2));
  execFileSync(process.execPath, ['scripts/translate-locale.mjs', '--all', '--source', source, '--target', 'src/content/legal.en.json'], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
