/**
 * The tools' data source over Supabase, with a client built from the CALLER's JWT: RLS and the
 * available_trips view decide what the agent can see (same organization, masked plates, fuzzed
 * coordinates, no phones). The service role is never used here.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import type { SavedPlaceRow } from './places.ts';
import { AVAILABLE_TRIP_COLUMNS, type AvailableTripRow } from './search.ts';
import type { ToolData } from './tools.ts';
import type { VerifyData } from './verify.ts';

export function supabaseToolData(userClient: SupabaseClient): ToolData & VerifyData {
  return {
    async availableTrips() {
      const { data, error } = await userClient.from('available_trips').select(AVAILABLE_TRIP_COLUMNS).order('salida_at').limit(300);
      if (error) throw new Error(`available_trips: ${error.message}`);
      return (data ?? []) as AvailableTripRow[];
    },
    async availableTrip(tripId) {
      const { data, error } = await userClient.from('available_trips').select(AVAILABLE_TRIP_COLUMNS).eq('id', tripId).maybeSingle();
      if (error) throw new Error(`available_trips: ${error.message}`);
      return (data ?? null) as AvailableTripRow | null;
    },
    async myActiveRequests() {
      const { data, error } = await userClient.rpc('my_trip_requests');
      if (error) throw new Error(`my_trip_requests: ${error.message}`);
      return ((data ?? []) as { trip_id: string; estado: string; salida_at: string }[])
        .filter((row) => ['pendiente', 'aceptado', 'abordado'].includes(row.estado))
        .map((row) => ({ trip_id: row.trip_id, salida_at: row.salida_at }));
    },
    async institutionVerified() {
      const { data, error } = await userClient.rpc('my_institution');
      if (error) throw new Error(`my_institution: ${error.message}`);
      return (data as { status?: string } | null)?.status === 'verified';
    },
    async savedPlaces() {
      const { data, error } = await userClient.from('saved_places').select('kind, label, address, lat, lng').limit(20);
      if (error) throw new Error(`saved_places: ${error.message}`);
      return (data ?? []) as SavedPlaceRow[];
    },
  };
}
