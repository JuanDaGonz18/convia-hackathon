-- =====================================================================
-- ConVía (hackathon project only) — the judges' demo stays usable every day
--
-- Judging runs after the building period (Nov 5–8), when nobody resets the
-- demo by hand. Every day at 04:00 Colombia this job, for the demo accounts
-- (e-mail @demo.convia.test) and nobody else:
--   1. clears their pickup checks, so the daily sample-check caps start over;
--   2. removes the demo driver's trips that departed more than 6 hours ago
--      (and their requests);
--   3. makes sure each demo passenger has an accepted trip with the demo
--      driver 1 to 3 days ahead: a trip already in that range is kept (a
--      judge may be using it), otherwise one is created in the passenger's
--      slot (07:00 Colombia + 2 h per passenger, two days ahead).
-- It never touches other users, and does nothing if the demo accounts or the
-- demo car are missing. `node hackathon/demo/judges-demo.mjs reset --yes`
-- remains the manual fallback (full reset of everything the judges changed).
-- =====================================================================

create or replace function private.keep_judges_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain constant text := '@demo.convia.test';
  v_driver uuid;
  v_vehicle uuid;
  v_passenger record;
  v_slot timestamptz;
  v_trip uuid;
  v_request uuid;
  v_checks int := 0;
  v_stale int := 0;
  v_kept int := 0;
  v_created int := 0;
  v_skipped text[] := '{}';
  v_day date := ((now() at time zone 'America/Bogota')::date + 2);
begin
  select id into v_driver from public.profiles where lower(email) = 'conductor' || v_domain;
  if v_driver is null then return jsonb_build_object('skipped', 'no demo driver'); end if;
  select id into v_vehicle from public.vehicles where driver_id = v_driver and placa = 'CNV026' and activo;
  if v_vehicle is null then return jsonb_build_object('skipped', 'demo car missing or inactive'); end if;

  -- 1. Sample-check caps count the last 24 h of pickup checks of demo accounts.
  delete from public.pickup_verifications pv
  using public.profiles p
  where p.email ilike '%' || v_domain and (pv.passenger_id = p.id or pv.driver_id = p.id);
  get diagnostics v_checks = row_count;

  -- 2. Old demo trips (any status) and their requests.
  delete from public.trip_requests
  where trip_id in (select id from public.trips where driver_id = v_driver and salida_at < now() - interval '6 hours');
  delete from public.trips where driver_id = v_driver and salida_at < now() - interval '6 hours';
  get diagnostics v_stale = row_count;

  -- 3. One accepted trip 1–3 days ahead per passenger, in a fixed slot per passenger.
  for v_passenger in
    select p.id, row_number() over (order by p.email) - 1 as slot_index
    from public.profiles p
    where p.email ilike 'pasajero%' || v_domain
  loop
    if exists (
      select 1 from public.trip_requests r join public.trips t on t.id = r.trip_id
      where r.passenger_id = v_passenger.id and r.estado = 'aceptado' and t.driver_id = v_driver
        and t.estado = 'por_empezar' and t.salida_at between now() + interval '1 day' and now() + interval '3 days'
    ) then
      v_kept := v_kept + 1;
      continue;
    end if;

    v_slot := ((v_day + time '07:00') + (v_passenger.slot_index * interval '2 hours')) at time zone 'America/Bogota';
    begin
      -- The driver's trip in this slot, if a judge or an earlier run left one; otherwise a new one.
      select id into v_trip from public.trips where driver_id = v_driver and salida_at = v_slot and estado = 'por_empezar';
      if v_trip is null then
        insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, precio, cupos_totales, descripcion, salida_at)
        values (v_driver, v_vehicle, 'Universidad de La Sabana, Chía', 4.8616, -74.0329, 'Centro Comercial Fontanar, Chía', 4.8833, -74.0378, 4000, 3,
                format('Viaje de demostración %s para el jurado del hackathon.', v_passenger.slot_index + 1), v_slot)
        returning id into v_trip;
      end if;
      -- As when a passenger requests a seat in the app: a fresh face check, then the driver accepts.
      insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
      values (v_passenger.id, 'verificado', 'on_device_sface', 'trip_request', 'selfie');
      delete from public.trip_requests where trip_id = v_trip and passenger_id = v_passenger.id;
      insert into public.trip_requests (trip_id, passenger_id, direccion, estado)
      values (v_trip, v_passenger.id, 'Portería principal, Universidad de La Sabana', 'pendiente')
      returning id into v_request;
      update public.trip_requests set estado = 'aceptado' where id = v_request;
      v_created := v_created + 1;
    exception when others then
      -- One passenger's problem (e.g. a judge booked something at that hour) never blocks the others.
      v_skipped := v_skipped || format('slot %s: %s', v_passenger.slot_index + 1, sqlerrm);
    end;
    v_trip := null;
  end loop;

  return jsonb_build_object('pickup_checks_cleared', v_checks, 'old_trips_removed', v_stale, 'kept', v_kept, 'created', v_created, 'skipped', to_jsonb(v_skipped));
end;
$$;

revoke all on function private.keep_judges_demo() from public, anon, authenticated;

select cron.unschedule('keep-judges-demo') where exists (select 1 from cron.job where jobname = 'keep-judges-demo');
-- 09:00 UTC = 04:00 Colombia.
select cron.schedule('keep-judges-demo', '0 9 * * *', 'select private.keep_judges_demo()');
