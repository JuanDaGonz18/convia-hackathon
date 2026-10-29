-- =====================================================================
-- ConVía — Traza del agente de viajes (Edge Function match-agent)
--
-- Cada consulta al agente es una fila de agent_runs y cada paso (llamada
-- al modelo o a una herramienta) una fila de agent_steps, con el
-- proveedor, el modelo que el proveedor dijo haber usado y su id de
-- solicitud: así se puede comprobar que corrió sobre pesos abiertos.
-- Solo la función (service_role) escribe; cada usuario lee sus corridas.
-- La traza guarda lo que vio el modelo (placas enmascaradas, sin
-- teléfonos), nunca más.
-- =====================================================================

create table public.agent_runs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  role               text not null check (role in ('passenger', 'driver')),
  input              text not null check (char_length(input) between 1 and 1000),
  language           text check (language in ('es', 'en')),
  -- answered: respondió · clarify: preguntó algo · proposed: dejó una acción por confirmar
  -- failed: error · limit: se acabaron los pasos o el tiempo.
  status             text not null default 'running'
                       check (status in ('running', 'answered', 'clarify', 'proposed', 'failed', 'limit')),
  -- Respuesta final: { reply, cards: [trip_id], proposal_id? }.
  reply              jsonb,
  -- Acción propuesta (propose_*), con los argumentos exactos; solo /confirm la ejecuta, una vez.
  pending_action     jsonb,
  pending_action_used_at timestamptz,
  steps              smallint not null default 0,
  prompt_tokens      integer not null default 0,
  completion_tokens  integer not null default 0,
  reasoning_tokens   integer not null default 0,
  cached_tokens      integer not null default 0,
  cost_usd           numeric(10, 6) not null default 0,
  latency_ms         integer,
  error              text,
  created_at         timestamptz not null default now(),
  finished_at        timestamptz
);
create index agent_runs_user_idx on public.agent_runs(user_id, created_at desc);

create table public.agent_steps (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.agent_runs(id) on delete cascade,
  n                  smallint not null,
  kind               text not null check (kind in ('model', 'tool')),
  -- Paso de modelo: quién respondió, con qué modelo (según la respuesta) y su id de solicitud.
  provider           text,
  model              text,
  request_id         text,
  response_id        text,
  -- Cabeceras del proveedor que identifican el despliegue (p. ej. x-baseten-model-version-id).
  served_by          jsonb,
  -- Intentos fallidos antes de esta respuesta (otro proveedor, timeout, respuesta vacía...).
  attempts           jsonb not null default '[]'::jsonb,
  finish_reason      text,
  prompt_tokens      integer,
  completion_tokens  integer,
  reasoning_tokens   integer,
  cached_tokens      integer,
  cost_usd           numeric(10, 6),
  -- Paso de herramienta: nombre, argumentos validados y resultado estructurado.
  tool_name          text,
  args               jsonb,
  result             jsonb,
  latency_ms         integer,
  error              text,
  created_at         timestamptz not null default now(),
  unique (run_id, n)
);

alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;

grant select on public.agent_runs, public.agent_steps to authenticated;
grant all on public.agent_runs, public.agent_steps to service_role;

create policy "agent_runs_read_own" on public.agent_runs
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "agent_steps_read_own" on public.agent_steps
  for select to authenticated
  using (exists (select 1 from public.agent_runs r where r.id = run_id and r.user_id = (select auth.uid())));
