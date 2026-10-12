-- Scenario test for supabase/v6_37_kick_reminder_reset_delete.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
-- pg_net / pg_cron do not exist locally: the prelude stubs them (cron.schedule records the job, extension "pg_net" is a no-op schema).
-- NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
-- ---------- prelude ----------
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter role service_role bypassrls; -- as on Supabase
alter table auth.users add column if not exists email_confirmed_at timestamptz, add column if not exists created_at timestamptz default now();
create schema if not exists extensions;
create extension if not exists pgcrypto;
-- stand-ins for pg_net / pg_cron (the real ones exist on Supabase)
create schema net; create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;
create schema cron; create table cron.job(jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
insert into cron.job(jobname, schedule, command) values ('after-sales-deadline-every-minute', '* * * * *', 'select 1');
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
create publication supabase_realtime;
\i supabase/v6_27_remove_device.sql
create table public.login_alert_emails(user_id uuid primary key, email text, verified_at timestamptz, last_sent_at timestamptz, sent_count int default 0, sent_window timestamptz, updated_at timestamptz default now());
create table public.quota_counters(user_id uuid not null, bucket text not null, window_start timestamptz not null default now(), n integer not null default 0, primary key (user_id, bucket));
create table public.security_events(id serial primary key, user_id uuid, message text);
create table public.security_user_bans(id serial primary key, user_id uuid, status text);
create table public.security_ip_bans(id serial primary key, user_id uuid, ip inet);
create table public.bans(user_id uuid primary key);
create function public.is_user_banned(p_user_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists(select 1 from public.bans where user_id = p_user_id) $f$;
alter table public.after_sales_tasks add column order_id text, add column buyer_name text, add column status text, add column submission_status text, add column deadline timestamptz, add column deadline_at timestamptz, add column store_id int, add column uid uuid default gen_random_uuid() unique;
-- the real after_sales_tasks.id is uuid; the mock uses serial ids, so give the FK target a uuid column with the same name via a view-free trick:
alter table public.after_sales_tasks rename column id to serial_id; alter table public.after_sales_tasks rename column uid to id;
alter table public.shop_stores add column name text;
alter table public.evidence_files add column storage_path text; alter table public.evidence_library add column storage_path text;
create table storage.buckets(id text primary key); insert into storage.buckets values ('after-sales-evidence');
-- data: A (email, alert email verified), B (phone, no email), C (email, reminders off), D (banned), E (email not confirmed)
insert into auth.users(id, email, phone, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000aa', 'a@x.com', null, now()),
 ('00000000-0000-0000-0000-0000000000bb', null, '8613800138000', null),
 ('00000000-0000-0000-0000-0000000000cc', 'c@x.com', null, now()),
 ('00000000-0000-0000-0000-0000000000dd', 'd@x.com', null, now()),
 ('00000000-0000-0000-0000-0000000000ee', 'e@x.com', null, null);
insert into public.login_alert_emails(user_id, email, verified_at) values ('00000000-0000-0000-0000-0000000000aa', 'alert@x.com', now()), ('00000000-0000-0000-0000-0000000000cc', 'c2@x.com', now());
insert into public.bans values ('00000000-0000-0000-0000-0000000000dd');
insert into public.shop_stores(user_id, name) values ('00000000-0000-0000-0000-0000000000aa', '店A');
insert into public.after_sales_tasks(id, user_id, order_id, buyer_name, status, submission_status, deadline, deadline_at, store_id) values
 ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa', 'ORD-50', '张三', '待举证', 'pending', now() + interval '50 minutes', now() + interval '50 minutes', 1),
 ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000aa', 'ORD-20', '李四', '待举证', 'pending', null, now() + interval '20 minutes', null),
 ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000aa', 'ORD-90', null, '待举证', 'pending', now() + interval '90 minutes', now() + interval '90 minutes', null),
 ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000aa', 'ORD-DONE', null, '已完成', 'submitted_manual', now() + interval '20 minutes', now() + interval '20 minutes', null),
 ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000aa', 'ORD-PAST', null, '待举证', 'pending', now() - interval '5 minutes', now() - interval '5 minutes', null),
 ('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000bb', 'ORD-PHONE', null, '待举证', 'pending', now() + interval '20 minutes', now() + interval '20 minutes', null),
 ('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000cc', 'ORD-OFF', null, '待举证', 'pending', now() + interval '20 minutes', now() + interval '20 minutes', null),
 ('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000dd', 'ORD-BANNED', null, '待举证', 'pending', now() + interval '20 minutes', now() + interval '20 minutes', null),
 ('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000ee', 'ORD-UNCONF', null, '待举证', 'pending', now() + interval '20 minutes', now() + interval '20 minutes', null);
-- storage objects for A (new path styles + an old-style path) and for B
insert into storage.objects(bucket_id, name, owner) values
 ('after-sales-evidence', '00000000-0000-0000-0000-0000000000aa/tasks/t1/a.jpg', null),
 ('after-sales-evidence', '00000000-0000-0000-0000-0000000000aa/library/l.pdf', null),
 ('after-sales-evidence', '00000000-0000-0000-0000-0000000000aa/old-task/v.mp4', null),
 ('after-sales-evidence', '00000000-0000-0000-0000-0000000000bb/tasks/t2/b.jpg', null),
 ('other-bucket', '00000000-0000-0000-0000-0000000000aa/x.txt', null);
insert into public.security_devices(user_id, device_id) values ('00000000-0000-0000-0000-0000000000aa', 'WEB-a'), ('00000000-0000-0000-0000-0000000000bb', 'WEB-b');
insert into public.security_events(user_id, message) values ('00000000-0000-0000-0000-0000000000aa', 'x'), ('00000000-0000-0000-0000-0000000000bb', 'y');
insert into public.quota_counters(user_id, bucket) values ('00000000-0000-0000-0000-0000000000aa', 'kuaidi100');
insert into auth.sessions(id, user_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000bb'), ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb'), ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000aa');
insert into public.revoked_sessions(session_id, user_id) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000aa'), ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000bb');
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
-- ---------- install (twice) ----------
\! sed '/create extension if not exists pg_net/d' supabase/v6_37_kick_reminder_reset_delete.sql > /tmp/pgt/v6_37_local.sql
\i /tmp/pgt/v6_37_local.sql
\i /tmp/pgt/v6_37_local.sql
insert into r values ('v6_37 runs twice without error', true, null);
insert into r select 'cron: reminder job scheduled once, old job kept', (select count(*) from cron.job where jobname = 'deadline-reminder-mail') = 1 and exists (select 1 from cron.job where jobname = 'after-sales-deadline-every-minute') and (select command from cron.job where jobname = 'deadline-reminder-mail') like '%x-radar-cron%app_secrets%', null;
insert into r select 'cron_key generated once (64 hex), not regenerated on re-run', (select count(*) from public.app_secrets where name = 'cron_key' and value ~ '^[0-9a-f]{64}$') = 1, null;
-- ---------- segment 1: users read only their own revoked sessions ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into r select 'revoked_sessions: a user sees only own rows', (select count(*) from public.revoked_sessions) = 1 and (select bool_and(user_id = '00000000-0000-0000-0000-0000000000aa') from public.revoked_sessions), null;
do $$ begin insert into public.revoked_sessions(session_id, user_id) values (gen_random_uuid(), auth.uid()); insert into r values ('revoked_sessions: users cannot insert', false, null); exception when insufficient_privilege then insert into r values ('revoked_sessions: users cannot insert', true, null); end $$;
do $$ begin delete from public.revoked_sessions; insert into r values ('revoked_sessions: users cannot delete (un-revoke)', false, null); exception when insufficient_privilege then insert into r values ('revoked_sessions: users cannot delete (un-revoke)', true, null); end $$;
insert into r select 'revoked_sessions in the realtime publication', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'revoked_sessions'), null;
-- ---------- segment 2: reminders ----------
do $$ begin perform public.deadline_reminders_due(); insert into r values ('reminders: users cannot call', false, null); exception when insufficient_privilege then insert into r values ('reminders: users cannot call', true, null); end $$;
do $$ begin perform 1 from public.app_secrets; insert into r values ('app_secrets: users cannot read', false, null); exception when insufficient_privilege then insert into r values ('app_secrets: users cannot read', true, null); end $$;
reset role;
set role service_role;
create temp table due1 as select * from public.deadline_reminders_due();
reset role;
insert into r select 'reminders: 50 min -> 60 tier, 20 min -> 30 tier (deadline_at used when deadline is null); C is on by default', (select string_agg(order_id || ':' || kind, ',' order by order_id) from due1) = 'ORD-20:30,ORD-50:60,ORD-OFF:30', (select string_agg(order_id || ':' || kind || ':' || email, ',' order by order_id) from due1);
insert into r select 'reminders: verified alert email preferred over login email, store name included', (select email from due1 where order_id = 'ORD-50') = 'alert@x.com' and (select store_name from due1 where order_id = 'ORD-50') = '店A', null;
insert into r select 'reminders: no mail for done / overdue / >60 min / phone-only / banned / unconfirmed email', not exists (select 1 from due1 where order_id in ('ORD-90', 'ORD-DONE', 'ORD-PAST', 'ORD-PHONE', 'ORD-BANNED', 'ORD-UNCONF')), (select string_agg(order_id, ',') from due1);
set role service_role;
create temp table due2 as select * from public.deadline_reminders_due();
reset role;
insert into r select 'reminders: second run sends nothing again (claimed)', (select count(*) from due2) = 0, (select string_agg(order_id, ',') from due2);
-- C turns reminders off; a new task for C becomes due
update public.login_alert_emails set deadline_mail_off = true where user_id = '00000000-0000-0000-0000-0000000000cc';
insert into public.after_sales_tasks(id, user_id, order_id, status, submission_status, deadline_at) values ('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000cc', 'ORD-OFF2', '待举证', 'pending', now() + interval '25 minutes');
set role service_role;
create temp table due3 as select * from public.deadline_reminders_due();
reset role;
insert into r select 'reminders: turned off -> nothing for that account', not exists (select 1 from due3 where order_id = 'ORD-OFF2'), (select string_agg(order_id, ',') from due3);
-- the 50-minute task moves into the 30-minute window -> second tier once; a send failure is un-claimed and retried
update public.after_sales_tasks set deadline_at = now() + interval '25 minutes' where order_id = 'ORD-50';
set role service_role;
create temp table due4 as select * from public.deadline_reminders_due();
delete from public.task_deadline_mails where task_id = '10000000-0000-0000-0000-000000000001' and kind = '30';
create temp table due5 as select * from public.deadline_reminders_due();
reset role;
insert into r select 'reminders: 60 then 30 tier for the same task, each once; un-claim -> retried', (select string_agg(order_id || ':' || kind, ',') from due4) = 'ORD-50:30' and (select string_agg(order_id || ':' || kind, ',') from due5) = 'ORD-50:30', coalesce((select string_agg(order_id || ':' || kind, ',') from due4),'-') || ' / ' || coalesce((select string_agg(order_id || ':' || kind, ',') from due5),'-');
-- a task created with 20 minutes left after its 30 tier was sent never gets a 60 tier
insert into r select 'reminders: never a 60 tier after a 30 tier', not exists (select 1 from public.task_deadline_mails m where m.task_id = '10000000-0000-0000-0000-000000000002' and m.kind = '60'), null;
-- ---------- segment 3: server-only helpers ----------
set role service_role;
insert into r select 'auth_user_by_phone: +86 / bare / unknown / empty', public.auth_user_by_phone('+8613800138000') = '00000000-0000-0000-0000-0000000000bb' and public.auth_user_by_phone('8613800138000') = '00000000-0000-0000-0000-0000000000bb' and public.auth_user_by_phone('+8613900000000') is null and public.auth_user_by_phone('') is null, null;
insert into r select 'user_storage_paths: all of A''s files in the evidence bucket (incl. old-style path), nothing from others', (select array_agg(p order by p) from public.user_storage_paths('00000000-0000-0000-0000-0000000000aa') p) = array['00000000-0000-0000-0000-0000000000aa/library/l.pdf', '00000000-0000-0000-0000-0000000000aa/old-task/v.mp4', '00000000-0000-0000-0000-0000000000aa/tasks/t1/a.jpg'], null;
insert into r select 'service_revoke_all_sessions: B''s 2 sessions', public.service_revoke_all_sessions('00000000-0000-0000-0000-0000000000bb') = 2, null;
select public.delete_user_extras('00000000-0000-0000-0000-0000000000aa', 'a@***') \g /dev/null
reset role;
insert into r select 'service_revoke_all_sessions: B revoked + deleted, A untouched', (select count(*) from public.revoked_sessions where user_id = '00000000-0000-0000-0000-0000000000bb') = 3 and not exists (select 1 from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000bb') and exists (select 1 from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000aa'), null;
insert into r select 'delete_user_extras: A''s devices / events / counters gone, B''s kept, audit row written', not exists (select 1 from public.security_devices where user_id = '00000000-0000-0000-0000-0000000000aa') and not exists (select 1 from public.security_events where user_id = '00000000-0000-0000-0000-0000000000aa') and not exists (select 1 from public.quota_counters where user_id = '00000000-0000-0000-0000-0000000000aa') and exists (select 1 from public.security_devices where user_id = '00000000-0000-0000-0000-0000000000bb') and exists (select 1 from public.admin_operation_logs where action = 'account_delete' and detail like '%a@***%'), null;
set role authenticated;
do $$ begin perform public.user_storage_paths('00000000-0000-0000-0000-0000000000bb'); insert into r values ('helpers: users cannot call', false, null); exception when insufficient_privilege then insert into r values ('helpers: users cannot call', true, null); end $$;
do $$ begin perform public.auth_user_by_phone('8613800138000'); insert into r values ('auth_user_by_phone: users cannot call (no enumeration)', false, null); exception when insufficient_privilege then insert into r values ('auth_user_by_phone: users cannot call (no enumeration)', true, null); end $$;
reset role;
insert into r select 'quota_counters readable by the server (delete-account lock check)', has_table_privilege('service_role', 'public.quota_counters', 'select'), null;
\set QUIET 0
select case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
