// Translates src/i18n/locales/es.json into en.json with Muse Spark 1.3, in batches.
// Keeps every key and every {{placeholder}}; a translation that loses or adds one is rejected
// and its batch retried once. By default only keys missing from en.json are translated, so
// hand-reviewed English text is never overwritten (use --all to redo everything).
//
// Usage: node scripts/translate-locale.mjs [--all] [--dry-run] [--source es.json --target en.json]
//   --source/--target: another pair of JSON files with the same layout (e.g. the legal texts).
// Needs MODEL_API_KEY in supabase/functions/.env.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { flatten, placeholders } from '../src/i18n/languages.ts';

const argv = process.argv.slice(2);
const option = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const SOURCE = option('--source', 'src/i18n/locales/es.json');
const TARGET = option('--target', 'src/i18n/locales/en.json');
const BATCH = 40;
const args = new Set(argv);

const env = Object.fromEntries(readFileSync('supabase/functions/.env', 'utf8').split(/\r?\n/)
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
if (!env.MODEL_API_KEY) throw new Error('MODEL_API_KEY missing in supabase/functions/.env');
const BASE = (env.MODEL_API_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');

const INSTRUCTIONS = [
  'You translate the user interface of ConVía from Spanish (Colombia) to English (US).',
  'ConVía is a carpooling app for university students and staff in Chía and the Sabana area of Colombia: drivers offer seats, passengers request them, everyone is identity-verified.',
  'Write natural, short, friendly app English, the way a well-made mobile app talks; keep labels and buttons as short as the Spanish.',
  'Use "you". Use "seat" for "cupo", "ride" or "trip" for "viaje", "request" for "solicitud", "plate" for "placa".',
  'Never translate brand names (ConVía, ConVía+, Microsoft, Supabase) or e-mail domains such as @unisabana.edu.co.',
  'Keep every {{placeholder}} exactly as written, in a natural position. Keep "•", "…" and emoji.',
  'Say "log in" (never "sign in"), "institution" for "institución", "university email" for "correo institucional". Use straight apostrophes, never curly ones.',
  'Language names in a language picker stay in their own language: Español, English.',
  'Return every key you were given, unchanged, with its translation.',
].join(' ');

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['key', 'text'], properties: { key: { type: 'string' }, text: { type: 'string' } } },
    },
  },
};

async function translateBatch(entries) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'muse-spark-1.3',
      reasoning_effort: 'low',
      messages: [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content: JSON.stringify(Object.fromEntries(entries)) },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'Translations', schema: SCHEMA, strict: true } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const content = body.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content);
  return { translations: new Map(parsed.translations.map((item) => [item.key, item.text])), usage: body.usage };
}

/** Accepted translations of a batch, and the keys that came back wrong (missing, empty or with other placeholders). */
function check(entries, translations) {
  const accepted = new Map();
  const rejected = [];
  for (const [key, spanish] of entries) {
    const english = translations.get(key);
    if (typeof english === 'string' && english.trim() && placeholders(english).join() === placeholders(spanish).join()) accepted.set(key, english);
    else rejected.push(key);
  }
  return { accepted, rejected };
}

function unflatten(flat, order) {
  const tree = {};
  for (const key of order) {
    if (!(key in flat)) continue;
    const parts = key.split('.');
    let node = tree;
    for (const part of parts.slice(0, -1)) node = node[part] ??= {};
    node[parts.at(-1)] = flat[key];
  }
  return tree;
}

const source = flatten(JSON.parse(readFileSync(SOURCE, 'utf8')));
const existing = existsSync(TARGET) ? flatten(JSON.parse(readFileSync(TARGET, 'utf8'))) : {};
const todo = Object.entries(source).filter(([key]) => args.has('--all') || !(key in existing));
console.log(`${Object.keys(source).length} keys in es.json, ${todo.length} to translate.`);
if (args.has('--dry-run') || !todo.length) process.exit(0);

const result = { ...existing };
const failed = [];
let tokensIn = 0;
let tokensOut = 0;
for (let index = 0; index < todo.length; index += BATCH) {
  let entries = todo.slice(index, index + BATCH);
  for (let attempt = 1; attempt <= 2 && entries.length; attempt++) {
    const started = performance.now();
    const { translations, usage } = await translateBatch(entries);
    tokensIn += usage?.prompt_tokens ?? 0;
    tokensOut += usage?.completion_tokens ?? 0;
    const { accepted, rejected } = check(entries, translations);
    for (const [key, text] of accepted) result[key] = text;
    console.log(`batch ${index / BATCH + 1} attempt ${attempt}: ${accepted.size} ok, ${rejected.length} rejected (${Math.round(performance.now() - started)} ms)`);
    entries = entries.filter(([key]) => rejected.includes(key));
  }
  failed.push(...entries.map(([key]) => key));
}

// Same key order as es.json; keys no longer in es.json are dropped.
writeFileSync(TARGET, `${JSON.stringify(unflatten(result, Object.keys(source)), null, 2)}\n`);
const cost = tokensIn * 1.25 / 1e6 + tokensOut * 4.25 / 1e6;
console.log(`Wrote ${TARGET}. Tokens in ${tokensIn}, out ${tokensOut} (~$${cost.toFixed(4)}).`);
if (failed.length) {
  console.log(`Not translated (kept out of en.json; the app falls back to Spanish): ${failed.join(', ')}`);
  process.exitCode = 1;
}
const same = Object.keys(source).filter((key) => result[key] === source[key]);
if (same.length) console.log(`Identical to Spanish, check them: ${same.join(', ')}`);
