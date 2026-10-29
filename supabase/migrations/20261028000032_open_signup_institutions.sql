-- =====================================================================
-- ConVía — Registro abierto e instituciones verificadas
--
-- Cualquier correo puede registrarse. Quien usa un correo de un dominio
-- institucional queda verificado de inmediato (como antes); los demás
-- eligen su institución y la verifican con su carné estudiantil (Edge
-- Function verify-student-id, Muse Spark 1.3) o piden que se agregue.
--
-- Regla central: profiles.institution_id solo se llena cuando la
-- membresía está VERIFICADA. Todas las políticas que limitan los datos a
-- "la misma institución" pasan por private.current_institution_id(), que
-- lee esa columna; así un usuario pendiente no ve viajes, personas ni
-- chats sin tocar esas políticas. La institución elegida y aún no
-- verificada vive en institution_memberships.
-- =====================================================================

create extension if not exists unaccent with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Instituciones: nombre corto, ciudad, sitio web y varios dominios
-- ---------------------------------------------------------------------
alter table public.institutions
  add column if not exists nombre_corto text check (nombre_corto is null or char_length(nombre_corto) between 1 and 40),
  add column if not exists ciudad       text check (ciudad is null or char_length(ciudad) between 1 and 80),
  add column if not exists sitio_web    text check (sitio_web is null or char_length(sitio_web) <= 200);

-- Todos los dominios de correo de cada institución (estudiantes y funcionarios pueden usar distintos).
create table public.institution_domains (
  dominio         text primary key check (dominio = lower(dominio) and dominio ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  created_at      timestamptz not null default now()
);
create index institution_domains_institution_idx on public.institution_domains(institution_id);
insert into public.institution_domains (dominio, institution_id)
  select dominio, id from public.institutions
on conflict (dominio) do nothing;

alter table public.institution_domains enable row level security;
grant all on public.institution_domains to service_role;

-- La lista completa ya no se puede leer: se busca con search_institutions (3+ letras).
drop policy if exists "institutions_read" on public.institutions;
revoke select on public.institutions from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Membresía: institución elegida, estado y método de verificación
-- ---------------------------------------------------------------------
create table public.institution_memberships (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  institution_id  uuid not null references public.institutions(id) on delete cascade,
  -- pending: eligió y no ha verificado · review: revisión manual · verified: verificada.
  status          text not null default 'pending' check (status in ('pending', 'review', 'verified')),
  method          text check (method is null or method in ('institutional_email', 'microsoft', 'student_id')),
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'verified') = (method is not null and verified_at is not null))
);
alter table public.institution_memberships enable row level security;
grant select on public.institution_memberships to authenticated;
grant all on public.institution_memberships to service_role;
create policy "institution_memberships_read_own" on public.institution_memberships
  for select to authenticated using (user_id = (select auth.uid()));

-- Los usuarios que ya tenían institución quedan verificados con el método que usaron.
insert into public.institution_memberships (user_id, institution_id, status, method, verified_at)
select p.id, p.institution_id, 'verified',
       case when exists (select 1 from auth.identities i where i.user_id = p.id and i.provider = 'azure')
            then 'microsoft' else 'institutional_email' end,
       now()
  from public.profiles p
 where p.institution_id is not null
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- 3. "Mi institución no aparece": solicitudes (se revisan en el dashboard)
-- ---------------------------------------------------------------------
create table public.institution_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  nombre      text not null check (char_length(trim(nombre)) between 3 and 120),
  ciudad      text not null check (char_length(trim(ciudad)) between 2 and 80),
  sitio_web   text check (sitio_web is null or char_length(sitio_web) <= 200),
  rol         text not null check (rol in ('estudiante', 'profesor', 'administrativo', 'otro')),
  estado      text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  created_at  timestamptz not null default now()
);
create unique index institution_requests_one_pending on public.institution_requests(user_id) where estado = 'pendiente';
alter table public.institution_requests enable row level security;
grant select on public.institution_requests to authenticated;
grant all on public.institution_requests to service_role;
create policy "institution_requests_read_own" on public.institution_requests
  for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- 4. Verificación con carné: solo el resultado (ni foto, ni nombre, ni número completo)
-- ---------------------------------------------------------------------
create table public.student_id_checks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  institution_id   uuid not null references public.institutions(id) on delete cascade,
  decision         text not null check (decision in ('verified', 'review', 'retry')),
  -- Códigos estables que la app traduce (p. ej. 'expired', 'name_mismatch', 'face_not_found').
  reasons          text[] not null default '{}',
  name_similarity  real check (name_similarity is null or name_similarity between 0 and 1),
  institution_read text check (institution_read is null or char_length(institution_read) <= 200),
  id_last4         text check (id_last4 is null or id_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  expires_on       date,
  looks_real       boolean,
  face_match       boolean,
  model            text,
  request_id       text,
  latency_ms       integer,
  created_at       timestamptz not null default now()
);
create index student_id_checks_user_idx on public.student_id_checks(user_id, created_at desc);
alter table public.student_id_checks enable row level security;
grant select on public.student_id_checks to authenticated;
grant all on public.student_id_checks to service_role;
create policy "student_id_checks_read_own" on public.student_id_checks
  for select to authenticated using (user_id = (select auth.uid()));

-- La cara del carné se compara en el teléfono → embedding → aquí, como la licencia.
alter table public.face_verifications drop constraint if exists face_verifications_template_kind_check;
alter table public.face_verifications
  add constraint face_verifications_template_kind_check
  check (template_kind is null or template_kind in ('selfie', 'license', 'student_card'));

-- ---------------------------------------------------------------------
-- 5. Funciones
-- ---------------------------------------------------------------------

-- El único camino que llena profiles.institution_id.
create or replace function private.verify_membership(p_user uuid, p_method text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_inst uuid;
begin
  select institution_id into v_inst from public.institution_memberships where user_id = p_user;
  if v_inst is null then raise exception 'NO_INSTITUTION_CHOSEN'; end if;
  update public.institution_memberships
     set status = 'verified', method = p_method, verified_at = now(), updated_at = now()
   where user_id = p_user;
  update public.profiles set institution_id = v_inst where id = p_user;
end $$;
revoke execute on function private.verify_membership(uuid, text) from public, anon, authenticated;

-- Para la Edge Function (service_role): verificar tras el carné o pasar a revisión.
create or replace function public.service_set_membership_status(p_user uuid, p_status text, p_method text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status = 'verified' then
    perform private.verify_membership(p_user, p_method);
  elsif p_status in ('pending', 'review') then
    update public.institution_memberships set status = p_status, updated_at = now()
     where user_id = p_user and status <> 'verified';
  else
    raise exception 'INVALID_STATUS';
  end if;
end $$;
revoke execute on function public.service_set_membership_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.service_set_membership_status(uuid, text, text) to service_role;

-- Registro: cualquier correo. Dominio institucional → verificado de inmediato.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inst uuid;
begin
  select i.id into v_inst
    from public.institution_domains d
    join public.institutions i on i.id = d.institution_id
   where i.activo and d.dominio = lower(split_part(new.email, '@', 2));
  insert into public.profiles (id, email, nombre, rol, institution_id, terms_accepted_at)
  values (
    new.id, new.email,
    left(coalesce(nullif(new.raw_user_meta_data->>'nombre', ''), new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 120),
    coalesce((new.raw_user_meta_data->>'rol')::public.user_role, 'usuario'),
    v_inst,
    case when (new.raw_user_meta_data->>'terms_accepted')::boolean then now() end
  );
  if v_inst is not null then
    insert into public.institution_memberships (user_id, institution_id, status, method, verified_at)
    values (new.id, v_inst, 'verified',
            case when new.raw_app_meta_data->>'provider' = 'azure' then 'microsoft' else 'institutional_email' end,
            now());
  end if;
  return new;
end $$;

-- La pista del registro ("tu correo es de La Sabana") usa todos los dominios.
create or replace function public.check_email_domain(p_email text)
returns table (institution_id uuid, nombre text, tipo public.community_type, dominio text)
language sql stable security definer set search_path = '' as $$
  select i.id, i.nombre, i.tipo, d.dominio
    from public.institution_domains d
    join public.institutions i on i.id = d.institution_id
   where i.activo and d.dominio = lower(split_part(p_email, '@', 2))
$$;

-- Búsqueda: solo con 3+ letras, sin tildes ni mayúsculas, por nombre, nombre corto y ciudad.
create or replace function public.search_institutions(p_query text)
returns table (id uuid, nombre text, nombre_corto text, ciudad text)
language sql stable security definer set search_path = '' as $$
  with q as (select lower(extensions.unaccent(trim(coalesce(p_query, '')))) as text)
  select i.id, i.nombre, i.nombre_corto, i.ciudad
    from public.institutions i, q
   where char_length(q.text) >= 3
     and i.activo
     -- Las organizaciones de prueba (demo, evaluación) no se ofrecen.
     and not exists (select 1 from public.institution_domains d where d.institution_id = i.id and d.dominio like '%.test')
     and lower(extensions.unaccent(i.nombre || ' ' || coalesce(i.nombre_corto, '') || ' ' || coalesce(i.ciudad, ''))) like '%' || q.text || '%'
   order by i.nombre
   limit 10
$$;
revoke execute on function public.search_institutions(text) from public, anon;
grant execute on function public.search_institutions(text) to authenticated;

-- Elegir institución: queda pendiente hasta verificarla. No se cambia una ya verificada.
create or replace function public.choose_institution(p_institution_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  if not exists (select 1 from public.institutions where id = p_institution_id and activo) then
    raise exception 'INSTITUTION_NOT_FOUND';
  end if;
  if exists (select 1 from public.institution_memberships where user_id = v_user and status = 'verified') then
    raise exception 'ALREADY_VERIFIED';
  end if;
  insert into public.institution_memberships (user_id, institution_id, status)
  values (v_user, p_institution_id, 'pending')
  on conflict (user_id) do update set institution_id = excluded.institution_id, status = 'pending', updated_at = now();
end $$;
revoke execute on function public.choose_institution(uuid) from public, anon;
grant execute on function public.choose_institution(uuid) to authenticated;

-- "Mi institución no aparece": una solicitud pendiente por usuario.
create or replace function public.request_institution(p_nombre text, p_ciudad text, p_sitio_web text, p_rol text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  insert into public.institution_requests (user_id, nombre, ciudad, sitio_web, rol)
  values (v_user, trim(p_nombre), trim(p_ciudad), nullif(trim(coalesce(p_sitio_web, '')), ''), p_rol);
exception when unique_violation then
  raise exception 'REQUEST_PENDING';
end $$;
revoke execute on function public.request_institution(text, text, text, text) from public, anon;
grant execute on function public.request_institution(text, text, text, text) to authenticated;

-- Estado para la app: membresía, institución, última solicitud y último intento con carné.
create or replace function public.my_institution()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(m.status, 'none'),
    'method', m.method,
    'verified_at', m.verified_at,
    'institution', case when i.id is null then null else jsonb_build_object('id', i.id, 'nombre', i.nombre, 'nombre_corto', i.nombre_corto, 'ciudad', i.ciudad) end,
    'has_microsoft', exists (select 1 from public.institution_identity_providers p where p.institution_id = i.id and p.activo),
    'request', (select jsonb_build_object('nombre', r.nombre, 'estado', r.estado, 'created_at', r.created_at)
                  from public.institution_requests r where r.user_id = (select auth.uid()) order by r.created_at desc limit 1),
    'last_check', (select jsonb_build_object('decision', c.decision, 'reasons', c.reasons, 'created_at', c.created_at)
                     from public.student_id_checks c where c.user_id = (select auth.uid()) order by c.created_at desc limit 1)
  )
  from (select (select auth.uid()) as uid) me
  left join public.institution_memberships m on m.user_id = me.uid
  left join public.institutions i on i.id = m.institution_id
$$;
revoke execute on function public.my_institution() from public, anon;
grant execute on function public.my_institution() to authenticated;

-- Cara del carné (embedding calculado en el teléfono) contra la selfie del usuario.
create or replace function public.submit_student_card_face(p_embedding real[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_template real[];
  v_similarity double precision;
  v_match boolean;
begin
  if v_user is null then raise exception 'No autenticado'; end if;
  perform private.check_face_embedding(p_embedding);
  perform private.check_face_rate_limit(v_user);
  select embedding into v_template from public.face_templates where user_id = v_user and kind = 'selfie';
  if v_template is null then
    -- Sin selfie de referencia no hay con qué comparar: la decisión irá a revisión.
    insert into public.face_verifications (user_id, status, provider, error, purpose, template_kind)
    values (v_user, 'rechazado', 'on_device_sface', 'NO_SELFIE_TEMPLATE', 'student_card', 'student_card');
    return jsonb_build_object('match', false, 'reason', 'NO_SELFIE_TEMPLATE');
  end if;
  select sum(a.v * b.v) / (sqrt(sum(a.v * a.v)) * sqrt(sum(b.v * b.v)))
    into v_similarity
    from unnest(p_embedding) with ordinality as a(v, i)
    join unnest(v_template) with ordinality as b(v, i) using (i);
  v_match := v_similarity >= private.face_match_threshold();
  insert into public.face_verifications (user_id, status, provider, score, error, purpose, template_kind)
  values (v_user, case when v_match then 'verificado' else 'rechazado' end, 'on_device_sface', v_similarity,
          case when v_match then null else 'FACE_MISMATCH' end, 'student_card', 'student_card');
  return jsonb_build_object('match', v_match);
end $$;
revoke execute on function public.submit_student_card_face(real[]) from public, anon;
grant execute on function public.submit_student_card_face(real[]) to authenticated;

-- ---------------------------------------------------------------------
-- 6. Sin institución verificada no se publica ni se pide cupo
-- (antes, null = null dejaba pasar la comparación "misma organización").
-- ---------------------------------------------------------------------
create or replace function private.require_verified_institution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid := case when tg_table_name = 'trips' then new.driver_id else new.passenger_id end;
begin
  if (select institution_id from public.profiles where id = v_user) is null then
    raise exception 'INSTITUTION_NOT_VERIFIED' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists a_trips_require_verified_institution on public.trips;
create trigger a_trips_require_verified_institution before insert on public.trips
  for each row execute function private.require_verified_institution();
drop trigger if exists a_trip_requests_require_verified_institution on public.trip_requests;
create trigger a_trip_requests_require_verified_institution before insert on public.trip_requests
  for each row execute function private.require_verified_institution();

-- ---------------------------------------------------------------------
-- 7. Universidades colombianas
--
-- Major Colombian universities (QS 2026 press coverage), not an exact
-- top-10 claim: QS's own table blocks automated access. QS World
-- University Rankings 2026, as reported by:
--   La República  https://www.larepublica.co/empresas/las-universidades-colombianas-cedieron-terreno-en-el-ranking-mundial-de-qs-2026-4161553
--   Infobae       https://www.infobae.com/colombia/2026/01/21/ocho-universidades-colombianas-se-mantienen-entre-las-1000-mejores-del-mundo-segun-el-ranking-qs-conozca-cuales-son/
--   La FM         https://www.lafm.com.co/sociedad/estas-son-las-ocho-universidades-de-colombia-que-estan-entre-las-1000-mejores-del-mundo-para-estudiar-en-2026-388403
--   Noticias RCN  https://www.noticiasrcn.com/economia/mejores-universidades-de-colombia-en-2026-segun-qs-ranking-1072020
-- Eight in QS's top 1,000: Los Andes (#212), Nacional (#259), Javeriana
-- (~#371), Antioquia (781-790), Rosario, EAFIT, Externado, La Sabana
-- (651-1,000); plus UPB (1,001-1,200) and Universidad del Norte.
-- La Sabana's row is kept as it is (only empty short name/city are filled).
-- Domains checked October 28, 2026 against each university's own DNS: every
-- one has mail servers (MX) of its own; est.uexternado.edu.co is
-- Externado's student domain.
-- ---------------------------------------------------------------------
insert into public.institutions (nombre, nombre_corto, ciudad, sitio_web, tipo, dominio) values
  ('Universidad de los Andes',            'Uniandes',  'Bogotá',       'https://uniandes.edu.co',   'universidad', 'uniandes.edu.co'),
  ('Universidad Nacional de Colombia',    'UNAL',      'Bogotá',       'https://unal.edu.co',       'universidad', 'unal.edu.co'),
  ('Pontificia Universidad Javeriana',    'Javeriana', 'Bogotá',       'https://javeriana.edu.co',  'universidad', 'javeriana.edu.co'),
  ('Universidad de Antioquia',            'UdeA',      'Medellín',     'https://udea.edu.co',       'universidad', 'udea.edu.co'),
  ('Universidad del Rosario',             'Rosario',   'Bogotá',       'https://urosario.edu.co',   'universidad', 'urosario.edu.co'),
  ('Universidad EAFIT',                   'EAFIT',     'Medellín',     'https://eafit.edu.co',      'universidad', 'eafit.edu.co'),
  ('Universidad Externado de Colombia',   'Externado', 'Bogotá',       'https://uexternado.edu.co', 'universidad', 'uexternado.edu.co'),
  ('Universidad Pontificia Bolivariana',  'UPB',       'Medellín',     'https://upb.edu.co',        'universidad', 'upb.edu.co'),
  ('Universidad del Norte',               'Uninorte',  'Barranquilla', 'https://uninorte.edu.co',   'universidad', 'uninorte.edu.co')
on conflict (dominio) do nothing;

insert into public.institution_domains (dominio, institution_id)
  select dominio, id from public.institutions where dominio in (
    'uniandes.edu.co', 'unal.edu.co', 'javeriana.edu.co', 'udea.edu.co', 'urosario.edu.co',
    'eafit.edu.co', 'uexternado.edu.co', 'upb.edu.co', 'uninorte.edu.co')
on conflict (dominio) do nothing;
insert into public.institution_domains (dominio, institution_id)
  select 'est.uexternado.edu.co', id from public.institutions where dominio = 'uexternado.edu.co'
on conflict (dominio) do nothing;

update public.institutions
   set nombre_corto = coalesce(nombre_corto, 'La Sabana'), ciudad = coalesce(ciudad, 'Chía'), sitio_web = coalesce(sitio_web, 'https://unisabana.edu.co')
 where dominio = 'unisabana.edu.co';
