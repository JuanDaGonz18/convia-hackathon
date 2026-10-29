-- =====================================================================
-- ConVía — Agente de viajes: el bucle y la confirmación
--
-- agent_runs guarda el estado del bucle (para reanudar paso a paso), la
-- especificación aceptada (checkpoint 1) y la propuesta verificada
-- (checkpoint 2) con su hash: la confirmación del usuario solo vale para
-- esa propuesta exacta. Nuevos estados: no_match, unverified y paused.
-- =====================================================================

alter table public.agent_runs drop constraint if exists agent_runs_status_check;
alter table public.agent_runs
  add constraint agent_runs_status_check
  check (status in ('running', 'paused', 'proposed', 'clarify', 'no_match', 'unverified', 'limit', 'failed', 'answered', 'confirmed'));

alter table public.agent_runs
  -- Estado del bucle (mensajes, lugares, búsquedas) para el modo paso a paso.
  add column if not exists state jsonb,
  add column if not exists spec jsonb,
  -- SHA-256 de {trip_id, seats, price, departure, pickup, dropoff} de la propuesta verificada.
  add column if not exists proposal_hash text check (proposal_hash is null or proposal_hash ~ '^[0-9a-f]{64}$'),
  add column if not exists confirmed_request_id uuid references public.trip_requests(id) on delete set null;

alter table public.agent_steps drop constraint if exists agent_steps_kind_check;
alter table public.agent_steps add constraint agent_steps_kind_check check (kind in ('model', 'tool', 'judge'));
alter table public.agent_steps add column if not exists plan text check (plan is null or char_length(plan) <= 300);
-- Un paso por (corrida, número) ya era único; las corridas se leen en orden.
create index if not exists agent_steps_run_idx on public.agent_steps(run_id, n);
