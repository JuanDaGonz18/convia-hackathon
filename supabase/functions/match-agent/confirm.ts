/**
 * The user's Confirm tap is the final approval, bound to the exact verified proposal: the hash the
 * app sends must equal the stored one, and a hash recomputed from the trip as it is NOW must match
 * too (otherwise the trip changed: review again). The proposal is claimed atomically before the
 * insert, so a double tap books at most once. The insert runs with the user's session, so the
 * database's own checks (fresh face check, 90-minute rule, seats, institution) still apply.
 * Data access is injected; unit-tested.
 */
import { type ProposalFields, proposalHash } from './proposal.ts';
import type { AvailableTripRow } from './search.ts';

/** A proposal is valid this long after it was verified. */
export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

export type StoredRun = {
  user_id: string;
  status: string;
  proposal_hash: string | null;
  pending_action: { fields: ProposalFields } | null;
  pending_action_used_at: string | null;
  finished_at: string | null;
};

export type ConfirmDeps = {
  readTrip(tripId: string): Promise<AvailableTripRow | null>;
  /** Marks the proposal used only if it isn't yet (atomic); false if someone got there first. */
  claim(): Promise<boolean>;
  /** Undoes the claim when the insert fails, so the user can try again. */
  release(): Promise<void>;
  insertRequest(fields: ProposalFields): Promise<string>;
};

export type ConfirmResult =
  | { ok: true; requestId: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_PROPOSED' | 'ALREADY_USED' | 'EXPIRED' | 'HASH_MISMATCH' | 'PROPOSAL_STALE' | 'REQUEST_FAILED'; detail?: string };

export async function confirmProposal(
  { run, callerId, hashFromClient, now }: { run: StoredRun | null; callerId: string; hashFromClient: string; now: Date },
  deps: ConfirmDeps,
): Promise<ConfirmResult> {
  if (!run || run.user_id !== callerId) return { ok: false, code: 'NOT_FOUND' };
  if (run.status !== 'proposed' || !run.pending_action || !run.proposal_hash) return { ok: false, code: 'NOT_PROPOSED' };
  if (run.pending_action_used_at) return { ok: false, code: 'ALREADY_USED' };
  if (!run.finished_at || now.getTime() - new Date(run.finished_at).getTime() > PROPOSAL_TTL_MS) return { ok: false, code: 'EXPIRED' };
  // The app showed exactly what was verified.
  if (hashFromClient !== run.proposal_hash) return { ok: false, code: 'HASH_MISMATCH' };

  // The trip as it is now must still produce the same hash (price, departure) and have the seats.
  const stored = run.pending_action.fields;
  // A database error here is a failed request (the app says try again), not an unhandled 500.
  let trip: Awaited<ReturnType<typeof deps.readTrip>>;
  try {
    trip = await deps.readTrip(stored.trip_id);
  } catch {
    return { ok: false, code: 'REQUEST_FAILED', detail: 'trip_read_failed' };
  }
  if (!trip || !trip.salida_at || trip.estado !== 'por_empezar') return { ok: false, code: 'PROPOSAL_STALE', detail: 'trip_unavailable' };
  if (Number(trip.cupos_disponibles ?? 0) < stored.seats) return { ok: false, code: 'PROPOSAL_STALE', detail: 'no_seats' };
  const current = await proposalHash({ ...stored, price: Number(trip.precio ?? 0), departure: trip.salida_at });
  if (current !== run.proposal_hash) return { ok: false, code: 'PROPOSAL_STALE', detail: 'trip_changed' };

  if (!(await deps.claim())) return { ok: false, code: 'ALREADY_USED' };
  try {
    return { ok: true, requestId: await deps.insertRequest(stored) };
  } catch (error) {
    await deps.release();
    return { ok: false, code: 'REQUEST_FAILED', detail: String((error as Error)?.message ?? error).slice(0, 200) };
  }
}
