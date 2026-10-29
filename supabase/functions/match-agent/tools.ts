/**
 * The agent's read-only tools: their JSON schemas (what the model sees), argument validation
 * (invalid arguments go back to the model as a typed error, never executed) and execution
 * against a data source that reads with the caller's session.
 *
 * Actions that change anything (request a seat, answer a request, save a route alert) are not
 * here: they are proposed by the agent and executed only after the user confirms.
 */
import type { ToolSpec } from '../_shared/llm.ts';
import { type Geocoder, resolvePlace, type SavedPlaceRow } from './places.ts';
import { type AvailableTripRow, searchTrips, type SearchArgs, tripDetails } from './search.ts';

/** What the tools read, always with the caller's session (RLS decides what is visible). */
export type ToolData = {
  availableTrips(): Promise<AvailableTripRow[]>;
  availableTrip(tripId: string): Promise<AvailableTripRow | null>;
  savedPlaces(): Promise<SavedPlaceRow[]>;
};

export type ToolContext = { data: ToolData; geocode?: Geocoder; now: Date; viewerId: string };

export type ToolOutcome = { ok: true; result: unknown } | { ok: false; error: { code: 'INVALID_ARGS' | 'UNKNOWN_TOOL' | 'TOOL_FAILED'; message: string } };

const point = {
  type: 'object',
  properties: { lat: { type: 'number' }, lng: { type: 'number' }, label: { type: 'string' } },
  required: ['lat', 'lng'],
  additionalProperties: false,
};

export const READ_TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'resolve_place',
      description: 'Find coordinates for EVERY place the user named, in one call (saved places first, then known places of the Sabana area, then a geocoder). Returns candidates per place; if ambiguous is true, ask the user which one.',
      parameters: {
        type: 'object',
        properties: { queries: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: 'Each place as the user wrote it, e.g. ["Cota", "la U"].' } },
        required: ['queries'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_trips',
      description: 'Trips the user can join for a journey, ranked by code: compatibility level, then closeness to the requested time. Times are Colombia time. Returns options (inside the time window), alternatives (only when no option fits) and why other trips were left out. Plates are masked.',
      parameters: {
        type: 'object',
        properties: {
          origin: { ...point, description: 'Where the user starts, from resolve_place. Omit if unknown.' },
          destination: { ...point, description: 'Where the user goes, from resolve_place.' },
          date: { type: 'string', description: 'YYYY-MM-DD, Colombia date.' },
          time: { type: 'string', description: 'HH:MM, 24 h, Colombia time.' },
          flex_minutes: { type: 'integer', minimum: 15, maximum: 180, description: 'How far from the requested time a departure may be. Default 60.' },
          seats: { type: 'integer', minimum: 1, maximum: 4, description: 'Seats needed. Default 1.' },
          max_price_cop: { type: 'integer', minimum: 0, description: 'Only if the user set a budget.' },
        },
        required: ['destination', 'date', 'time'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'trip_details',
      description: 'Details of one trip the user can see, by trip_id from search_trips.',
      parameters: { type: 'object', properties: { trip_id: { type: 'string' } }, required: ['trip_id'], additionalProperties: false },
    },
  },
];

type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readPoint(value: unknown, name: string): Validated<{ lat: number; lng: number; label?: string }> {
  if (!isObject(value)) return { ok: false, message: `${name} must be an object with lat and lng` };
  const { lat, lng, label } = value;
  if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { ok: false, message: `${name}.lat and ${name}.lng must be valid coordinates` };
  if (label !== undefined && typeof label !== 'string') return { ok: false, message: `${name}.label must be text` };
  return { ok: true, value: { lat, lng, ...(label ? { label } : {}) } };
}

function integerIn(value: unknown, min: number, max: number, fallback: number | null, name: string): Validated<number | null> {
  if (value === undefined || value === null) return { ok: true, value: fallback };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) return { ok: false, message: `${name} must be an integer from ${min} to ${max}` };
  return { ok: true, value };
}

export function validateSearchArgs(raw: unknown): Validated<SearchArgs> {
  if (!isObject(raw)) return { ok: false, message: 'arguments must be an object' };
  const extra = Object.keys(raw).filter((key) => !['origin', 'destination', 'date', 'time', 'flex_minutes', 'seats', 'max_price_cop'].includes(key));
  if (extra.length) return { ok: false, message: `unknown arguments: ${extra.join(', ')}` };
  const destination = readPoint(raw.destination, 'destination');
  if (!destination.ok) return destination;
  const origin = raw.origin === undefined || raw.origin === null ? { ok: true as const, value: null } : readPoint(raw.origin, 'origin');
  if (!origin.ok) return origin;
  if (typeof raw.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.date) || Number.isNaN(Date.parse(`${raw.date}T00:00:00Z`))) return { ok: false, message: 'date must be YYYY-MM-DD' };
  if (typeof raw.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) return { ok: false, message: 'time must be HH:MM (24 h)' };
  const flex = integerIn(raw.flex_minutes, 15, 180, 60, 'flex_minutes');
  if (!flex.ok) return flex;
  const seats = integerIn(raw.seats, 1, 4, 1, 'seats');
  if (!seats.ok) return seats;
  const maxPrice = integerIn(raw.max_price_cop, 0, 1_000_000, null, 'max_price_cop');
  if (!maxPrice.ok) return maxPrice;
  return {
    ok: true,
    value: { origin: origin.value, destination: destination.value, date: raw.date, time: raw.time, flexMinutes: flex.value!, seats: seats.value!, maxPrice: maxPrice.value },
  };
}

/** Runs one read-only tool call. Arguments arrive as the model's JSON text. */
export async function runReadTool(name: string, argumentsJson: string, context: ToolContext): Promise<ToolOutcome> {
  let raw: unknown;
  try {
    raw = argumentsJson.trim() ? JSON.parse(argumentsJson) : {};
  } catch {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'arguments are not valid JSON' } };
  }
  try {
    switch (name) {
      case 'resolve_place': {
        const queries = isObject(raw) && Array.isArray(raw.queries) ? raw.queries : [];
        if (!queries.length || queries.length > 3 || queries.some((query) => typeof query !== 'string' || !query.trim() || query.length > 120)) {
          return { ok: false, error: { code: 'INVALID_ARGS', message: 'queries must list 1 to 3 places (non-empty text, up to 120 characters each)' } };
        }
        const saved = await context.data.savedPlaces();
        return { ok: true, result: { results: await Promise.all((queries as string[]).map((query) => resolvePlace(query, saved, context.geocode))) } };
      }
      case 'search_trips': {
        const args = validateSearchArgs(raw);
        if (!args.ok) return { ok: false, error: { code: 'INVALID_ARGS', message: args.message } };
        return { ok: true, result: searchTrips(await context.data.availableTrips(), args.value, { now: context.now, viewerId: context.viewerId }) };
      }
      case 'trip_details': {
        if (!isObject(raw) || typeof raw.trip_id !== 'string' || !UUID.test(raw.trip_id)) {
          return { ok: false, error: { code: 'INVALID_ARGS', message: 'trip_id must be a trip id from search_trips' } };
        }
        return { ok: true, result: tripDetails(await context.data.availableTrip(raw.trip_id)) };
      }
      default:
        return { ok: false, error: { code: 'UNKNOWN_TOOL', message: `no tool named ${name}` } };
    }
  } catch (error) {
    return { ok: false, error: { code: 'TOOL_FAILED', message: String((error as Error)?.message ?? error).slice(0, 200) } };
  }
}
