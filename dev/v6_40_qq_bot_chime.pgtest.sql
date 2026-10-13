-- Scenario test for supabase/v6_40_qq_bot_chime.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
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
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
create temp table tok(t text);
grant all on tok to authenticated, anon, service_role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into tok select public.admin_qqbot_new_token() ->> 'token';
select public.admin_qqbot_save_settings('{"enabled":true,"groups":["123456789"],"cooldown_sec":60}') \g /dev/null
select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5}') \g /dev/null
reset role;
\i supabase/v6_40_qq_bot_chime.sql
\i supabase/v6_40_qq_bot_chime.sql
insert into r values ('v6_40 runs twice without error', true, null);
insert into r select 'chime off by default, 10% / 5 min', (select not ai_chime and ai_chime_rate = 10 and ai_chime_gap = 5 from public.qqbot_settings), null;
set role anon;
create temp table p1 as select public.qqbot_pull((select t from tok)) j;
insert into r select 'pull: ai object (AI on, chime off) and the old fields kept', (select j -> 'ai' = '{"enabled": true, "chime": false, "chime_rate": 10, "chime_gap": 5}'::jsonb and (j ->> 'enabled')::boolean and j -> 'groups' = '["123456789"]'::jsonb and j ? 'faqs' from p1), (select j::text from p1);
insert into r select 'pull: wrong token still gets nothing', (public.qqbot_pull(repeat('0', 64)) ->> 'ok')::boolean = false and not (public.qqbot_pull(repeat('0', 64)) ? 'ai'), null;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false) \g /dev/null
do $$ begin perform public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"x","ai_daily_limit":1,"ai_group_daily_limit":1,"ai_chime":true}'); insert into r values ('normal user: save_ai refused', false, null); exception when raise_exception then insert into r values ('normal user: save_ai refused', true, null); end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into r select 'save_ai: chime rate out of range refused', (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":80,"ai_chime_gap":5}') ->> 'ok')::boolean = false and (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":"5; drop","ai_chime_gap":5}') ->> 'ok')::boolean = false, null;
insert into r select 'save_ai: chime gap out of range refused', (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":10,"ai_chime_gap":0}') ->> 'ok')::boolean = false, null;
create temp table s1 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":10,"ai_group_daily_limit":5,"ai_chime":true,"ai_chime_rate":15,"ai_chime_gap":3}') j;
reset role;
insert into r select 'save_ai: chime saved and logged', (select (j ->> 'ok')::boolean from s1) and (select ai_chime and ai_chime_rate = 15 and ai_chime_gap = 3 from public.qqbot_settings) and exists (select 1 from public.admin_operation_logs where action = 'qqbot_ai' and detail like '%主动接话 15%'), null;
set role authenticated;
create temp table s2 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"阿雷","ai_daily_limit":10,"ai_group_daily_limit":5}') j;
create temp table g1 as select public.admin_qqbot_ai_get() j;
reset role;
insert into r select 'save_ai without chime keys keeps the chime settings (older pages)', (select (j ->> 'ok')::boolean from s2) and (select ai_chime and ai_chime_rate = 15 and ai_chime_gap = 3 and ai_name = '阿雷' from public.qqbot_settings), null;
insert into r select 'admin_qqbot_ai_get returns chime settings', (select (j ->> 'ai_chime')::boolean and (j ->> 'ai_chime_rate')::int = 15 and (j ->> 'ai_chime_gap')::int = 3 and j ? 'today' from g1), (select j::text from g1);
set role anon;
insert into r select 'pull: chime on after saving', (public.qqbot_pull((select t from tok)) -> 'ai' ->> 'chime')::boolean, null;
reset role;
update public.qqbot_settings set enabled = false;
set role anon;
insert into r select 'pull: whole bot paused -> ai and chime off too', (select (j -> 'ai' ->> 'enabled')::boolean = false and (j -> 'ai' ->> 'chime')::boolean = false from (select public.qqbot_pull((select t from tok)) j) x), null;
reset role;
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || coalesce('  -- ' || detail, '') as result from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
