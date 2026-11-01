-- Studio: job state and append-only runner events.
-- Prefix st_ keeps this isolated from ce_/dr_ tables in the shared project.

create extension if not exists pgcrypto;

create table if not exists st_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  capability    text not null,
  spec          jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                check (status in ('queued', 'dispatched', 'running', 'complete', 'error', 'killed')),
  stage         text,
  progress      int not null default 0,
  output_path   text,
  output_name   text,
  error         text,
  run_id        text,
  tokens_in     int not null default 0,
  tokens_out    int not null default 0,
  cost_usd      numeric(10, 6) not null default 0,
  meta          jsonb not null default '{}'::jsonb
);

create table if not exists st_events (
  id          bigserial primary key,
  job_id      uuid not null references st_jobs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  level       text not null default 'info' check (level in ('info', 'warn', 'error')),
  stage       text,
  message     text not null,
  data        jsonb
);

create index if not exists st_jobs_created_idx on st_jobs (created_at desc);
create index if not exists st_jobs_status_idx on st_jobs (status);
create index if not exists st_events_job_idx on st_events (job_id, id);

alter table st_jobs enable row level security;
alter table st_events enable row level security;

-- No policies are defined on purpose: only the service role (the Worker and the
-- runner) may read or write. Add policies here if a browser client ever needs
-- direct access.
