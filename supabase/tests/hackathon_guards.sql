-- Regression checks for the hackathon project's database guards. Everything runs in one transaction
-- that is ROLLED BACK: nothing is kept. Any failed check raises and the run fails.
--   npx supabase db query --linked -f supabase/tests/hackathon_guards.sql
-- Needs the judges' demo accounts (hackathon/demo/judges-demo.mjs setup).
begin;

select set_config('test.driver', (select id::text from public.profiles where email = 'conductor@demo.convia.test'), true);
select set_config('test.passenger', (select id::text from public.profiles where email = 'pasajero5@demo.convia.test'), true);

-- 1. Migration 036: a verified driver can publish a trip and a verified passenger can request a seat
--    (the institution trigger used to fail on both with 'record "new" has no field ...').
do $$
declare v_trip uuid;
begin
  insert into public.trips (driver_id, vehicle_id, origen_nombre, origen_lat, origen_lng, destino_nombre, destino_lat, destino_lng, precio, cupos_totales, salida_at)
  select current_setting('test.driver')::uuid, v.id, 'Test A', 4.86, -74.03, 'Test B', 4.88, -74.03, 4000, 3, now() + interval '6 days 3 hours'
  from public.vehicles v where v.driver_id = current_setting('test.driver')::uuid and v.placa = 'CNV026'
  returning id into v_trip;
  if v_trip is null then raise exception 'FAIL: trip insert returned nothing'; end if;
  insert into public.face_verifications (user_id, status, provider, purpose, template_kind)
  values (current_setting('test.passenger')::uuid, 'verificado', 'on_device_sface', 'trip_request', 'selfie');
  insert into public.trip_requests (trip_id, passenger_id, direccion, estado)
  values (v_trip, current_setting('test.passenger')::uuid, 'Test', 'pendiente');
end $$;

-- 2. Migration 037: signed in as the demo driver, the demo car can't be deactivated, deleted or changed.
select set_config('request.jwt.claims', json_build_object('sub', current_setting('test.driver'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    update public.vehicles set activo = false where placa = 'CNV026';
    raise exception 'FAIL: the demo car was deactivated (or RLS hid it from its driver)';
  exception when others then
    if sqlerrm <> 'DEMO_CAR_LOCKED' then raise; end if;
  end;
  begin
    delete from public.vehicles where placa = 'CNV026';
    raise exception 'FAIL: the demo car was deleted';
  exception when others then
    if sqlerrm <> 'DEMO_CAR_LOCKED' then raise; end if;
  end;
  begin
    update public.vehicles set color = 'Negro' where placa = 'CNV026';
    raise exception 'FAIL: the demo car color was changed';
  exception when others then
    if sqlerrm <> 'DEMO_CAR_LOCKED' then raise; end if;
  end;
end $$;
reset role;

-- 3. Without a signed-in user (reset script, daily job) the car can still be restored.
do $$
begin
  update public.vehicles set activo = true where placa = 'CNV026';
end $$;

-- 4. The daily job only serves the five known passengers and is idempotent.
do $$
declare v_first jsonb := private.keep_judges_demo(); v_second jsonb := private.keep_judges_demo();
begin
  if (v_first->>'kept')::int + (v_first->>'created')::int <> 5 or jsonb_array_length(v_first->'skipped') <> 0 then
    raise exception 'FAIL: first run %', v_first;
  end if;
  if (v_second->>'kept')::int <> 5 or (v_second->>'created')::int <> 0 then
    raise exception 'FAIL: second run is not idempotent: %', v_second;
  end if;
end $$;

-- 5. Migration 038: wildcards in the institution search are plain text.
do $$
begin
  if (select count(*) from public.search_institutions('%%%')) <> 0 then raise exception 'FAIL: "%%%%%%" matched institutions'; end if;
  if (select count(*) from public.search_institutions('___')) <> 0 then raise exception 'FAIL: "___" matched institutions'; end if;
  if (select count(*) from public.search_institutions('sabana')) = 0 then raise exception 'FAIL: "sabana" found nothing'; end if;
end $$;

select 'all hackathon guards hold' as result;
rollback;
