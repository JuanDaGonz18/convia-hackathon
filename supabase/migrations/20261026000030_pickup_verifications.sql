-- =====================================================================
-- ConVía — Verificación del carro al recoger (Edge Function verify-pickup)
--
-- El pasajero graba un clip corto del carro que llega; la función lo
-- analiza con SAM 3.1 + Muse Spark y responde si es el carro del viaje.
-- El clip y sus fotogramas se borran al terminar: aquí solo queda el
-- resultado. Solo la función (service_role) escribe; el pasajero y el
-- conductor del viaje pueden leer los intentos de ese viaje.
-- =====================================================================

create table public.pickup_verifications (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips(id) on delete cascade,
  request_id        uuid not null references public.trip_requests(id) on delete cascade,
  passenger_id      uuid not null references public.profiles(id) on delete cascade,
  driver_id         uuid not null references public.profiles(id) on delete cascade,
  status            text not null check (status in ('verified', 'mismatch', 'retry')),
  -- Código estable que la app traduce (p. ej. 'plate_match', 'no_plate').
  reason            text not null,
  plate_read        text,
  brand_read        text,
  color_read        text,
  confidence        real check (confidence between 0 and 1),
  brand_match       boolean,
  color_match       boolean,
  -- Fotogramas que cobró SAM 3.1 (costo) y duración de cada paso en ms.
  frames_processed  integer,
  latency_ms        integer not null,
  timings           jsonb not null default '{}'::jsonb,
  mock              boolean not null default false,
  -- El pasajero reportó un carro que no coincide.
  reported_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index pickup_verifications_request_idx on public.pickup_verifications(request_id, created_at desc);
create index pickup_verifications_trip_idx on public.pickup_verifications(trip_id, created_at desc);

alter table public.pickup_verifications enable row level security;

grant select on public.pickup_verifications to authenticated;
grant all on public.pickup_verifications to service_role;
create policy "pickup_verifications_read_trip" on public.pickup_verifications
  for select to authenticated
  using (passenger_id = (select auth.uid()) or driver_id = (select auth.uid()));

-- Reportar un carro que no coincide: solo el pasajero, solo un resultado 'mismatch', una vez.
create or replace function public.report_pickup_mismatch(p_verification_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.pickup_verifications
     set reported_at = now()
   where id = p_verification_id
     and passenger_id = (select auth.uid())
     and status = 'mismatch'
     and reported_at is null;
  if not found then raise exception 'pickup_report_not_allowed'; end if;
end;
$$;
revoke execute on function public.report_pickup_mismatch(uuid) from public, anon;
grant execute on function public.report_pickup_mismatch(uuid) to authenticated;

-- Clips privados: cada pasajero solo toca su carpeta (borrar exige también leer); nadie más los ve.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('pickup-clips', 'pickup-clips', false, 15728640, array['video/mp4', 'video/quicktime', 'image/jpeg'])
on conflict (id) do nothing;

create policy "pickup_clips_read_own" on storage.objects for select to authenticated
  using (bucket_id = 'pickup-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pickup_clips_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'pickup-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "pickup_clips_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'pickup-clips' and (storage.foldername(name))[1] = (select auth.uid())::text);
