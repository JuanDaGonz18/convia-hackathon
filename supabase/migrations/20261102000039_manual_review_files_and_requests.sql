-- =====================================================================
-- ConVía — manual review: card images for the reviewer, institution requests
--
-- A. When a student-card check goes to manual review, verify-student-id
--    keeps what it sent to Muse Spark (the crops AROUND the face, or the
--    faceless card + account screenshot) in the private face-verifications
--    bucket as <user_id>/student-card-review-*.jpg. They never contain a
--    face: the phone cuts it out (or checks there is none) before sending.
--    They are deleted when the reviewer decides (review-core.mjs), when the
--    user checks again, when the account is deleted, and in any case after
--    7 days by the daily job below (pg_cron + pg_net → card-review-cleanup).
--    The job needs the project URL in Vault (convia_project_url, the same
--    secret dispatch_pending_pushes uses); without it it does nothing.
--
-- B. "My institution isn't listed" requests are decided from the review
--    tool (npm run review -- --institutions): approve creates the
--    institution and its domains as the seed does, merge adds the domain to
--    an existing one, reject keeps a reason. Approve and merge re-run the
--    e-mail check for the requester, so an institutional e-mail on that
--    domain is verified at once (my_institution shows it).
--
-- No RLS changes: the new columns are covered by the existing read-own policy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. Card images kept for review: expired files (for the cleanup function)
-- ---------------------------------------------------------------------
create or replace function public.service_expired_card_review_files(p_older_than interval default interval '7 days')
returns setof text language sql stable security definer set search_path = '' as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'face-verifications'
     and o.name ~ '^[0-9a-f-]{36}/student-card-review-[A-Za-z0-9._-]+$'
     and o.created_at < now() - p_older_than
   order by o.created_at
   limit 1000
$$;
revoke execute on function public.service_expired_card_review_files(interval) from public, anon, authenticated;
grant execute on function public.service_expired_card_review_files(interval) to service_role;

-- Every day: if any image is older than 7 days, ask card-review-cleanup to delete it
-- through the Storage API (deleting rows in storage.objects would leave the files).
create or replace function private.dispatch_card_review_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text;
begin
  if not exists (select 1 from public.service_expired_card_review_files()) then return; end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'convia_project_url';
  if v_url is null then return; end if;
  perform net.http_post(
    url := v_url || '/functions/v1/card-review-cleanup',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb);
end $$;
revoke execute on function private.dispatch_card_review_cleanup() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-card-review-files';
select cron.schedule('cleanup-card-review-files', '41 3 * * *', $$select private.dispatch_card_review_cleanup()$$);

-- ---------------------------------------------------------------------
-- B. Institution requests
-- ---------------------------------------------------------------------
alter table public.institution_requests
  add column if not exists motivo         text check (motivo is null or char_length(motivo) between 3 and 300),
  add column if not exists institution_id uuid references public.institutions(id) on delete set null,
  add column if not exists reviewed_at    timestamptz;

-- The sign-up rule (handle_new_user) run again for an existing user: an e-mail on an
-- active institution's domain verifies them. Otherwise, someone with no institution yet
-- gets p_fallback chosen (pending), so the app offers the card.
create or replace function private.recheck_institution_email(p_user uuid, p_fallback uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_inst   uuid;
  v_status text;
begin
  select status into v_status from public.institution_memberships where user_id = p_user;
  if v_status = 'verified' then return 'already_verified'; end if;
  select i.id into v_inst
    from public.profiles p
    join public.institution_domains d on d.dominio = lower(split_part(p.email, '@', 2))
    join public.institutions i on i.id = d.institution_id and i.activo
   where p.id = p_user;
  if v_inst is not null then
    insert into public.institution_memberships (user_id, institution_id, status)
    values (p_user, v_inst, 'pending')
    on conflict (user_id) do update set institution_id = excluded.institution_id, status = 'pending', updated_at = now();
    perform private.verify_membership(p_user,
      case when exists (select 1 from auth.identities i where i.user_id = p_user and i.provider = 'azure')
           then 'microsoft' else 'institutional_email' end);
    return 'verified_by_email';
  end if;
  if v_status is null and p_fallback is not null then
    insert into public.institution_memberships (user_id, institution_id, status) values (p_user, p_fallback, 'pending');
    return 'institution_chosen';
  end if;
  return 'unchanged';
end $$;
revoke execute on function private.recheck_institution_email(uuid, uuid) from public, anon, authenticated;

-- For the review tool (service_role). p_action: approve | merge | reject.
--   approve: creates the institution (name, city and website of the request, or the edited name)
--            with p_dominios (the first is the main one), as the seed stores them.
--   merge:   adds p_dominios (may be empty) to p_institution.
--   reject:  keeps p_motivo.
create or replace function public.service_resolve_institution_request(
  p_request    uuid,
  p_action     text,
  p_nombre     text default null,
  p_dominios   text[] default '{}',
  p_institution uuid default null,
  p_motivo     text default null,
  p_tipo       public.community_type default 'universidad'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r       public.institution_requests;
  v_inst  uuid;
  v_dom   text;
  v_owner uuid;
  v_doms  text[] := array(select distinct lower(trim(d)) from unnest(coalesce(p_dominios, '{}')) d where trim(d) <> '');
begin
  select * into r from public.institution_requests where id = p_request for update;
  if r.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if r.estado <> 'pendiente' then raise exception 'REQUEST_ALREADY_%', upper(r.estado); end if;

  if p_action = 'reject' then
    update public.institution_requests set estado = 'rechazada', motivo = trim(p_motivo), reviewed_at = now() where id = r.id;
    return jsonb_build_object('estado', 'rechazada');
  end if;

  foreach v_dom in array v_doms loop
    select institution_id into v_owner from public.institution_domains where dominio = v_dom;
    if v_owner is not null and (p_action = 'approve' or v_owner <> p_institution) then
      raise exception 'DOMAIN_TAKEN: %', v_dom;
    end if;
  end loop;

  if p_action = 'approve' then
    if cardinality(v_doms) = 0 then raise exception 'DOMAIN_REQUIRED'; end if;
    insert into public.institutions (nombre, ciudad, sitio_web, tipo, dominio)
    values (coalesce(nullif(trim(p_nombre), ''), r.nombre), r.ciudad, r.sitio_web, p_tipo, v_doms[1])
    returning id into v_inst;
  elsif p_action = 'merge' then
    select id into v_inst from public.institutions where id = p_institution;
    if v_inst is null then raise exception 'INSTITUTION_NOT_FOUND'; end if;
  else
    raise exception 'INVALID_ACTION';
  end if;

  insert into public.institution_domains (dominio, institution_id)
    select d, v_inst from unnest(v_doms) d
  on conflict (dominio) do nothing;
  update public.institution_requests set estado = 'aprobada', institution_id = v_inst, reviewed_at = now() where id = r.id;
  return jsonb_build_object('estado', 'aprobada', 'institution_id', v_inst,
                            'requester', private.recheck_institution_email(r.user_id, v_inst));
end $$;
revoke execute on function public.service_resolve_institution_request(uuid, text, text, text[], uuid, text, public.community_type) from public, anon, authenticated;
grant execute on function public.service_resolve_institution_request(uuid, text, text, text[], uuid, text, public.community_type) to service_role;
