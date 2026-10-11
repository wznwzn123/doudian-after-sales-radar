-- Minimal Supabase-like mock for running supabase/*.sql on a LOCAL PostgreSQL (auth.users/sessions/refresh_tokens, auth.uid()/auth.jwt() from GUCs,
-- roles anon/authenticated, storage.objects, the business tables with a simple owner RLS). Used by dev/v6_27_remove_device.pgtest.sql. NOT the real schema.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, email text, phone text);
create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade, created_at timestamptz default now());
create table auth.refresh_tokens(id bigserial primary key, session_id uuid references auth.sessions(id) on delete cascade, token text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
grant usage on schema auth, storage, public to anon, authenticated;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
create table storage.objects(id serial primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create policy own on storage.objects for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
grant all on storage.objects to authenticated; grant usage on all sequences in schema storage to authenticated;
create table public.security_devices(id uuid primary key default gen_random_uuid(), user_id uuid, device_id text, platform text, status text default 'active', first_seen timestamptz default now(), last_seen timestamptz default now(), last_seen_at timestamptz, device_name text, last_ip inet, user_agent text);
alter table public.security_devices enable row level security;
create table public.admin_operation_logs(id uuid primary key default gen_random_uuid(), user_id uuid, action text not null, detail text, created_at timestamptz default now());
alter table public.admin_operation_logs enable row level security;
create table public.login_alert_acks(user_id uuid primary key, seen_at timestamptz not null default now());
alter table public.login_alert_acks enable row level security;
do $$ declare t text; begin foreach t in array array['after_sales_tasks','after_sales_events','evidence_files','evidence_library','shop_stores','tracking_records','support_messages'] loop
  execute format('create table public.%I(id serial primary key, user_id uuid default auth.uid())', t);
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy own on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  execute format('grant all on public.%I to authenticated', t);
  execute format('grant usage on sequence public.%I to authenticated', t || '_id_seq');
end loop; end $$;
