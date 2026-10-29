/**
 * match-agent read-only tools: argument validation, place resolution and typed errors.
 * Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { matchKnownPlaces, normalize, resolvePlace } from './places.ts';
import { bogotaInstant, bogotaLabel } from './search.ts';
import { READ_TOOLS, runReadTool, type ToolContext, validateSearchArgs } from './tools.ts';

const context = (overrides: Partial<ToolContext['data']> = {}): ToolContext => ({
  data: { availableTrips: async () => [], availableTrip: async () => null, savedPlaces: async () => [], ...overrides },
  now: new Date('2026-11-02T11:00:00Z'),
  viewerId: 'viewer',
});

describe('places', () => {
  test('accents, case and surrounding words do not matter', () => {
    assert.equal(normalize('  Cajicá!! '), 'cajica');
    assert.deepEqual(matchKnownPlaces('desde COTA').map((p) => p.label), ['Cota (parque principal)']);
    assert.deepEqual(matchKnownPlaces('la U').map((p) => p.label), ['Universidad de La Sabana, Chía']);
  });

  test('"Bogotá" is ambiguous on purpose: the agent must ask', async () => {
    const resolved = await resolvePlace('Bogotá', []);
    assert.equal(resolved.ambiguous, true);
    assert.equal(resolved.candidates.length, 3);
  });

  test('saved places win, by name or by kind ("mi casa", "home")', async () => {
    const saved = [{ kind: 'home' as const, label: 'Casa', address: '', lat: 4.81, lng: -74.1 }];
    assert.equal((await resolvePlace('mi casa', saved)).candidates[0].source, 'saved');
    assert.equal((await resolvePlace('home', saved)).candidates[0].source, 'saved');
  });

  test('the geocoder is only asked when nothing else matches, and its failure is not fatal', async () => {
    let asked = 0;
    const geocode = async () => { asked++; throw new Error('down'); };
    assert.equal((await resolvePlace('Cota', [], geocode)).candidates.length, 1);
    assert.equal(asked, 0);
    assert.deepEqual((await resolvePlace('Calle 170 con 7', [], geocode)).candidates, []);
    assert.equal(asked, 1);
  });
});

describe('Colombia time', () => {
  test('07:00 in Bogotá is 12:00 UTC, and back', () => {
    const instant = bogotaInstant('2026-11-03', '07:00');
    assert.equal(instant.toISOString(), '2026-11-03T12:00:00.000Z');
    assert.equal(bogotaLabel(instant), '2026-11-03 07:00');
  });
});

describe('search_trips arguments', () => {
  const valid = { destination: { lat: 4.86, lng: -74.03 }, date: '2026-11-03', time: '07:00' };

  test('defaults: no origin, 60 minutes, 1 seat, no price limit', () => {
    const args = validateSearchArgs(valid);
    assert.ok(args.ok);
    assert.deepEqual(args.value, { origin: null, destination: { lat: 4.86, lng: -74.03 }, date: '2026-11-03', time: '07:00', flexMinutes: 60, seats: 1, maxPrice: null });
  });

  test('bad or unknown arguments are rejected with a message the model can act on', () => {
    for (const [change, message] of [
      [{ time: '7am' }, /time must be HH:MM/],
      [{ date: 'tomorrow' }, /date must be YYYY-MM-DD/],
      [{ destination: { lat: 'x', lng: 1 } }, /valid coordinates/],
      [{ seats: 9 }, /seats must be an integer from 1 to 4/],
      [{ book: true }, /unknown arguments: book/],
    ] as const) {
      const args = validateSearchArgs({ ...valid, ...change });
      assert.ok(!args.ok);
      assert.match(args.message, message);
    }
  });
});

describe('runReadTool', () => {
  test('every tool in READ_TOOLS can be run; none of them writes', () => {
    assert.deepEqual(READ_TOOLS.map((tool) => tool.function.name), ['resolve_place', 'search_trips', 'trip_details']);
  });

  test('invalid JSON and invalid arguments come back as INVALID_ARGS, without reading data', async () => {
    let reads = 0;
    const ctx = context({ availableTrips: async () => { reads++; return []; } });
    assert.deepEqual((await runReadTool('search_trips', '{nope', ctx)), { ok: false, error: { code: 'INVALID_ARGS', message: 'arguments are not valid JSON' } });
    assert.equal((await runReadTool('search_trips', '{"time":"07:00"}', ctx)).ok, false);
    assert.equal((await runReadTool('trip_details', '{"trip_id":"T1; drop table"}', ctx)).ok, false);
    assert.equal(reads, 0);
  });

  test('an action name is not a read tool', async () => {
    const outcome = await runReadTool('request_seat', '{}', context());
    assert.deepEqual(outcome, { ok: false, error: { code: 'UNKNOWN_TOOL', message: 'no tool named request_seat' } });
  });

  test('a data error becomes TOOL_FAILED instead of crashing the run', async () => {
    const outcome = await runReadTool('resolve_place', '{"queries":["Cota"]}', context({ savedPlaces: async () => { throw new Error('saved_places: timeout'); } }));
    assert.deepEqual(outcome, { ok: false, error: { code: 'TOOL_FAILED', message: 'saved_places: timeout' } });
  });

  test('trip_details of a trip the user cannot see says not found', async () => {
    const outcome = await runReadTool('trip_details', '{"trip_id":"590f63aa-e41d-4cd3-99d5-03cfac3a5fc0"}', context());
    assert.deepEqual(outcome, { ok: true, result: { found: false } });
  });
});
