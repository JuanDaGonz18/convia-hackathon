/**
 * Confirm bound to the exact proposal. Run with `npm run test:functions`.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { type ConfirmDeps, confirmProposal, type StoredRun } from './confirm.ts';
import { proposalHash } from './proposal.ts';
import type { AvailableTripRow } from './search.ts';

const NOW = new Date('2026-10-29T11:00:00Z');
const TRIP = '11111111-1111-4111-8111-111111111111';
const fields = { trip_id: TRIP, seats: 1, price: 5000, departure: '2026-10-30T11:40:00.000Z', pickup: { label: 'Cota', lat: 4.8095, lng: -74.1018 }, dropoff: { label: 'La Sabana', lat: 4.8616, lng: -74.0329 } };
const tripRow = (changes: Partial<AvailableTripRow> = {}) => ({ id: TRIP, salida_at: fields.departure, precio: 5000, cupos_disponibles: 3, estado: 'por_empezar', ...changes }) as AvailableTripRow;

async function setup(runChanges: Partial<StoredRun> = {}, trip: AvailableTripRow | null = tripRow()) {
  const hash = await proposalHash(fields);
  const run: StoredRun = { user_id: 'me', status: 'proposed', proposal_hash: hash, pending_action: { fields }, pending_action_used_at: null, finished_at: new Date(NOW.getTime() - 60_000).toISOString(), ...runChanges };
  let claimed = false;
  const inserted: unknown[] = [];
  const deps: ConfirmDeps & { inserted: unknown[] } = {
    inserted,
    readTrip: async () => trip,
    claim: async () => { if (claimed) return false; claimed = true; return true; },
    release: async () => { claimed = false; },
    insertRequest: async (f) => { inserted.push(f); return 'request-1'; },
  };
  return { run, hash, deps };
}

describe('confirm', () => {
  test('the exact proposal, unchanged, inserts one request', async () => {
    const { run, hash, deps } = await setup();
    assert.deepEqual(await confirmProposal({ run, callerId: 'me', hashFromClient: hash, now: NOW }, deps), { ok: true, requestId: 'request-1' });
    assert.equal(deps.inserted.length, 1);
  });

  test('double tap: the second one is refused', async () => {
    const { run, hash, deps } = await setup();
    const [a, b] = await Promise.all([1, 2].map(() => confirmProposal({ run, callerId: 'me', hashFromClient: hash, now: NOW }, deps)));
    assert.equal([a, b].filter((result) => result.ok).length, 1);
    assert.equal(deps.inserted.length, 1);
  });

  test('refused when the trip changed, filled up or disappeared, or anything else is off', async () => {
    const cases: [string, Awaited<ReturnType<typeof setup>>, string, string?][] = [
      ['price changed', await setup({}, tripRow({ precio: 6000 })), 'PROPOSAL_STALE'],
      ['rescheduled', await setup({}, tripRow({ salida_at: '2026-10-30T12:30:00.000Z' })), 'PROPOSAL_STALE'],
      ['full', await setup({}, tripRow({ cupos_disponibles: 0 })), 'PROPOSAL_STALE'],
      ['cancelled', await setup({}, null), 'PROPOSAL_STALE'],
      ['another user', await setup({ user_id: 'someone-else' }), 'NOT_FOUND'],
      ['not a proposal', await setup({ status: 'clarify' }), 'NOT_PROPOSED'],
      ['already used', await setup({ pending_action_used_at: NOW.toISOString() }), 'ALREADY_USED'],
      ['expired', await setup({ finished_at: new Date(NOW.getTime() - 11 * 60_000).toISOString() }), 'EXPIRED'],
    ];
    for (const [name, { run, hash, deps }, code] of cases) {
      const result = await confirmProposal({ run, callerId: 'me', hashFromClient: hash, now: NOW }, deps);
      assert.equal(result.ok ? 'ok' : result.code, code, name);
      assert.equal(deps.inserted.length, 0, name);
    }
  });

  test('a hash the app did not get from this proposal is refused', async () => {
    const { run, deps } = await setup();
    const result = await confirmProposal({ run, callerId: 'me', hashFromClient: 'f'.repeat(64), now: NOW }, deps);
    assert.deepEqual(result, { ok: false, code: 'HASH_MISMATCH' });
  });

  test('a failed insert releases the claim so the user can retry', async () => {
    const { run, hash, deps } = await setup();
    deps.insertRequest = async () => { throw new Error('Verifica tu rostro antes de pedir un cupo'); };
    const first = await confirmProposal({ run, callerId: 'me', hashFromClient: hash, now: NOW }, deps);
    assert.equal(first.ok ? 'ok' : first.code, 'REQUEST_FAILED');
    deps.insertRequest = async () => 'request-2';
    assert.deepEqual(await confirmProposal({ run, callerId: 'me', hashFromClient: hash, now: NOW }, deps), { ok: true, requestId: 'request-2' });
  });
});
