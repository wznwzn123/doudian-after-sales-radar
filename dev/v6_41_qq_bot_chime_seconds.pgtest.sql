-- Scenario test for supabase/v6_41_qq_bot_chime_seconds.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
-- NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter role service_role bypassrls;
\i supabase/v6_27_remove_device.sql
create table public.admin_users(user_id uuid primary key, is_super boolean not null default false);
create function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists (select 1 from public.admin_users where user_id = auth.uid() and is_super) $f$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000aa', 'owner@x.com'), ('00000000-0000-0000-0000-0000000000cc', 'user@x.com');
insert into public.admin_users values ('00000000-0000-0000-0000-0000000000aa', true);
\i supabase/v6_38_qq_bot.sql
\i supabase/v6_39_qq_bot_ai.sql
\i supabase/v6_40_qq_bot_chime.sql
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
create temp table tok(t text);
grant all on tok to authenticated, anon, service_role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into tok select public.admin_qqbot_new_token() ->> 'token';
select public.admin_qqbot_save_settings('{"enabled":true,"groups":["123456789"],"cooldown_sec":60}') \g /dev/null
-- before v6_41: chime on, 15%, 3 minutes (the v6_40 way)
select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":15,"ai_chime_gap":3}') \g /dev/null
reset role;
\i supabase/v6_41_qq_bot_chime_seconds.sql
\i supabase/v6_41_qq_bot_chime_seconds.sql
insert into r values ('v6_41 runs twice without error', true, null);
insert into r select 'existing 3 minutes became 180 seconds; rate and switch kept', (select ai_chime and ai_chime_rate = 15 and ai_chime_gap = 3 and ai_chime_gap_sec = 180 from public.qqbot_settings), null;
set role anon;
create temp table p1 as select public.qqbot_pull((select t from tok)) j;
insert into r select 'pull: ai has chime_gap_sec and still the old chime_gap (old scripts)', (select j -> 'ai' = '{"enabled": true, "chime": true, "chime_rate": 15, "chime_gap": 3, "chime_gap_sec": 180}'::jsonb from p1), (select (j -> 'ai')::text from p1);
insert into r select 'pull: wrong token still gets nothing', (public.qqbot_pull(repeat('0', 64)) ->> 'ok')::boolean = false and not (public.qqbot_pull(repeat('0', 64)) ? 'ai'), null;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false) \g /dev/null
do $$ begin perform public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"x","ai_daily_limit":1,"ai_group_daily_limit":1,"ai_chime":true,"ai_chime_gap_sec":10}'); insert into r values ('normal user: save_ai refused', false, null); exception when raise_exception then insert into r values ('normal user: save_ai refused', true, null); end $$;
do $$ begin perform public.admin_qqbot_ai_get(); insert into r values ('normal user: ai_get refused', false, null); exception when raise_exception then insert into r values ('normal user: ai_get refused', true, null); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
create temp table bad as select k, (public.admin_qqbot_save_ai(('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,' || k || '}')::jsonb) ->> 'ok')::boolean as ok from unnest(array[
  '"ai_chime_rate":10,"ai_chime_gap_sec":9', '"ai_chime_rate":10,"ai_chime_gap_sec":7201', '"ai_chime_rate":10,"ai_chime_gap_sec":"20; drop"', '"ai_chime_rate":10,"ai_chime_gap_sec":-5',
  '"ai_chime_rate":101,"ai_chime_gap_sec":20', '"ai_chime_rate":0,"ai_chime_gap_sec":20', '"ai_chime_rate":"5x","ai_chime_gap_sec":20', '"ai_chime_rate":10,"ai_chime_gap":0', '"ai_chime_rate":10,"ai_chime_gap":121']) k;
reset role;
insert into r select 'save_ai: out-of-range / non-numeric seconds and rate refused, nothing changed', (select bool_and(not ok) from bad) and (select ai_chime_rate = 15 and ai_chime_gap_sec = 180 from public.qqbot_settings), (select string_agg(k, ' | ') from bad where ok);
set role authenticated;
create temp table s1 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":100,"ai_chime_gap_sec":20}') j;
reset role;
insert into r select 'save_ai: 100% and 20 seconds saved, minutes synced to 1, logged in seconds', (select (j ->> 'ok')::boolean from s1) and (select ai_chime and ai_chime_rate = 100 and ai_chime_gap_sec = 20 and ai_chime_gap = 1 from public.qqbot_settings) and exists (select 1 from public.admin_operation_logs where action = 'qqbot_ai' and detail like '%主动接话 100%、间隔 20 秒%'), (select j::text from s1);
set role authenticated;
create temp table s2 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":30,"ai_chime_gap":2}') j;
reset role;
insert into r select 'save_ai: older page sending minutes still works (2 min -> 120 s)', (select (j ->> 'ok')::boolean from s2) and (select ai_chime_rate = 30 and ai_chime_gap_sec = 120 and ai_chime_gap = 2 from public.qqbot_settings), null;
set role authenticated;
create temp table s3 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"阿雷","ai_daily_limit":10,"ai_group_daily_limit":5}') j;
create temp table g1 as select public.admin_qqbot_ai_get() j;
reset role;
insert into r select 'save_ai without chime keys keeps chime, rate and seconds', (select (j ->> 'ok')::boolean from s3) and (select ai_chime and ai_chime_rate = 30 and ai_chime_gap_sec = 120 and ai_name = '阿雷' from public.qqbot_settings), null;
insert into r select 'admin_qqbot_ai_get returns ai_chime_gap_sec', (select (j ->> 'ai_chime_gap_sec')::int = 120 and (j ->> 'ai_chime_rate')::int = 30 and j ? 'today' from g1), (select j::text from g1);
do $$ begin update public.qqbot_settings set ai_chime_gap_sec = 5; insert into r values ('table check: seconds below 10 rejected', false, null); exception when check_violation then insert into r values ('table check: seconds below 10 rejected', true, null); end $$;
do $$ begin update public.qqbot_settings set ai_chime_rate = 101; insert into r values ('table check: rate above 100 rejected', false, null); exception when check_violation then insert into r values ('table check: rate above 100 rejected', true, null); end $$;
insert into r select 'anon / authenticated cannot read or write the settings table directly', not has_table_privilege('anon', 'public.qqbot_settings', 'select') and not has_table_privilege('authenticated', 'public.qqbot_settings', 'update'), null;
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || coalesce('  -- ' || detail, '') as result from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
