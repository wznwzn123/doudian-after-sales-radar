-- Scenario test for supabase/v6_42_qq_bot_chime_1s.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
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
\i supabase/v6_41_qq_bot_chime_seconds.sql
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
create temp table tok(t text);
grant all on tok to authenticated, anon, service_role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into tok select public.admin_qqbot_new_token() ->> 'token';
select public.admin_qqbot_save_settings('{"enabled":true,"groups":["123456789"],"cooldown_sec":60}') \g /dev/null
-- the owner's production settings before v6_42: chime off, 30%, 30 s
select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"Claude","ai_daily_limit":200,"ai_group_daily_limit":50,"ai_chime":false,"ai_chime_rate":30,"ai_chime_gap_sec":30}') \g /dev/null
insert into r select 'before v6_42: 1 second refused', (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"Claude","ai_daily_limit":200,"ai_group_daily_limit":50,"ai_chime":true,"ai_chime_rate":30,"ai_chime_gap_sec":1}') ->> 'ok')::boolean = false, null;
reset role;
\i supabase/v6_42_qq_bot_chime_1s.sql
\i supabase/v6_42_qq_bot_chime_1s.sql
insert into r values ('v6_42 runs twice without error', true, null);
insert into r select 'existing settings kept (off, 30%, 30 s)', (select not ai_chime and ai_chime_rate = 30 and ai_chime_gap_sec = 30 from public.qqbot_settings), null;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false) \g /dev/null
do $$ begin perform public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"x","ai_daily_limit":1,"ai_group_daily_limit":1,"ai_chime":true,"ai_chime_gap_sec":1}'); insert into r values ('normal user: save_ai refused', false, null); exception when raise_exception then insert into r values ('normal user: save_ai refused', true, null); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
create temp table bad as select k, (public.admin_qqbot_save_ai(('{"ai_enabled":true,"ai_name":"Claude","ai_daily_limit":200,"ai_group_daily_limit":50,"ai_chime":true,' || k || '}')::jsonb) ->> 'ok')::boolean as ok from unnest(array[
  '"ai_chime_rate":30,"ai_chime_gap_sec":0', '"ai_chime_rate":30,"ai_chime_gap_sec":7201', '"ai_chime_rate":30,"ai_chime_gap_sec":"1; drop"', '"ai_chime_rate":101,"ai_chime_gap_sec":1']) k;
create temp table s1 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"Claude","ai_daily_limit":200,"ai_group_daily_limit":50,"ai_chime":true,"ai_chime_rate":30,"ai_chime_gap_sec":1}') j;
reset role;
insert into r select 'save_ai: 0 s, 7201 s, non-numeric and 101% still refused', (select bool_and(not ok) from bad), (select string_agg(k, ' | ') from bad where ok);
insert into r select 'save_ai: 1 second saved, minutes synced to 1, logged', (select (j ->> 'ok')::boolean from s1) and (select ai_chime and ai_chime_gap_sec = 1 and ai_chime_gap = 1 from public.qqbot_settings) and exists (select 1 from public.admin_operation_logs where action = 'qqbot_ai' and detail like '%间隔 1 秒%'), (select j::text from s1);
set role anon;
insert into r select 'pull: chime on, chime_gap_sec = 1', (select (j -> 'ai' ->> 'chime')::boolean and (j -> 'ai' ->> 'chime_gap_sec')::int = 1 from (select public.qqbot_pull((select t from tok)) j) x), null;
reset role;
do $$ begin update public.qqbot_settings set ai_chime_gap_sec = 0; insert into r values ('table check: 0 seconds rejected', false, null); exception when check_violation then insert into r values ('table check: 0 seconds rejected', true, null); end $$;
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || coalesce('  -- ' || detail, '') as result from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
