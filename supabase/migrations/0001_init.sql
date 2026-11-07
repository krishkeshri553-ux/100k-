-- HustleGrowthz AI Revenue Department — initial schema
-- Apply with: supabase db push   (or paste into the Supabase SQL editor, or run the "DB migrate" GitHub workflow)
-- Every table has Row Level Security ENABLED and NO policies: only the service-role key
-- (used server-side by GitHub Actions and Vercel functions) can read or write. The anon key gets nothing.

create extension if not exists pgcrypto;

-- ───────────────────────── prospects (CRM source of truth) ─────────────────────────
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,            -- resolved identity (linkedin slug > email > name+company)
  full_name text not null,
  first_name text,
  last_name text,
  headline text,
  title text,
  company text,
  location text,
  market text not null default 'unknown',        -- dubai | usa | uk | other | unknown
  linkedin_url text unique,
  email text unique,
  source text not null,                          -- linkedin_messages | linkedin_connections | crm_csv | sales_navigator_manual | manual
  stage text not null default 'discovered',
  lead_category text,                            -- reactivation category A–I / never_engaged
  interest_level text,                           -- high | medium | low | none | unknown
  offer_fit text,                                -- strong | possible | weak | unknown
  previous_objection text,
  score integer,
  score_class text,
  score_confidence numeric,
  score_breakdown jsonb,
  research jsonb not null default '{}'::jsonb,   -- owner/assistant research: posting_frequency, has_video, recent_post_at, ability_to_invest, headcount, notes
  conversation_summary text,
  last_interaction_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  next_action text,
  next_action_due date,
  follow_up_priority integer,                    -- 1 (highest) .. 5
  deal_value_estimate numeric,
  contact_status text not null default 'ok',     -- ok | do_not_contact | opted_out
  contact_status_reason text,
  snoozed_until date,
  tags text[] not null default '{}',
  is_synthetic boolean not null default false,
  analysed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prospects_stage_idx on prospects(stage);
create index if not exists prospects_market_idx on prospects(market);
create index if not exists prospects_score_idx on prospects(score desc);

-- ───────────────────────── conversation timeline ─────────────────────────
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  external_id text not null unique,              -- content hash → import is idempotent
  direction text not null,                       -- inbound | outbound
  channel text not null default 'linkedin_message',
  sent_at timestamptz not null,
  body text not null,
  source text not null,                          -- import source or owner_confirmed
  analysed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_prospect_idx on messages(prospect_id, sent_at);

-- ───────────────────────── outreach drafts + approval state ─────────────────────────
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  kind text not null,                            -- connection_note | initial_message | follow_up | inmail | reply | reactivation
  subject text,
  body text not null,
  rationale text,
  observation text,
  positioning text,
  cta text,
  follow_up_in_days integer,
  status text not null default 'pending_approval', -- pending_approval | blocked | approved | rejected | snoozed | sent_manually | superseded
  guardrail_flags jsonb not null default '[]'::jsonb,
  generated_by text not null,                    -- claude:<model> | template
  idempotency_key text not null unique,
  body_hash text not null,
  snooze_until date,
  decided_at timestamptz,
  sent_confirmed_at timestamptz,                 -- set ONLY when the owner confirms they sent it
  outcome text,                                  -- accepted | declined | replied | no_response
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists drafts_status_idx on drafts(status);
create index if not exists drafts_prospect_idx on drafts(prospect_id);

-- ───────────────────────── appointments ─────────────────────────
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  idempotency_key text not null unique,
  google_event_id text unique,
  start_at timestamptz not null,
  end_at timestamptz not null,
  timezone text not null,
  status text not null,                          -- confirmed | cancelled | rescheduled | attended | no_show
  prospect_confirmation text not null,           -- evidence of explicit confirmation
  qualified boolean,
  notes text,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── deals + cash ─────────────────────────
create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references prospects(id) on delete cascade,
  title text not null,
  plan text,                                     -- monthly | annual | custom
  status text not null default 'open',           -- open | proposal | won | lost
  contract_value numeric not null default 0,
  currency text not null default 'USD',
  probability numeric,                           -- 0..1, owner-entered for forecast
  market text,
  lead_source text,
  signed_at timestamptz,
  closed_at timestamptz,
  lost_reason text,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  invoice_ref text,
  amount numeric not null,
  currency text not null default 'USD',
  status text not null default 'outstanding',    -- outstanding | paid | void
  due_at date,
  paid_at timestamptz,
  verified boolean not null default false,       -- owner verified the money actually arrived
  idempotency_key text unique,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── content department ─────────────────────────
create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'idea',           -- idea | draft | pending_approval | approved | published | rejected
  pillar text,
  audience text,
  topic text not null,
  hook text,
  body text,
  cta text,
  format text,                                   -- text | carousel | video | image | poll
  objective text,
  reasoning text,
  suggested_visual text,
  assets jsonb not null default '[]'::jsonb,     -- rendered slides (svg) etc.
  scheduled_for date,
  published_at timestamptz,
  published_url text,
  metrics jsonb,                                 -- owner-entered real numbers only
  leads_attributed integer not null default 0,
  generated_by text,
  idempotency_key text unique,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── competitor intelligence ─────────────────────────
create table if not exists competitors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  market text,
  profile_url text,
  category text,                                 -- real_estate_creator | content_agency | other
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, market)
);

create table if not exists competitor_observations (
  id uuid primary key default gen_random_uuid(),
  competitor_id uuid not null references competitors(id) on delete cascade,
  source_url text not null,
  observed_at date not null,
  observation text not null,
  content_theme text,
  format text,
  evidence text,
  strategic_opportunity text,
  kind text not null default 'fact',             -- fact | estimate
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

-- ───────────────────────── audit log / activity feed ─────────────────────────
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  type text not null,
  source text not null,                          -- workflow:<name> | tracker | cli | import
  actor text not null default 'system',          -- system | owner
  prospect_id uuid references prospects(id) on delete set null,
  summary text not null,
  data jsonb not null default '{}'::jsonb,
  is_synthetic boolean not null default false
);
create index if not exists events_time_idx on events(occurred_at desc);
create index if not exists events_type_idx on events(type);

-- ───────────────────────── workflow runs (idempotency + health) ─────────────────────────
create table if not exists workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow text not null,
  slot text not null,
  status text not null,                          -- running | succeeded | failed | skipped
  attempt integer not null default 1,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text,
  stats jsonb not null default '{}'::jsonb,
  unique (workflow, slot, attempt)
);
create index if not exists workflow_runs_time_idx on workflow_runs(started_at desc);

-- ───────────────────────── reports ─────────────────────────
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                            -- daily | weekly
  period_start date not null,
  period_end date not null,
  metrics jsonb not null,
  body_md text not null,
  created_at timestamptz not null default now(),
  unique (kind, period_start)
);

-- ───────────────────────── settings + integrations ─────────────────────────
create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists integration_status (
  name text primary key,
  status text not null,                          -- connected | not_configured | error | manual_only
  detail text,
  checked_at timestamptz not null default now()
);

insert into settings(key, value) values
  ('automation_paused', 'false'::jsonb)
on conflict (key) do nothing;

-- ───────────────────────── RLS: deny-all except service role ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['prospects','messages','drafts','appointments','deals','payments','content_items',
                           'competitors','competitor_observations','events','workflow_runs','reports','settings','integration_status']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['prospects','drafts','appointments','deals','payments','content_items','competitors']
  loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function touch_updated_at()', t, t);
  end loop;
end $$;
