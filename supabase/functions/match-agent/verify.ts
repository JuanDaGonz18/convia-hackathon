/**
 * Checkpoint 2 — runs INSIDE propose_request_seat, so a proposal can't skip it. Deterministic
 * checks first (cheap, exact), then a judge on a DIFFERENT model (Muse Spark 1.3) for every
 * claim in the explanation. Each failure is concrete feedback the agent can act on.
 * Data access and the judge are injected; pure logic, unit-tested.
 */
import { allowedFrom, ungrounded } from './grounding.ts';
import type { ProposalVerdict, RunState } from './loop.ts';
import { proposalHash } from './proposal.ts';
import { type AvailableTripRow, bogotaInstant, bogotaLabel, type TripOption } from './search.ts';
import { describeSpec } from './loop.ts';

/** Same threshold as the app ("good" or better). */
export const MIN_MATCH_SCORE = 62;
/** The database refuses two trips of one passenger within 90 minutes. */
const CLASH_MS = 90 * 60 * 1000;

export type VerifyData = {
  /** The trip as the user can see it now (available_trips, the user's session). */
  availableTrip(tripId: string): Promise<AvailableTripRow | null>;
  /** The user's pending, accepted or boarded requests, with each trip's departure. */
  myActiveRequests(): Promise<{ trip_id: string; salida_at: string }[]>;
  /** The user's institution is verified (profiles.institution_id set). */
  institutionVerified(): Promise<boolean>;
};

export type JudgeVerdict = { allSupported: boolean; claims: { text: string; supported: boolean; field: string | null }[] };
export type Judge = (input: { explanation: string; facts: Record<string, unknown> }) => Promise<JudgeVerdict>;

/** What the judge may treat as true: the trip as it is now, and the accepted request. */
export function factsFor(option: TripOption, fresh: AvailableTripRow, state: RunState) {
  return {
    trip: {
      departure_colombia: bogotaLabel(new Date(fresh.salida_at!)),
      from: fresh.origen_nombre,
      to: fresh.destino_nombre,
      price_cop: Number(fresh.precio ?? 0),
      seats_left: Number(fresh.cupos_disponibles ?? 0),
      driver_first_name: option.driver_first_name,
      driver_rating: option.driver_rating,
      vehicle: option.vehicle,
      pickup_km_from_user: option.pickup_km,
      dropoff_km_from_destination: option.dropoff_km,
      minutes_from_requested_time: option.minutes_from_requested,
      match_level: option.level,
      reasons: option.reasons,
    },
    request: state.spec ? describeSpec(state.spec) : null,
  };
}

export async function verifyProposal(
  { tripId, explanation, state }: { tripId: string; explanation: string; state: RunState },
  { data, judge, now }: { data: VerifyData; judge: Judge; now: Date },
): Promise<ProposalVerdict> {
  const checks: string[] = [];
  const fail = (failure: string) => ({ verified: false as const, failures: [failure], checks });
  // The trip itself can't be proposed: rewording won't help, so the loop drops it instead of retrying.
  const block = (failure: string) => ({ ...fail(failure), tripBlocked: true });
  const spec = state.spec;
  if (!spec) return fail('no accepted request spec');

  const option = state.searched[tripId];
  if (!option) return fail(`trip_id ${tripId} was not returned by search_trips in this run; propose one of its options`);
  checks.push('trip returned by search_trips in this run');

  const fresh = await data.availableTrip(tripId);
  if (!fresh || !fresh.salida_at) return block('the trip is no longer available (cancelled, departed or hidden)');
  if (fresh.estado !== 'por_empezar') return block(`the trip is no longer open (status ${fresh.estado})`);
  const seatsLeft = Number(fresh.cupos_disponibles ?? 0);
  if (seatsLeft < spec.seats) return block(`the trip has ${seatsLeft} seat(s) left and the user needs ${spec.seats}`);
  checks.push(`still available now, ${seatsLeft} seat(s) left`);

  if (!(await data.institutionVerified())) return fail("the user's institution is not verified, so no trip can be requested");
  checks.push('same verified institution');

  const departure = new Date(fresh.salida_at).getTime();
  const requested = bogotaInstant(spec.date, spec.time).getTime();
  if (departure <= now.getTime()) return block('the trip has already departed');
  if (Math.abs(departure - requested) > spec.flexMinutes * 60000) return block(`the trip departs ${bogotaLabel(new Date(departure))}, outside the accepted window (${spec.time} ± ${spec.flexMinutes} min)`);
  checks.push('departure inside the accepted window');

  const active = await data.myActiveRequests();
  if (active.some((request) => request.trip_id === tripId)) return block('the user already requested this trip');
  const clash = active.find((request) => Math.abs(new Date(request.salida_at).getTime() - departure) < CLASH_MS);
  if (clash) return block(`the user has another trip at ${bogotaLabel(new Date(clash.salida_at)).slice(11)}, less than 90 minutes apart`);
  checks.push('not already requested, no clash within 90 minutes');

  if (option.score < MIN_MATCH_SCORE) return block(`the match score is ${option.score}, below ${MIN_MATCH_SCORE}; this trip doesn't fit the route well enough`);
  checks.push(`match score ${option.score} ≥ ${MIN_MATCH_SCORE}`);

  const price = Number(fresh.precio ?? 0);
  if (price !== option.price_cop || bogotaLabel(new Date(departure)) !== option.departure) {
    return block(`the trip changed since the search (now ${bogotaLabel(new Date(departure)).slice(11)}, $${price})`);
  }

  // Every number must belong to THIS trip or the accepted request, not to another option.
  const facts = factsFor(option, fresh, state);
  const missing = ungrounded(explanation, allowedFrom([facts]));
  if (missing.length) return fail(`these numbers are not this trip's data: ${missing.join(', ')}. Use only the trip's own values (departure ${facts.trip.departure_colombia.slice(11)}, price ${price}, ${seatsLeft} seats)`);
  checks.push('every number in the explanation matches the trip');

  let verdict: JudgeVerdict;
  try {
    verdict = await judge({ explanation, facts });
  } catch {
    return fail('the claim check is unavailable right now; try proposing again');
  }
  const unsupported = verdict.claims.filter((claim) => !claim.supported).map((claim) => `"${claim.text}"`);
  if (!verdict.allSupported || unsupported.length) return fail(`claims not supported by the trip data: ${unsupported.join(', ') || 'see the trip facts'}; remove them`);
  checks.push(`judge: ${verdict.claims.length} claim(s) supported`);

  const fields = {
    trip_id: tripId,
    seats: spec.seats,
    price,
    departure: fresh.salida_at,
    pickup: spec.origin ? { label: spec.origin.label, lat: spec.origin.lat, lng: spec.origin.lng } : null,
    dropoff: { label: spec.destination.label, lat: spec.destination.lat, lng: spec.destination.lng },
  };
  return {
    verified: true,
    checks,
    proposal: { trip: option, seats: spec.seats, explanation, hash: await proposalHash(fields), departureIso: fresh.salida_at, price, fields },
  };
}

/** Grounding for read-only answers (answer_no_match): any number in any tool output of this run. */
export function ungroundedInRun(text: string, state: RunState) {
  return ungrounded(text, allowedFrom([state.outputs, state.spec ? describeSpec(state.spec) : null]));
}
