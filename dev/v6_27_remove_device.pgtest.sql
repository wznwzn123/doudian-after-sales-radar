-- Scenario test for supabase/v6_27_remove_device.sql on a LOCAL PostgreSQL with a minimal Supabase-like mock
-- (auth.users / auth.sessions / auth.refresh_tokens, auth.uid() / auth.jwt() from GUCs, roles anon/authenticated).
-- NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users(id) values ('00000000-0000-0000-0000-0000000000aa'), ('00000000-0000-0000-0000-0000000000bb');
-- owner U: device A (session S1). Attacker on device B: session S2 (reported) and S3 (older, never reported). Other user V has device C.
insert into auth.sessions(id, user_id, created_at) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa', now() - interval '2 hour'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000aa', now() - interval '1 hour'),
 ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000aa', now() - interval '3 hour'),
 ('10000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-0000000000bb', now() - interval '1 hour');
insert into auth.refresh_tokens(session_id, token) values ('10000000-0000-0000-0000-000000000002','rt2'), ('10000000-0000-0000-0000-000000000003','rt3');
insert into public.security_devices(id, user_id, device_id, platform, device_name, status) values
 ('20000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000aa','WEB-devA-xxxxxxxx','web','iPhone · Safari','active'),
 ('20000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000aa','WEB-devB-xxxxxxxx','web','Windows · Chrome','active'),
 ('20000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000aa','WEB-devD-xxxxxxxx','web','Android · Edge','blocked'),
 ('20000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000bb','WEB-devC-xxxxxxxx','web','Mac · Safari','active');
insert into public.after_sales_tasks(user_id) values ('00000000-0000-0000-0000-0000000000aa');
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon;
create or replace function pg_temp.as_session(uid text, sid text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'session_id', sid)::text, false); end $$;

set role authenticated;
-- attacker (S2 on device B) opens the app: session <-> device recorded
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000002') \g /dev/null
insert into r select 'S2 not revoked at first', (public.my_session_status('WEB-devB-xxxxxxxx')->>'revoked')::boolean = false, null;
insert into r select 'S2 can read tasks before removal', (select count(*) from public.after_sales_tasks) = 1, null;
-- owner (S1 on device A)
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000001') \g /dev/null
insert into r select 'S1 mapping', (public.my_session_status('WEB-devA-xxxxxxxx')->>'revoked')::boolean = false, null;
insert into r select 'login records return ids', (select bool_and(x ? 'id') from jsonb_array_elements(public.my_login_alerts('WEB-devA-xxxxxxxx')->'devices') x), null;
insert into r select 'cannot remove the device in use', (public.remove_my_device('20000000-0000-0000-0000-00000000000a','WEB-devA-xxxxxxxx')->>'ok')::boolean = false, null;
insert into r select 'cannot remove another account''s device', (public.remove_my_device('20000000-0000-0000-0000-00000000000c','WEB-devA-xxxxxxxx')->>'ok')::boolean = false, null;
insert into r select 'remove device B', (x->>'ok')::boolean and (x->>'sessions')::int = 1, x::text from (select public.remove_my_device('20000000-0000-0000-0000-00000000000b','WEB-devA-xxxxxxxx') x) q;
insert into r select 'owner still works', (select count(*) from public.after_sales_tasks) = 1 and (public.my_session_status('WEB-devA-xxxxxxxx')->>'revoked')::boolean = false, null;
insert into r select 'blocked device D: removed but row kept', (x->>'ok')::boolean and (x->>'kept_blocked')::boolean, x::text from (select public.remove_my_device('20000000-0000-0000-0000-00000000000d','WEB-devA-xxxxxxxx') x) q;
-- attacker S2 with its still-valid access token
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000002') \g /dev/null
insert into r select 'S2 reads nothing (RLS)', (select count(*) from public.after_sales_tasks) = 0, null;
do $$ begin insert into public.after_sales_tasks(user_id) values (auth.uid()); insert into r values ('S2 cannot write (RLS)', false, 'insert went through'); exception when insufficient_privilege then insert into r values ('S2 cannot write (RLS)', true, null); end $$;
do $$ begin insert into storage.objects(bucket_id, name, owner) values ('after-sales-evidence', 'x', auth.uid()); insert into r values ('S2 cannot upload evidence', false, null); exception when insufficient_privilege then insert into r values ('S2 cannot upload evidence', true, null); end $$;
insert into r select 'S2 told it is revoked', (public.my_session_status('WEB-devB-xxxxxxxx')->>'revoked')::boolean, null;
insert into r select 'S2 cannot remove the owner''s device', (public.remove_my_device('20000000-0000-0000-0000-00000000000a','WEB-devB-xxxxxxxx')->>'ok')::boolean = false, null;
-- S3: older session on device B that never reported -> revoked the first time it reports
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000003') \g /dev/null
insert into r select 'S3 (older, unreported) can still read until it reports', (select count(*) from public.after_sales_tasks) = 1, null;
insert into r select 'S3 revoked when it reports from device B', (public.my_session_status('WEB-devB-xxxxxxxx')->>'revoked')::boolean, null;
insert into r select 'S3 then reads nothing', (select count(*) from public.after_sales_tasks) = 0, null;
reset role;
insert into r select 'S2 + S3 sessions deleted server-side (refresh tokens gone)', not exists (select 1 from auth.sessions where id in ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003')) and not exists (select 1 from auth.refresh_tokens), null;
insert into r select 'S1 + other user''s session untouched', (select count(*) from auth.sessions) = 2, null;
insert into r select 'device B row deleted, A/C/D kept', (select count(*) from public.security_devices) = 3 and not exists (select 1 from public.security_devices where device_id = 'WEB-devB-xxxxxxxx'), (select string_agg(device_name, ',') from public.security_devices);
insert into r select 'logged (remove_device x2)', (select count(*) from public.admin_operation_logs where action = 'remove_device') = 2 and exists (select 1 from public.admin_operation_logs where detail like '%Windows · Chrome%强制退出 1 个登录%'), (select string_agg(detail, ' | ') from public.admin_operation_logs);
-- attacker logs in again with the password on device B -> new session, works again (and re-registers as a new device)
insert into auth.sessions(id, user_id, created_at) values ('10000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000aa', now() + interval '1 second');
set role authenticated;
select pg_temp.as_session('00000000-0000-0000-0000-0000000000aa','10000000-0000-0000-0000-000000000004') \g /dev/null
insert into r select 'fresh password login on device B is allowed', (public.my_session_status('WEB-devB-xxxxxxxx')->>'revoked')::boolean = false and (select count(*) from public.after_sales_tasks) = 1, null;
-- no session_id claim (e.g. old token) -> not revoked, no error
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa"}', false) \g /dev/null
insert into r select 'token without session_id: no error', (public.my_session_status('WEB-devA-xxxxxxxx')->>'ok')::boolean, null;
set role anon;
do $$ begin perform public.remove_my_device('20000000-0000-0000-0000-00000000000a',''); insert into r values ('anon cannot call remove_my_device', false, null); exception when insufficient_privilege then insert into r values ('anon cannot call remove_my_device', true, null); end $$;
reset role;
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || coalesce('  <- ' || detail, '') from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' from r;
