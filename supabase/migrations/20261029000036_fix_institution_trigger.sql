-- =====================================================================
-- ConVía — fix: publishing a trip or requesting a seat failed
--
-- private.require_verified_institution() (migration 032) read the user with
--   case when tg_table_name = 'trips' then new.driver_id else new.passenger_id end
-- PL/pgSQL resolves every field in that expression, so on trips it failed
-- with 'record "new" has no field "passenger_id"' (and on trip_requests with
-- "driver_id"): no trip or request could be created since migration 032.
-- Separate IF branches only resolve the field of the table being written.
-- =====================================================================

create or replace function private.require_verified_institution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if tg_table_name = 'trips' then
    v_user := new.driver_id;
  else
    v_user := new.passenger_id;
  end if;
  if (select institution_id from public.profiles where id = v_user) is null then
    raise exception 'INSTITUTION_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  return new;
end $$;
