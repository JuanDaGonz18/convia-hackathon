-- =====================================================================
-- ConVía — institution search matches the typed text literally
--
-- search_institutions used LIKE '%' || query || '%', so "%%%" passed the
-- 3-letter rule and matched every institution (capped at 10). strpos()
-- has no wildcards: "%" and "_" are just characters.
-- =====================================================================

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
     and strpos(lower(extensions.unaccent(i.nombre || ' ' || coalesce(i.nombre_corto, '') || ' ' || coalesce(i.ciudad, ''))), q.text) > 0
   order by i.nombre
   limit 10
$$;
revoke execute on function public.search_institutions(text) from public, anon;
grant execute on function public.search_institutions(text) to authenticated;
