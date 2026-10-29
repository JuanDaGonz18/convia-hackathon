// Runs the evaluation set against the deployed match-agent (eval mode: fixture data in memory, real
// models and judge, no accounts). Scores every case and writes results/<date>-<provider>.{json,md}.
//
//   node evals/matching-agent/run.mjs baseten        (or modal; add --only p01,p02 for a subset)
//
// The service key is read from the Supabase CLI at run time and never printed or stored.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { dayDate, place } from '../../supabase/functions/match-agent/evalData.ts';
import { detectLanguage } from '../../supabase/functions/match-agent/language.ts';

// The hackathon project: from SUPABASE_PROJECT_REF, or the project this checkout is linked to (`supabase link`).
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || readFileSync(new URL('../../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
const CONCURRENCY = 4;
const [provider = 'baseten', ...rest] = process.argv.slice(2);
const only = rest.includes('--only') ? rest[rest.indexOf('--only') + 1].split(',') : null;

const here = new URL('./', import.meta.url);
const { cases } = JSON.parse(readFileSync(new URL('cases.json', here), 'utf8'));
const fixture = JSON.parse(readFileSync(new URL('fixture.json', here), 'utf8'));
const FULL_PLATES = fixture.drivers.map((driver) => driver.vehicle.plate);
const OTHER_ORG_TRIPS = fixture.trips.filter((trip) => fixture.drivers.find((d) => d.key === trip.driver)?.org !== 'eval').map((trip) => trip.key);

const keys = JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${PROJECT_REF} --reveal -o json`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
// The function compares the exact service key it was given (SUPABASE_SERVICE_ROLE_KEY): the project's secret key.
const serviceKey = (keys.find((k) => k.type === 'secret') ?? keys.find((k) => k.name === 'service_role')).api_key;

async function runCase(entry) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`https://${PROJECT_REF}.supabase.co/functions/v1/match-agent`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ eval: { passenger: entry.as, text: entry.text, language: entry.app_lang ?? entry.lang, provider } }),
        signal: AbortSignal.timeout(90_000),
      });
      // Right after a deploy the new version may not boot yet (503 BOOT_ERROR): wait and try again.
      if (response.status === 503 && attempt < 2) { await new Promise((resolve) => setTimeout(resolve, 15_000)); continue; }
      const body = await response.json();
      // A platform error (timeout, worker limit) has no status: keep what came back.
      return body.status ? body : { status: 'harness_error', error: `HTTP ${response.status}: ${JSON.stringify(body).slice(0, 200)}` };
    } catch (error) {
      if (attempt === 2) return { status: 'harness_error', error: String(error) };
    }
  }
}

/** Where the time went: model turns, the judge, and tools (judge rows are tool rows marked 'judge'). */
function stepTimes(trace = []) {
  const sum = (kind) => trace.filter((row) => row.kind === kind).reduce((total, row) => total + (row.latency_ms ?? 0), 0);
  return { modelMs: sum('model'), judgeMs: sum('judge'), modelTurns: trace.filter((row) => row.kind === 'model').length };
}

/** The accepted spec equals what the case expects (places, date, time, seats). */
function specMatches(entry, spec) {
  const ideal = entry.ideal_search;
  if (!ideal || !spec) return null;
  return spec.destination?.label === place(ideal.to).label
    && (spec.origin?.label ?? null) === place(ideal.from).label
    && spec.date === dayDate(ideal.day)
    && spec.time === ideal.time
    && spec.seats === (ideal.seats ?? 1);
}

function score(entry, result) {
  const type = entry.expect.type;
  const text = JSON.stringify({ reply: result.reply, options: result.options, trace: result.trace });
  const violations = [
    ...FULL_PLATES.filter((plate) => text.includes(plate)).map((plate) => `plate ${plate}`),
    ...(/(?:\+?57[\s-]?)?\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/.test(text) ? ['phone'] : []),
    ...OTHER_ORG_TRIPS.filter((key) => (result.options ?? []).some((o) => o.trip_id === key) || result.proposal?.trip_id === key).map((key) => `other org ${key}`),
    ...(result.turns > 8 ? ['more than 8 turns'] : []),
    // The reply follows the message's language, whatever the app's is.
    ...(entry.role !== 'driver' && result.reply && detectLanguage(result.reply, entry.lang) !== entry.lang ? [`reply not in ${entry.lang}`] : []),
  ];
  const proposedTrip = result.status === 'proposed' ? result.proposal?.trip_id : null;
  let pass;
  if (entry.role === 'driver') pass = null; // outside v1 (read-only driver tools not built)
  else if (type === 'pick' || type === 'proposal') pass = proposedTrip === entry.expect.trip;
  else if (type === 'none') pass = result.status === 'no_match' && !proposedTrip;
  else if (type === 'clarify') pass = result.status === 'clarify';
  else if (type === 'refuse') pass = ['answered', 'clarify'].includes(result.status) && !proposedTrip;
  else pass = null;
  // Some cases accept another outcome type (e.g. a question instead of 'none').
  if (pass === false && (entry.expect.also_ok ?? []).some((alt) => (alt === 'clarify' && result.status === 'clarify') || (alt === 'pick' && proposedTrip === entry.expect.trip))) pass = true;
  const expectsTrip = type === 'pick' || type === 'proposal';
  // A verified proposal that is wrong: another trip, or any trip when none / a question was expected.
  const falseVerified = !!proposedTrip && entry.role !== 'driver' && (!expectsTrip || proposedTrip !== entry.expect.trip);
  return { pass: pass === null ? null : pass && violations.length === 0, specOk: specMatches(entry, result.spec), proposed: !!proposedTrip, proposedRight: expectsTrip && proposedTrip === entry.expect.trip, falseVerified, violations };
}

const selected = cases.filter((entry) => !only || only.includes(entry.id));
const results = [];
for (let i = 0; i < selected.length; i += CONCURRENCY) {
  const batch = selected.slice(i, i + CONCURRENCY);
  const done = await Promise.all(batch.map(async (entry) => {
    const result = await runCase(entry);
    const scored = score(entry, result);
    console.log(`${entry.id.padEnd(4)} ${String(scored.pass ?? 'n/a').padEnd(5)} ${String(result.status).padEnd(11)} ${String(result.proposal?.trip_id ?? '').padEnd(4)} ${result.latency_ms ?? '-'} ms  $${result.totals?.cost_usd ?? '-'}  ${scored.violations.join(', ')}`);
    return { id: entry.id, role: entry.role, type: entry.expect.type, expected: entry.expect.trip ?? null, status: result.status, proposed: result.proposal?.trip_id ?? null, reply: result.reply, spec: result.spec, turns: result.turns, specRejections: result.spec_rejections, proposeAttempts: result.propose_attempts, latencyMs: result.latency_ms, ...stepTimes(result.trace), costUsd: result.totals?.cost_usd ?? null, ...scored, error: result.error ?? null,
      // A failed case keeps its steps (tool, plan, error) to see where it went wrong.
      ...(scored.pass === false ? { steps: (result.trace ?? []).map((row) => ({ n: row.n, kind: row.kind, tool: row.tool_name, plan: row.plan, error: row.error, result: row.kind === 'tool' ? JSON.stringify(row.result).slice(0, 300) : undefined })) } : {}) };
  }));
  results.push(...done);
}

const scoredCases = results.filter((r) => r.pass !== null);
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');
const quantile = (values, q) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const latencies = results.map((r) => r.latencyMs).filter((v) => typeof v === 'number');
const costs = results.map((r) => r.costUsd).filter((v) => typeof v === 'number');
const byType = {};
for (const r of scoredCases) { byType[r.type] ??= { pass: 0, total: 0 }; byType[r.type].total++; if (r.pass) byType[r.type].pass++; }
const specCases = results.filter((r) => r.specOk !== null);
const proposals = results.filter((r) => r.proposed && r.role !== 'driver');
const summary = {
  provider,
  date: new Date().toISOString(),
  cases: results.length,
  passRate: pct(scoredCases.filter((r) => r.pass).length, scoredCases.length),
  byType: Object.fromEntries(Object.entries(byType).map(([type, v]) => [type, `${v.pass}/${v.total}`])),
  specAccuracy: pct(specCases.filter((r) => r.specOk).length, specCases.length),
  proposalPrecision: pct(proposals.filter((r) => r.proposedRight).length, proposals.length),
  falseVerified: results.filter((r) => r.falseVerified).length,
  avgRetries: (results.reduce((sum, r) => sum + (r.specRejections ?? 0) + Math.max(0, (r.proposeAttempts ?? 0) - 1), 0) / (results.length || 1)).toFixed(2),
  p50LatencyMs: quantile(latencies, 0.5),
  p95LatencyMs: quantile(latencies, 0.95),
  avgCostUsd: costs.length ? (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4) : null,
  totalCostUsd: costs.reduce((a, b) => a + b, 0).toFixed(4),
  violations: results.reduce((sum, r) => sum + r.violations.length, 0),
  driverCasesOutsideV1: results.filter((r) => r.role === 'driver').length,
};

const dir = new URL('results/', here);
mkdirSync(dir, { recursive: true });
const stamp = summary.date.slice(0, 16).replace(/[:T]/g, '-');
writeFileSync(new URL(`${stamp}-${provider}.json`, dir), JSON.stringify({ summary, results }, null, 2));
const md = [
  `# Evaluation — ${provider}, ${summary.date.slice(0, 16).replace('T', ' ')} UTC`,
  '',
  '| Metric | Value |', '| --- | --- |',
  ...Object.entries(summary).filter(([k]) => !['provider', 'date', 'byType'].includes(k)).map(([k, v]) => `| ${k} | ${v} |`),
  `| byType | ${Object.entries(summary.byType).map(([k, v]) => `${k} ${v}`).join(', ')} |`,
  '',
  '| Case | Expected | Status | Proposed | Pass | Spec | Turns | ms | $ |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((r) => `| ${r.id} | ${r.type}${r.expected ? ` ${r.expected}` : ''} | ${r.status} | ${r.proposed ?? ''} | ${r.pass ?? 'n/a'} | ${r.specOk ?? ''} | ${r.turns ?? ''} | ${r.latencyMs ?? ''} | ${r.costUsd ?? ''} |`),
].join('\n');
writeFileSync(new URL(`${stamp}-${provider}.md`, dir), md + '\n');
console.log(JSON.stringify(summary, null, 2));
