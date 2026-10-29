// Checks the claim judge (checkpoint 2) on its own: explanations with a known answer, at each
// judge setting, with accuracy and latency. A faster setting is only worth it if it still
// rejects every unsupported claim.
//
// Usage: node evals/matching-agent/judge-check.mjs [--repeat 2]
// Needs MODEL_API_KEY in supabase/functions/.env.
import { readFileSync } from 'node:fs';

import { createJudge } from '../../supabase/functions/match-agent/judge.ts';

const args = process.argv.slice(2);
const repeat = Number(args.includes('--repeat') ? args[args.indexOf('--repeat') + 1] : 2);
const env = Object.fromEntries(readFileSync('supabase/functions/.env', 'utf8').split(/\r?\n/)
  .filter((line) => line.includes('=') && !line.startsWith('#'))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));

const facts = {
  trip: {
    departure_colombia: '2026-10-30 06:40', from: 'Cota (parque principal)', to: 'Universidad de La Sabana, Chía', price_cop: 5000, seats_left: 3,
    driver_first_name: 'Andrea', driver_rating: 4.9, vehicle: { brand: 'Mazda 3', color: 'Gris', plate_masked: 'E••••1' },
    pickup_km_from_user: 0.4, dropoff_km_from_destination: 0.3, minutes_from_requested_time: -20, match_level: 'excellent',
    reasons: ['same_destination', 'leaves_near_you', 'leaves_soon'],
  },
  request: { origin: { ref: 'place:1', label: 'Cota (parque principal)' }, destination: { ref: 'place:2', label: 'Universidad de La Sabana, Chía' }, date: '2026-10-30', time: '07:00', flex_minutes: 60, seats: 1, max_price_cop: null },
};

// [explanation, every claim supported?]
const CASES = [
  ['Sale a las 6:40 desde Cota, 20 minutos antes de tu hora, y cuesta $5.000; quedan 3 cupos.', true],
  ['This trip leaves Cota at 6:40, 20 minutes before your time, for 5,000 COP with 3 seats left.', true],
  ['Andrea te recoge a 0,4 km de tu punto en un Mazda 3 gris.', true],
  ['Excellent match: same destination, and it leaves near you.', true],
  ['Llega a la Universidad de La Sabana; la conductora tiene calificación 4,9.', true],
  ["It's a gray Mazda 3 driven by Andrea, pickup 0.4 km away. Request a seat if it works for you.", true],
  ['Sale a las 6:40 y el conductor tiene 5 estrellas.', false],
  ['This trip leaves at 6:40 and the car has air conditioning.', false],
  ['Sale de Chía a las 6:40 y cuesta $5.000.', false],
  ['It leaves 20 minutes after your requested time, from Cota.', false],
  ['Andrea estudia ingeniería y siempre sale puntual.', false],
  ['Quedan 2 cupos y cuesta $5.000.', false],
];

const SETTINGS = [
  { name: 'low (current)', effort: 'low' },
  { name: 'minimal', effort: 'minimal' },
  { name: 'minimal, max 600 tokens', effort: 'minimal', maxTokens: 600 },
];

for (const setting of SETTINGS) {
  const judge = createJudge({ apiKey: env.MODEL_API_KEY, baseUrl: env.MODEL_API_BASE_URL || undefined, effort: setting.effort, maxTokens: setting.maxTokens });
  const latencies = [];
  let right = 0;
  let falseSupported = 0;
  let errors = 0;
  for (let round = 0; round < repeat; round++) {
    const rows = await Promise.all(CASES.map(async ([explanation, expected]) => {
      const started = performance.now();
      try {
        const verdict = await judge({ explanation, facts });
        return { ms: performance.now() - started, ok: verdict.allSupported === expected, falseSupported: !expected && verdict.allSupported };
      } catch {
        return { ms: performance.now() - started, error: true };
      }
    }));
    for (const row of rows) {
      latencies.push(row.ms);
      if (row.error) errors++;
      else { if (row.ok) right++; if (row.falseSupported) falseSupported++; }
    }
  }
  const sorted = latencies.sort((a, b) => a - b);
  const at = (q) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
  console.log(`${setting.name.padEnd(26)} right ${right}/${CASES.length * repeat}  unsupported passed ${falseSupported}  errors ${errors}  p50 ${at(0.5)} ms  p95 ${at(0.95)} ms`);
}
