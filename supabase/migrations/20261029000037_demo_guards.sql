-- =====================================================================
-- ConVía (hackathon project only) — demo accounts locked on the server
--
-- From the independent review:
--  * The app hides destructive actions for demo accounts, but the database
--    let them through: a judge could delete or deactivate the demo car
--    (CNV026), which the sample clips and the daily demo job depend on. A
--    demo account can no longer delete it, deactivate it, or change its
--    plate, brand or color. Service-role and scheduled work (reset script,
--    keep-judges-demo) is not affected: it has no signed-in user.
--  * keep-judges-demo only serves the five known demo passengers, and only
--    if their e-mail is confirmed: a new "pasajeroN@demo.convia.test"
--    sign-up never gets demo trips.
-- (delete-account refuses demo accounts in the Edge Function.)
-- =====================================================================

create or replace function private.protect_demo_car()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor_is_demo boolean := coalesce((select email ilike '%@demo.convia.test' from public.profiles where id = auth.uid()), false);
begin
  if not v_actor_is_demo or old.placa <> 'CNV026' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'DEMO_CAR_LOCKED' using errcode = 'P0001', detail = 'The demo car is shared by the judges and cannot be removed.';
  end if;
  if not new.activo or new.placa is distinct from old.placa or new.marca is distinct from old.marca
     or new.color is distinct from old.color or new.driver_id is distinct from old.driver_id then
    raise exception 'DEMO_CAR_LOCKED' using errcode = 'P0001', detail = 'The demo car is shared by the judges: its plate, brand, color and status stay as they are.';
  end if;
  return new;
end $$;

drop trigger if exists protect_demo_car on public.vehicles;
create trigger protect_demo_car before update or delete on public.vehicles
  for each row execute function private.protect_demo_car();

-- The daily job: only the five known passengers, confirmed.
create or replace function private.keep_judges_demo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain constant text := '@demo.convia.test';
  v_passengers constant text[] := array['pasajero', 'pasajero2', 'pasajero3', 'pasajero4', 'pasajero5'];
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
  select p.id into v_driver
  from public.profiles p join auth.users u on u.id = p.id
  where lower(p.email) = 'conductor' || v_domain and u.email_confirmed_at is not null;
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

  -- 3. One accepted trip 1–3 days ahead per known passenger, in a fixed slot per passenger.
  for v_passenger in
    select p.id, array_position(v_passengers, split_part(lower(p.email), '@', 1)) - 1 as slot_index
    from public.profiles p join auth.users u on u.id = p.id
    where lower(p.email) in (select name || v_domain from unnest(v_passengers) as name) and u.email_confirmed_at is not null
    order by 2
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
      select id into v_trip from public.trips where driver_id = v_driver and salida_at = v_slot and estado = 'por_empezar';
      if v_trip is null then
        insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, precio, cupos_totales, descripcion, salida_at)
        values (v_driver, v_vehicle, 'Universidad de La Sabana, Chía', 4.8616, -74.0329, 'Centro Comercial Fontanar, Chía', 4.8833, -74.0378, 4000, 3,
                format('Viaje de demostración %s para el jurado del hackathon.', v_passenger.slot_index + 1), v_slot)
        returning id into v_trip;
      end if;
      insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
      values (v_passenger.id, 'verificado', 'on_device_sface', 'trip_request', 'selfie');
      delete from public.trip_requests where trip_id = v_trip and passenger_id = v_passenger.id;
      insert into public.trip_requests (trip_id, passenger_id, direccion, estado)
      values (v_trip, v_passenger.id, 'Portería principal, Universidad de La Sabana', 'pendiente')
      returning id into v_request;
      update public.trip_requests set estado = 'aceptado' where id = v_request;
      v_created := v_created + 1;
    exception when others then
      v_skipped := v_skipped || format('slot %s: %s', v_passenger.slot_index + 1, sqlerrm);
    end;
    v_trip := null;
  end loop;

  return jsonb_build_object('pickup_checks_cleared', v_checks, 'old_trips_removed', v_stale, 'kept', v_kept, 'created', v_created, 'skipped', to_jsonb(v_skipped));
end;
$$;

revoke all on function private.keep_judges_demo() from public, anon, authenticated;
