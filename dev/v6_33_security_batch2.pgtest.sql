-- Scenario test for supabase/v6_33_security_batch2.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
-- The prelude below adds what the mock lacks (service_role, admin_users, storage.buckets, store_id, the real policy names) and
-- installs v6_27 first. NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
-- ---------- prelude: make the mock look like production for the parts v6_33 touches ----------
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter table auth.users add column if not exists last_sign_in_at timestamptz, add column if not exists created_at timestamptz default now();
alter table auth.sessions add column if not exists updated_at timestamptz default now();
create table storage.buckets(id text primary key, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets(id, file_size_limit) values ('after-sales-evidence', 524288000);
create table public.admin_users(user_id uuid not null, constraint admin_users_user_id_unique unique (user_id));
create unique index idx_admin_users_user_id_unique on public.admin_users(user_id);
alter table public.admin_users enable row level security;
grant select on public.admin_users to authenticated;
create policy admin_users_insert_self on public.admin_users for insert to authenticated with check (user_id = auth.uid());
create policy admin_users_select_self on public.admin_users for select to authenticated using (user_id = auth.uid());
create policy admin_users_self_read on public.admin_users for select to authenticated using (user_id = auth.uid());
create policy admin_users_update_self on public.admin_users for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
alter table public.after_sales_tasks add column store_id int;
create index idx_after_sales_tasks_user_id on public.after_sales_tasks(user_id); create index tasks_user_idx on public.after_sales_tasks(user_id);
create index idx_tasks_store on public.after_sales_tasks(store_id); create index tasks_store_idx on public.after_sales_tasks(store_id);
do $$ declare t text; p text; begin
  for t, p in select * from (values ('after_sales_events','after_sales_events_user_access'),('after_sales_events','events_owner'),('after_sales_tasks','after_sales_tasks_user_access'),('after_sales_tasks','tasks_owner'),
    ('evidence_files','evidence_files_user_access'),('evidence_files','files_owner'),('evidence_library','library_owner'),('shop_stores','shop_stores_owner'),('tracking_records','tracking_owner'),('tracking_records','tracking_records_user_access')) v loop
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', p, t); end loop;
  foreach t in array array['evidence_library','shop_stores'] loop
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())', t || '_delete_own', t); end loop;
  foreach t in array array['after_sales_events','after_sales_tasks','evidence_files','evidence_library','shop_stores','tracking_records'] loop execute format('drop policy own on public.%I', t); end loop;
end $$;
-- the old (bypassed) store check, as in production
create policy after_sales_tasks_insert_own on public.after_sales_tasks for insert to authenticated with check (user_id = auth.uid() and (store_id is null or exists (select 1 from public.shop_stores s where s.id = after_sales_tasks.store_id and s.user_id = auth.uid())));
create policy after_sales_tasks_update_own on public.after_sales_tasks for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and (store_id is null or exists (select 1 from public.shop_stores s where s.id = after_sales_tasks.store_id and s.user_id = auth.uid())));
\i supabase/v6_27_remove_device.sql
-- ---------- data ----------
-- A = owner, B = another user, M = admin
insert into auth.users(id, email, phone, last_sign_in_at) values
 ('00000000-0000-0000-0000-0000000000aa', 'Owner@Example.com', null, now() - interval '4 day'),
 ('00000000-0000-0000-0000-0000000000bb', null, '8613800138000', now() - interval '1 day'),
 ('00000000-0000-0000-0000-0000000000cc', 'admin@example.com', null, now());
insert into public.admin_users(user_id) values ('00000000-0000-0000-0000-0000000000cc');
-- A: S1 current (device A), S2 (device B), S5 (device E, legit), S3 unmapped. B: S9. M: S8
insert into auth.sessions(id, user_id, created_at, updated_at) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa', now() - interval '2 hour', now() - interval '1 minute'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000aa', now() - interval '1 hour', now()),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000aa', now() - interval '3 hour', now()),
 ('10000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000aa', now() - interval '3 hour', now()),
 ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000bb', now() - interval '1 hour', now() - interval '30 minute'),
 ('10000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000cc', now() - interval '1 hour', now());
insert into auth.refresh_tokens(session_id, token) values ('10000000-0000-0000-0000-000000000003','rt3'), ('10000000-0000-0000-0000-000000000009','rt9');
insert into public.security_devices(id, user_id, device_id, platform, device_name, status, last_seen) values
 ('20000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000aa','WEB-devA-xxxxxxxx','ios','iPhone · 微信','active', now() - interval '10 minute'),
 ('20000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000aa','WEB-devB-xxxxxxxx','windows','Windows · Chrome','active', now() - interval '2 hour'),
 ('20000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000aa','WEB-devE-xxxxxxxx','android','Android · Edge','active', now() - interval '3 hour'),
 ('20000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000bb','WEB-devC-xxxxxxxx','android',null,'active', now() - interval '5 hour');
insert into public.shop_stores(user_id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb'); -- ids 1 (A), 2 (B)
insert into public.after_sales_tasks(user_id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb');
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
create or replace function pg_temp.as_session(uid text, sid text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', case when sid is null then json_build_object('sub', uid) else json_build_object('sub', uid, 'session_id', sid) end::text, false); end $$;
-- ---------- before v6_33: the store check is bypassed (documents the bug) ----------
set role authenticated;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
do $$ begin insert into public.after_sales_tasks(user_id, store_id) values (auth.uid(), 2); insert into r values ('BEFORE: task under another user''s store was allowed (bug reproduced)', true, null); exception when insufficient_privilege then insert into r values ('BEFORE: task under another user''s store was allowed (bug reproduced)', false, 'already blocked?'); end $$;
reset role;
delete from public.after_sales_tasks where store_id = 2;
-- ---------- install v6_33 (both segments) ----------
\i supabase/v6_33_security_batch2.sql
\i supabase/v6_33_security_batch2.sql
insert into r values ('v6_33 runs twice without error', true, null);
-- ---------- privileges ----------
insert into r select 'take_quota / auth_identity_taken: service_role only', bool_and(has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), null from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('take_quota', 'auth_identity_taken');
insert into r select 'user functions: authenticated yes, anon no', bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')) and count(*) = 4, null from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('revoke_other_sessions', 'admin_revoke_user_sessions', 'admin_user_activity', 'remove_my_device');
insert into r select 'quota_counters not readable by clients', not has_table_privilege('authenticated', 'public.quota_counters', 'select') and not has_table_privilege('anon', 'public.quota_counters', 'select'), null;
-- ---------- take_quota ----------
set role service_role;
insert into r select 'quota: 1st and 2nd allowed, 3rd refused', public.take_quota('00000000-0000-0000-0000-0000000000aa', 'kd', 2, 60) and public.take_quota('00000000-0000-0000-0000-0000000000aa', 'kd', 2, 60) and not public.take_quota('00000000-0000-0000-0000-0000000000aa', 'kd', 2, 60), null;
insert into r select 'quota: per user (B unaffected)', public.take_quota('00000000-0000-0000-0000-0000000000bb', 'kd', 2, 60), null;
insert into r select 'quota: bad arguments refused', not public.take_quota(null, 'kd', 2, 60) and not public.take_quota('00000000-0000-0000-0000-0000000000aa', '', 2, 60) and not public.take_quota('00000000-0000-0000-0000-0000000000aa', 'x', 0, 60), null;
reset role;
update public.quota_counters set window_start = now() - interval '2 minute' where bucket = 'kd';
set role service_role;
insert into r select 'quota: new window resets', public.take_quota('00000000-0000-0000-0000-0000000000aa', 'kd', 2, 60), null;
-- ---------- auth_identity_taken ----------
insert into r select 'identity: email taken (case-insensitive)', public.auth_identity_taken('00000000-0000-0000-0000-0000000000bb', 'email', ' owner@EXAMPLE.com '), null;
insert into r select 'identity: own email is not "taken"', not public.auth_identity_taken('00000000-0000-0000-0000-0000000000aa', 'email', 'owner@example.com'), null;
insert into r select 'identity: phone taken (with +)', public.auth_identity_taken('00000000-0000-0000-0000-0000000000aa', 'phone', '+8613800138000'), null;
insert into r select 'identity: free phone', not public.auth_identity_taken('00000000-0000-0000-0000-0000000000aa', 'phone', '+8613900139000'), null;
reset role;
-- ---------- admin_user_activity ----------
set role authenticated;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
do $$ begin perform public.admin_user_activity(); insert into r values ('activity: non-admin refused', false, null); exception when others then insert into r values ('activity: non-admin refused', sqlerrm like '%没有管理员权限%', sqlerrm); end $$;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000cc','10000000-0000-0000-0000-000000000008') \g /dev/null
insert into r select 'activity: A last_active is recent although last_sign_in_at is 4 days old', a.last_active > now() - interval '5 minute' and a.last_device = 'iPhone · 微信', a::text from public.admin_user_activity() a where a.user_id = '00000000-0000-0000-0000-0000000000aa';
insert into r select 'activity: B = latest of sign-in / device / session (session 30 min ago)', a.last_active between now() - interval '31 minute' and now() - interval '29 minute', a::text from public.admin_user_activity() a where a.user_id = '00000000-0000-0000-0000-0000000000bb';
insert into r select 'activity: one row per user', count(*) = 3, null from public.admin_user_activity();
-- ---------- remove_my_device: unreported sessions are revoked too ----------
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000002') \g /dev/null
select public.my_session_status('WEB-devB-xxxxxxxx') \g /dev/null
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000005') \g /dev/null
select public.my_session_status('WEB-devE-xxxxxxxx') \g /dev/null
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
select public.my_session_status('WEB-devA-xxxxxxxx') \g /dev/null
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000003') \g /dev/null
insert into r select 'S3 (unreported) can read before removal', (select count(*) from public.after_sales_tasks) = 1, null;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
insert into r select 'remove device B: 1 reported + 1 unreported session', (x->>'ok')::boolean and (x->>'sessions')::int = 1 and (x->>'unknown_sessions')::int = 1, x::text from (select public.remove_my_device('20000000-0000-0000-0000-00000000000b','WEB-devA-xxxxxxxx') x) q;
insert into r select 'owner S1 still works', (select count(*) from public.after_sales_tasks) = 1, null;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000003') \g /dev/null
insert into r select 'S3 reads nothing right away (no need to wait for it to report)', (select count(*) from public.after_sales_tasks) = 0, null;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000005') \g /dev/null
insert into r select 'legit device E (reported) untouched', (select count(*) from public.after_sales_tasks) = 1, null;
reset role;
insert into r select 'S2 + S3 deleted server-side, S1/S5/B/M kept', (select string_agg(right(id::text, 1), '' order by id) from auth.sessions) = '1589', (select string_agg(right(id::text, 1), '' order by id) from auth.sessions);
insert into r select 'remove log mentions the unknown session', exists (select 1 from public.admin_operation_logs where action = 'remove_device' and detail like '%强制退出 1 个登录，另有 1 个未识别的登录一并退出%'), (select string_agg(detail, ' | ') from public.admin_operation_logs);
-- ---------- revoke_other_sessions ----------
set role authenticated;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa', null) \g /dev/null
insert into r select 'logout others: refused without a session id', (x->>'ok')::boolean = false, x::text from (select public.revoke_other_sessions() x) q;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
insert into r select 'logout others: 1 other session (S5)', (x->>'ok')::boolean and (x->>'sessions')::int = 1, x::text from (select public.revoke_other_sessions() x) q;
insert into r select 'logout others: current S1 still works', (select count(*) from public.after_sales_tasks) = 1, null;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000005') \g /dev/null
insert into r select 'logout others: S5 token reads nothing', (select count(*) from public.after_sales_tasks) = 0, null;
insert into r select 'logout others: revoked S5 cannot call it again', (x->>'ok')::boolean = false, x::text from (select public.revoke_other_sessions() x) q;
reset role;
insert into r select 'logout others: only A''s S1 left for A; B and M untouched', (select string_agg(right(id::text, 1), '' order by id) from auth.sessions) = '189', (select string_agg(right(id::text, 1), '' order by id) from auth.sessions);
insert into r select 'logout others: logged', exists (select 1 from public.admin_operation_logs where action = 'logout_others' and detail like '%1 个登录%'), null;
-- ---------- admin_revoke_user_sessions ----------
set role authenticated;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
do $$ begin perform public.admin_revoke_user_sessions('00000000-0000-0000-0000-0000000000bb'); insert into r values ('admin logout: non-admin refused', false, null); exception when others then insert into r values ('admin logout: non-admin refused', sqlerrm like '%没有管理员权限%', sqlerrm); end $$;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000cc','10000000-0000-0000-0000-000000000008') \g /dev/null
insert into r select 'admin logout: not on self', (x->>'ok')::boolean = false, x::text from (select public.admin_revoke_user_sessions('00000000-0000-0000-0000-0000000000cc') x) q;
insert into r select 'admin logout: unknown user', (x->>'ok')::boolean = false, x::text from (select public.admin_revoke_user_sessions('00000000-0000-0000-0000-0000000000dd') x) q;
insert into r select 'admin logout: B''s 1 session', (x->>'ok')::boolean and (x->>'sessions')::int = 1, x::text from (select public.admin_revoke_user_sessions('00000000-0000-0000-0000-0000000000bb') x) q;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000bb','10000000-0000-0000-0000-000000000009') \g /dev/null
insert into r select 'admin logout: B''s old token reads nothing', (select count(*) from public.after_sales_tasks) = 0, null;
reset role;
insert into r select 'admin logout: B session + refresh token deleted, A/M kept', (select string_agg(right(id::text, 1), '' order by id) from auth.sessions) = '18' and not exists (select 1 from auth.refresh_tokens where token = 'rt9'), null;
insert into r select 'admin logout: logged by the admin', exists (select 1 from public.admin_operation_logs where user_id = '00000000-0000-0000-0000-0000000000cc' and action = 'admin_logout_user' and detail like '%8613800138000%1 个登录%'), (select string_agg(detail, ' | ') from public.admin_operation_logs where action = 'admin_logout_user');
-- ---------- segment 2: policies / store ownership / indexes / bucket ----------
insert into r select 'admin_users: only the self-read policy left', (select string_agg(policyname, ',') from pg_policies where tablename = 'admin_users') = 'admin_users_self_read', (select string_agg(policyname, ',') from pg_policies where tablename = 'admin_users');
insert into r select 'one permissive owner policy per business table', (select count(*) from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and tablename in ('after_sales_events','after_sales_tasks','evidence_files','evidence_library','shop_stores','tracking_records')) = 6, null;
insert into r select 'owner policies use (select auth.uid())', bool_and(qual like '%SELECT auth.uid()%'), string_agg(qual, ' | ') from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and tablename in ('after_sales_events','after_sales_tasks','evidence_files','evidence_library','shop_stores','tracking_records','admin_users');
insert into r select 'duplicate indexes gone, the constraint index kept', not exists (select 1 from pg_indexes where indexname in ('idx_admin_users_user_id_unique','idx_after_sales_tasks_user_id','tasks_store_idx')) and exists (select 1 from pg_indexes where indexname = 'admin_users_user_id_unique') and exists (select 1 from pg_indexes where indexname = 'tasks_user_idx') and exists (select 1 from pg_indexes where indexname = 'idx_tasks_store'), null;
insert into r select 'bucket: 200MB + 14 types', file_size_limit = 209715200 and array_length(allowed_mime_types, 1) = 14 and 'video/*' = any(allowed_mime_types) and not ('image/svg+xml' = any(allowed_mime_types)), null from storage.buckets where id = 'after-sales-evidence';
set role authenticated;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
do $$ begin insert into public.after_sales_tasks(user_id, store_id) values (auth.uid(), 2); insert into r values ('store: task under another user''s store refused', false, 'insert went through'); exception when insufficient_privilege then insert into r values ('store: task under another user''s store refused', true, null); end $$;
insert into public.after_sales_tasks(user_id, store_id) values ('00000000-0000-0000-0000-0000000000aa', 1);
insert into public.after_sales_tasks(user_id, store_id) values ('00000000-0000-0000-0000-0000000000aa', null);
insert into r select 'store: own store and no store allowed', (select count(*) from public.after_sales_tasks) = 3, null;
do $$ begin update public.after_sales_tasks set store_id = 2 where store_id = 1; insert into r values ('store: moving a task to another user''s store refused', false, 'update went through'); exception when insufficient_privilege then insert into r values ('store: moving a task to another user''s store refused', true, null); end $$;
update public.after_sales_tasks set store_id = null where store_id = 1;
insert into r select 'store: normal edits still work', (select count(*) from public.after_sales_tasks where store_id is null) = 3, null;
insert into r select 'admin_users: user cannot make themselves admin', not exists (select 1 from public.admin_users where user_id = auth.uid()), null;
do $$ begin insert into public.admin_users(user_id) values (auth.uid()); insert into r values ('admin_users: insert refused', false, null); exception when insufficient_privilege then insert into r values ('admin_users: insert refused', true, null); end $$;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000cc','10000000-0000-0000-0000-000000000008') \g /dev/null
insert into r select 'admin_users: admin can still read own row (is admin check)', (select count(*) from public.admin_users) = 1, null;
reset role;
\set QUIET 0
select case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
