-- Scenario test for supabase/v6_39_qq_bot_ai.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
-- NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
-- ---------- prelude: v6_27 + admin tables + v6_38 ----------
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter role service_role bypassrls;
\i supabase/v6_27_remove_device.sql
create table public.admin_users(user_id uuid primary key, is_super boolean not null default false);
create function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists (select 1 from public.admin_users where user_id = auth.uid() and is_super) $f$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000aa', 'owner@x.com'), ('00000000-0000-0000-0000-0000000000cc', 'user@x.com');
insert into public.admin_users values ('00000000-0000-0000-0000-0000000000aa', true);
\i supabase/v6_38_qq_bot.sql
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
create temp table tok(t text);
grant all on tok to authenticated, anon, service_role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into tok select public.admin_qqbot_new_token() ->> 'token';
select public.admin_qqbot_save_faq('{"keywords":["注册"],"answer":"点注册"}') \g /dev/null
select public.admin_qqbot_save_faq('{"keywords":["停用"],"answer":"不该给 AI","enabled":false}') \g /dev/null
select public.admin_qqbot_save_settings('{"enabled":true,"groups":["123456789","88888"],"cooldown_sec":60}') \g /dev/null
reset role;
-- ---------- install (twice) ----------
\i supabase/v6_39_qq_bot_ai.sql
\i supabase/v6_39_qq_bot_ai.sql
insert into r values ('v6_39 runs twice without error', true, null);
insert into r select 'AI off by default, name 小雷, limits 200 / 50', (select not ai_enabled and ai_name = '小雷' and ai_daily_limit = 200 and ai_group_daily_limit = 50 from public.qqbot_settings), null;

-- ---------- who can call what ----------
set role anon;
do $$ begin perform public.qqbot_ai_claim((select t from tok), '88888'); insert into r values ('anon cannot call qqbot_ai_claim', false, null); exception when insufficient_privilege then insert into r values ('anon cannot call qqbot_ai_claim', true, null); end $$;
do $$ begin perform public.qqbot_ai_usage_add('88888', 1, 1); insert into r values ('anon cannot call qqbot_ai_usage_add', false, null); exception when insufficient_privilege then insert into r values ('anon cannot call qqbot_ai_usage_add', true, null); end $$;
do $$ begin perform public.admin_qqbot_ai_get(); insert into r values ('anon cannot call admin_qqbot_ai_get', false, null); exception when insufficient_privilege then insert into r values ('anon cannot call admin_qqbot_ai_get', true, null); end $$;
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false) \g /dev/null
do $$ begin perform public.qqbot_ai_claim((select t from tok), '88888'); insert into r values ('logged-in user cannot call qqbot_ai_claim', false, null); exception when insufficient_privilege then insert into r values ('logged-in user cannot call qqbot_ai_claim', true, null); end $$;
do $$ begin perform public.admin_qqbot_ai_get(); insert into r values ('normal user: admin_qqbot_ai_get refused', false, null); exception when raise_exception then insert into r values ('normal user: admin_qqbot_ai_get refused', true, null); end $$;
do $$ begin perform public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"x","ai_daily_limit":1,"ai_group_daily_limit":1}'); insert into r values ('normal user: admin_qqbot_save_ai refused', false, null); exception when raise_exception then insert into r values ('normal user: admin_qqbot_save_ai refused', true, null); end $$;
reset role;

-- ---------- claim while AI is off ----------
set role service_role;
insert into r select 'claim: AI off -> off, nothing counted', (public.qqbot_ai_claim((select t from tok), '88888') ->> 'code') = 'off', null;
reset role;
insert into r select 'claim: nothing counted while off', (select count(*) from public.qqbot_ai_usage) = 0, null;

-- ---------- admin saves AI settings ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
insert into r select 'save_ai: empty name refused', (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":" ","ai_daily_limit":10,"ai_group_daily_limit":2}') ->> 'ok')::boolean = false, null;
insert into r select 'save_ai: style > 500 chars refused', (public.admin_qqbot_save_ai(jsonb_build_object('ai_enabled', true, 'ai_name', '小雷', 'ai_style', repeat('字', 501), 'ai_daily_limit', 10, 'ai_group_daily_limit', 2)) ->> 'ok')::boolean = false, null;
insert into r select 'save_ai: bad limits refused', (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":"10; drop","ai_group_daily_limit":2}') ->> 'ok')::boolean = false and (public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":"小雷","ai_daily_limit":6000,"ai_group_daily_limit":2}') ->> 'ok')::boolean = false, null;
create temp table s1 as select public.admin_qqbot_save_ai('{"ai_enabled":true,"ai_name":" 小雷 ","ai_style":"说话温柔一点","ai_daily_limit":3,"ai_group_daily_limit":2}') j;
reset role;
insert into r select 'save_ai: saved (trimmed) and logged', (select (j ->> 'ok')::boolean from s1) and (select ai_enabled and ai_name = '小雷' and ai_style = '说话温柔一点' and ai_daily_limit = 3 and ai_group_daily_limit = 2 from public.qqbot_settings) and exists (select 1 from public.admin_operation_logs where action = 'qqbot_ai'), null;

-- ---------- claims ----------
set role service_role;
insert into r select 'claim: wrong token -> bad_token', (public.qqbot_ai_claim(repeat('0', 64), '88888') ->> 'code') = 'bad_token', null;
insert into r select 'claim: group not in settings -> group', (public.qqbot_ai_claim((select t from tok), '99999') ->> 'code') = 'group' and (public.qqbot_ai_claim((select t from tok), '88888 or 1=1') ->> 'code') = 'group', null;
create temp table c1 as select public.qqbot_ai_claim((select t from tok), ' 88888 ') j;
reset role;
insert into r select 'claim: ok with name, style and only enabled FAQs', (select (j ->> 'ok')::boolean and j ->> 'name' = '小雷' and j ->> 'style' = '说话温柔一点' and jsonb_array_length(j -> 'faqs') = 1 and j -> 'faqs' -> 0 ->> 'answer' = '点注册' and not (j::text like '%token%') from c1), (select j::text from c1);
set role service_role;
select public.qqbot_ai_usage_add('88888', 1200, 80) \g /dev/null
select public.qqbot_ai_claim((select t from tok), '88888') \g /dev/null
insert into r select 'claim: per-group daily limit (2) reached -> limit', (public.qqbot_ai_claim((select t from tok), '88888') ->> 'code') = 'limit', null;
select public.qqbot_ai_claim((select t from tok), '123456789') \g /dev/null
insert into r select 'claim: site-wide daily limit (3) reached -> limit for every group', (public.qqbot_ai_claim((select t from tok), '123456789') ->> 'code') = 'limit', null;
reset role;
insert into r select 'usage: counts per day + group, tokens added, refused claims not counted', (select sum(calls) from public.qqbot_ai_usage) = 3 and (select calls from public.qqbot_ai_usage where group_id = '88888') = 2 and (select input_tokens = 1200 and output_tokens = 80 from public.qqbot_ai_usage where group_id = '88888'), (select string_agg(group_id || ':' || calls, ',') from public.qqbot_ai_usage);
insert into r select 'usage table stores only day, group, counts', (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'qqbot_ai_usage') = 'day,group_id,calls,input_tokens,output_tokens', null;
-- yesterday does not count against today; very old rows are removed
insert into public.qqbot_ai_usage(day, group_id, calls) values ((now() at time zone 'Asia/Shanghai')::date - 1, '77777', 999), ((now() at time zone 'Asia/Shanghai')::date - 500, '77777', 5);
update public.qqbot_settings set ai_daily_limit = 10;
set role service_role;
insert into r select 'claim: yesterday''s usage does not count; rows > 400 days old removed', (public.qqbot_ai_claim((select t from tok), '123456789') ->> 'ok')::boolean, null;
reset role;
insert into r select 'old usage rows removed', not exists (select 1 from public.qqbot_ai_usage where day < (now() at time zone 'Asia/Shanghai')::date - 400), null;

-- ---------- admin view ----------
set role authenticated;
create temp table g1 as select public.admin_qqbot_ai_get() j;
reset role;
insert into r select 'admin_qqbot_ai_get: settings + today / 30 days usage + per group', (select j ->> 'ai_name' = '小雷' and (j -> 'today' ->> 'calls')::int = 4 and (j -> 'today' ->> 'input_tokens')::int = 1200 and (j -> 'd30' ->> 'calls')::int = 4 + 999 and jsonb_array_length(j -> 'groups_today') = 2 from g1), (select j::text from g1);
-- turning the bot off also stops AI
update public.qqbot_settings set enabled = false;
set role service_role;
insert into r select 'claim: whole bot paused -> off', (public.qqbot_ai_claim((select t from tok), '123456789') ->> 'code') = 'off', null;
reset role;

-- ---------- report ----------
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || coalesce('  -- ' || detail, '') as result from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
