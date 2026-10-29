-- =====================================================================
-- ConVía — Carné sin foto: carné + captura de la cuenta institucional
--
-- Segundo camino para verificar la institución cuando el carné no tiene
-- foto: el usuario sube el carné (frente) y una captura recortada de su
-- perfil institucional (Teams, Outlook o el portal) con su nombre y su
-- correo. Muse Spark lee ambos y el código compara. Como una captura es
-- fácil de falsificar, este camino NUNCA verifica solo: todo va a
-- revisión manual, con un resumen para quien revisa (marcas y puntajes,
-- sin nombres ni correo completo; solo el dominio del correo).
--
-- Métodos: 'student_card_photo' (carné con foto, verificación automática)
-- y 'document' (carné sin foto + captura, aprobado por una persona).
-- =====================================================================

-- 'student_id' pasa a llamarse 'student_card_photo'; se agrega 'document'.
alter table public.institution_memberships drop constraint if exists institution_memberships_method_check;
update public.institution_memberships set method = 'student_card_photo' where method = 'student_id';
alter table public.institution_memberships
  add constraint institution_memberships_method_check
  check (method is null or method in ('institutional_email', 'microsoft', 'student_card_photo', 'document'));

alter table public.student_id_checks
  add column if not exists kind text not null default 'card_photo' check (kind in ('card_photo', 'document')),
  -- Solo el dominio del correo de la captura (p. ej. "unal.edu.co"), nunca el correo completo.
  add column if not exists email_domain text check (email_domain is null or email_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  -- Para quien revisa: coincidencias y señales, sin datos personales.
  add column if not exists review_summary jsonb;

-- Aprobar desde el dashboard (SQL editor), tras revisar el resumen:
--   select private.approve_membership('<user_id>', 'document');
create or replace function private.approve_membership(p_user uuid, p_method text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_method not in ('student_card_photo', 'document') then raise exception 'INVALID_METHOD'; end if;
  perform private.verify_membership(p_user, p_method);
end $$;
revoke execute on function private.approve_membership(uuid, text) from public, anon, authenticated;

-- El estado para la app incluye el tipo del último intento.
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
    'last_check', (select jsonb_build_object('decision', c.decision, 'kind', c.kind, 'reasons', c.reasons, 'created_at', c.created_at)
                     from public.student_id_checks c where c.user_id = (select auth.uid()) order by c.created_at desc limit 1)
  )
  from (select (select auth.uid()) as uid) me
  left join public.institution_memberships m on m.user_id = me.uid
  left join public.institutions i on i.id = m.institution_id
$$;
