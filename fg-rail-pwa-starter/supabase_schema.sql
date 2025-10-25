create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  dd_status text default 'none',
  created_at timestamptz default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  retailer text,
  pnr text,
  price_gbp numeric,
  type text,
  pdf_path text,
  raw_email_id text,
  created_at timestamptz default now()
);

create table if not exists legs (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  origin text,
  destination text,
  plan_dep text,
  plan_arr text,
  operator text,
  uid text,
  rid text,
  actual_arr text,
  delay_minutes int
);

create table if not exists eligibility (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  toc text,
  scheme text,
  band text,
  expected_amount_gbp numeric,
  threshold_met boolean default false
);

create table if not exists claims (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  toc text,
  channel text,
  status text default 'draft',
  submitted_at timestamptz,
  decision text,
  paid_amount_gbp numeric,
  evidence_paths jsonb,
  last_error text
);

create table if not exists fees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  kind text check (kind in ('booking','refund')),
  amount_gbp numeric,
  status text,
  provider_ref text,
  created_at timestamptz default now()
);

create table if not exists audit (
  id uuid primary key default gen_random_uuid(),
  ref_type text,
  ref_id uuid,
  event text,
  details jsonb,
  ts timestamptz default now()
);
