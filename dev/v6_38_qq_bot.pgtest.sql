-- Scenario test for supabase/v6_38_qq_bot.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
-- NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
-- ---------- prelude ----------
\i supabase/v6_27_remove_device.sql
create table public.admin_users(user_id uuid primary key, is_super boolean not null default false);
create function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists (select 1 from public.admin_users where user_id = auth.uid() and is_super) $f$;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000aa', 'owner@x.com'), ('00000000-0000-0000-0000-0000000000bb', 'admin2@x.com'), ('00000000-0000-0000-0000-0000000000cc', 'user@x.com');
insert into public.admin_users values ('00000000-0000-0000-0000-0000000000aa', true), ('00000000-0000-0000-0000-0000000000bb', false);
insert into public.revoked_sessions(session_id, user_id) values ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000bb');
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon;
create temp table tok(t text);
grant all on tok to authenticated, anon;
-- ---------- install (twice) ----------
\i supabase/v6_38_qq_bot.sql
\i supabase/v6_38_qq_bot.sql
insert into r values ('v6_38 runs twice without error', true, null);
insert into r select 'one settings row, off, no token', (select count(*) from public.qqbot_settings) = 1 and not (select enabled from public.qqbot_settings) and (select token_hash from public.qqbot_settings) is null, null;

-- ---------- anon: no tables, no admin functions, bot functions without a token give nothing ----------
set role anon;
do $$ begin perform 1 from public.qqbot_faq; insert into r values ('anon cannot read qqbot_faq', false, null); exception when insufficient_privilege then insert into r values ('anon cannot read qqbot_faq', true, null); end $$;
do $$ begin perform 1 from public.qqbot_settings; insert into r values ('anon cannot read qqbot_settings', false, null); exception when insufficient_privilege then insert into r values ('anon cannot read qqbot_settings', true, null); end $$;
do $$ begin perform public.admin_qqbot_overview(); insert into r values ('anon cannot call admin_qqbot_overview', false, null); exception when insufficient_privilege then insert into r values ('anon cannot call admin_qqbot_overview', true, null); end $$;
do $$ begin perform public.qqbot_token_ok('x'); insert into r values ('anon cannot call the token helper', false, null); exception when insufficient_privilege then insert into r values ('anon cannot call the token helper', true, null); end $$;
insert into r select 'no token set yet -> pull refused (even with an empty / null token)', (public.qqbot_pull('') ->> 'ok')::boolean = false and (public.qqbot_pull(null) ->> 'ok')::boolean = false, null;
reset role;

-- ---------- normal user: not an admin ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000cc', false) \g /dev/null
do $$ begin perform public.admin_qqbot_overview(); insert into r values ('normal user: overview refused', false, null); exception when raise_exception then insert into r values ('normal user: overview refused', true, null); end $$;
do $$ begin perform public.admin_qqbot_save_faq('{"keywords":["x"],"answer":"y"}'); insert into r values ('normal user: save faq refused', false, null); exception when raise_exception then insert into r values ('normal user: save faq refused', true, null); end $$;
do $$ begin perform public.admin_qqbot_new_token(); insert into r values ('normal user: new token refused', false, null); exception when raise_exception then insert into r values ('normal user: new token refused', true, null); end $$;
do $$ begin insert into public.qqbot_faq(keywords, answer) values ('{x}', 'y'); insert into r values ('normal user cannot insert into qqbot_faq directly', false, null); exception when insufficient_privilege then insert into r values ('normal user cannot insert into qqbot_faq directly', true, null); end $$;

-- the checks below read the tables while acting as an admin; give the test role read access for that (privileges were checked above)
reset role;
grant select on public.qqbot_settings, public.qqbot_faq, public.qqbot_hits to authenticated;
create policy t_read on public.qqbot_settings for select to authenticated using (true); create policy t_read on public.qqbot_faq for select to authenticated using (true); create policy t_read on public.qqbot_hits for select to authenticated using (true);
set role authenticated;
-- ---------- admin2 (not super) with a revoked login: refused; then with a live login ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000bb', false) \g /dev/null
select set_config('request.jwt.claims', '{"session_id":"40000000-0000-0000-0000-000000000001"}', false) \g /dev/null
do $$ begin perform public.admin_qqbot_overview(); insert into r values ('admin with a revoked login: refused', false, null); exception when raise_exception then insert into r values ('admin with a revoked login: refused', true, null); end $$;
select set_config('request.jwt.claims', '{"session_id":"40000000-0000-0000-0000-000000000002"}', false) \g /dev/null
insert into r select 'admin (not super): overview works, is_super=false', (public.admin_qqbot_overview() ->> 'is_super')::boolean = false, null;
insert into r select 'admin (not super): cannot generate a token', (public.admin_qqbot_new_token() ->> 'ok')::boolean = false and (select token_hash from public.qqbot_settings) is null, null;
insert into r select 'admin (not super): cannot revoke the token', (public.admin_qqbot_revoke_token() ->> 'ok')::boolean = false, null;
-- FAQ validation
insert into r select 'faq: no keywords refused', (public.admin_qqbot_save_faq('{"keywords":[" ",""],"answer":"a"}') ->> 'ok')::boolean = false, null;
insert into r select 'faq: keywords not an array refused', (public.admin_qqbot_save_faq('{"keywords":"注册","answer":"a"}') ->> 'ok')::boolean = false, null;
insert into r select 'faq: empty answer refused', (public.admin_qqbot_save_faq('{"keywords":["a"],"answer":"  "}') ->> 'ok')::boolean = false, null;
insert into r select 'faq: answer > 1000 chars refused', (public.admin_qqbot_save_faq(jsonb_build_object('keywords', jsonb_build_array('a'), 'answer', repeat('字', 1001))) ->> 'ok')::boolean = false, null;
insert into r select 'faq: keyword > 30 chars refused', (public.admin_qqbot_save_faq(jsonb_build_object('keywords', jsonb_build_array(repeat('字', 31)), 'answer', 'a')) ->> 'ok')::boolean = false, null;
insert into r select 'faq: bad id refused', (public.admin_qqbot_save_faq('{"id":"x; drop table","keywords":["a"],"answer":"a"}') ->> 'ok')::boolean = false, null;
insert into r select 'faq: unknown id refused', (public.admin_qqbot_save_faq('{"id":"99999999-0000-0000-0000-000000000000","keywords":["a"],"answer":"a"}') ->> 'ok')::boolean = false, null;
insert into r select 'faq: nothing written by refused calls', (select count(*) from public.qqbot_faq) = 0, null;
create temp table f1 as select public.admin_qqbot_save_faq('{"keywords":[" 注册 ","怎么注册","注册",""],"answer":"  打开网页点「注册」  ","sort":2}') j;
insert into r select 'faq: added; keywords trimmed, de-duplicated in order; answer trimmed', (select (j ->> 'ok')::boolean from f1) and (select keywords from public.qqbot_faq) = '{注册,怎么注册}' and (select answer from public.qqbot_faq) = '打开网页点「注册」' and (select sort from public.qqbot_faq) = 2, (select keywords::text || ' | ' || answer from public.qqbot_faq);
select public.admin_qqbot_save_faq('{"keywords":["密码"],"answer":"找管理员","sort":1}') \g /dev/null
select public.admin_qqbot_save_faq('{"keywords":["停用的"],"answer":"不该出现","enabled":false}') \g /dev/null
create temp table e1 as select public.admin_qqbot_save_faq(jsonb_build_object('id', (select j ->> 'id' from f1), 'keywords', jsonb_build_array('注册', '怎么注册', '注册账号'), 'answer', '打开网页点「注册」', 'sort', 2)) j;
insert into r select 'faq: edit keeps the id', (select (j ->> 'ok')::boolean and j ->> 'id' = (select j ->> 'id' from f1) from e1) and (select count(*) from public.qqbot_faq) = 3 and (select keywords from public.qqbot_faq where id = (select (j ->> 'id')::uuid from f1)) = '{注册,怎么注册,注册账号}', null;
-- settings validation
insert into r select 'settings: bad group number refused', (public.admin_qqbot_save_settings('{"enabled":true,"groups":["12345","abc"],"cooldown_sec":60}') ->> 'ok')::boolean = false, null;
insert into r select 'settings: cooldown out of range refused', (public.admin_qqbot_save_settings('{"enabled":true,"groups":["12345"],"cooldown_sec":2}') ->> 'ok')::boolean = false and (public.admin_qqbot_save_settings('{"enabled":true,"groups":["12345"],"cooldown_sec":"60; drop"}') ->> 'ok')::boolean = false, null;
insert into r select 'settings: enabling with no group refused', (public.admin_qqbot_save_settings('{"enabled":true,"groups":[],"cooldown_sec":60}') ->> 'ok')::boolean = false, null;
insert into r select 'settings: > 50 groups refused', (public.admin_qqbot_save_settings(jsonb_build_object('enabled', false, 'groups', (select jsonb_agg((100000 + i)::text) from generate_series(1, 51) i), 'cooldown_sec', 60)) ->> 'ok')::boolean = false, null;
insert into r select 'settings: refused calls changed nothing', not (select enabled from public.qqbot_settings) and (select groups from public.qqbot_settings) = '{}', null;
create temp table s1 as select public.admin_qqbot_save_settings('{"enabled":true,"groups":[" 123456789 ","123456789","88888"],"cooldown_sec":30,"require_at":true}') j;
insert into r select 'settings: saved (groups trimmed / de-duplicated)', (select (j ->> 'ok')::boolean from s1) and (select enabled from public.qqbot_settings) and (select groups from public.qqbot_settings) = '{123456789,88888}' and (select cooldown_sec from public.qqbot_settings) = 30 and (select require_at from public.qqbot_settings), (select groups::text from public.qqbot_settings);
reset role;
insert into r select 'admin actions are logged (2 adds, 1 edit, settings)', (select count(*) from public.admin_operation_logs where action = 'qqbot_faq_add') = 3 and (select count(*) from public.admin_operation_logs where action = 'qqbot_faq_edit') = 1 and (select count(*) from public.admin_operation_logs where action = 'qqbot_settings') = 1, (select string_agg(action, ',') from public.admin_operation_logs);

-- ---------- owner (super): token ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
select set_config('request.jwt.claims', '{}', false) \g /dev/null
insert into tok select public.admin_qqbot_new_token() ->> 'token';
reset role;
insert into r select 'super: token is 64 hex, only its sha256 is stored', (select t from tok) ~ '^[0-9a-f]{64}$' and (select token_hash from public.qqbot_settings) = encode(sha256(convert_to((select t from tok), 'UTF8')), 'hex') and (select token_hash from public.qqbot_settings) <> (select t from tok), null;

-- ---------- the bot (anon) ----------
set role anon;
create temp table p1 as select public.qqbot_pull((select t from tok)) j;
insert into r select 'bot: pull with the token -> on, groups, cooldown, require_at', (select (j ->> 'ok')::boolean and (j ->> 'enabled')::boolean and j -> 'groups' = '["123456789","88888"]'::jsonb and (j ->> 'cooldown_sec')::int = 30 and (j ->> 'require_at')::boolean from p1), (select j::text from p1);
insert into r select 'bot: only enabled FAQs, in sort order, no admin fields', (select jsonb_array_length(j -> 'faqs') = 2 and j -> 'faqs' -> 0 ->> 'answer' = '找管理员' and j -> 'faqs' -> 1 -> 'keywords' = '["注册","怎么注册","注册账号"]'::jsonb and not (j -> 'faqs' -> 0 ? 'enabled') from p1), null;
insert into r select 'bot: pull with a wrong token -> nothing', (public.qqbot_pull(repeat('0', 64)) - 'message') = '{"ok": false}'::jsonb, null;
insert into r select 'bot: hit with a wrong token not recorded', (public.qqbot_hit(repeat('0', 64), (select (j -> 'faqs' -> 0 ->> 'id')::uuid from p1), '88888') ->> 'ok')::boolean = false, null;
insert into r select 'bot: hit for a group not in settings refused', (public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 0 ->> 'id')::uuid from p1), '99999') ->> 'ok')::boolean = false, null;
insert into r select 'bot: hit with a junk group refused', (public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 0 ->> 'id')::uuid from p1), '88888 or 1=1') ->> 'ok')::boolean = false, null;
insert into r select 'bot: hit for an unknown FAQ refused', (public.qqbot_hit((select t from tok), gen_random_uuid(), '88888') ->> 'ok')::boolean = false, null;
insert into r select 'bot: hit recorded', (public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 0 ->> 'id')::uuid from p1), ' 88888 ') ->> 'ok')::boolean and (public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 1 ->> 'id')::uuid from p1), '123456789') ->> 'ok')::boolean, null;
do $$ begin perform 1 from public.qqbot_hits; insert into r values ('bot (anon) cannot read hits directly', false, null); exception when insufficient_privilege then insert into r values ('bot (anon) cannot read hits directly', true, null); end $$;
reset role;
insert into r select 'hits store only group, faq, time', (select count(*) from public.qqbot_hits) = 2 and (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'qqbot_hits') = 'id,faq_id,group_id,created_at', null;
insert into r select 'pull updates last_seen_at', (select last_seen_at from public.qqbot_settings) is not null, null;
-- retention + rate cap
insert into public.qqbot_hits(faq_id, group_id, created_at) values ((select id from public.qqbot_faq where '密码' = any(keywords)), '88888', now() - interval '200 days');
insert into public.qqbot_hits(faq_id, group_id, created_at) select (select id from public.qqbot_faq where '密码' = any(keywords)), '88888', now() - interval '20 minutes' from generate_series(1, 5);
set role anon;
select public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 0 ->> 'id')::uuid from p1), '88888') \g /dev/null
reset role;
insert into r select 'hits older than 180 days are removed', not exists (select 1 from public.qqbot_hits where created_at < now() - interval '180 days'), null;
insert into public.qqbot_hits(faq_id, group_id) select (select id from public.qqbot_faq where '密码' = any(keywords)), '12345' from generate_series(1, 297);
set role anon;
insert into r select 'rate cap: 300 hits in 10 minutes -> the next one is not recorded', (public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 0 ->> 'id')::uuid from p1), '88888') ->> 'ok')::boolean = false, null;
reset role;
delete from public.qqbot_hits where group_id = '12345';

-- ---------- admin views ----------
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false) \g /dev/null
create temp table o1 as select public.admin_qqbot_overview() j;
insert into r select 'overview: settings without the token hash', (select j -> 'settings' ->> 'token_set' = 'true' and not (j -> 'settings' ? 'token_hash') and not (j::text like '%' || (select token_hash from public.qqbot_settings) || '%') from o1), null;
insert into r select 'overview: all FAQs (incl. disabled) with hit counts', (select jsonb_array_length(j -> 'faqs') = 3 from o1) and (select (x ->> 'hits_30d')::int from o1, jsonb_array_elements(j -> 'faqs') x where x ->> 'answer' = '找管理员') = 7, (select j -> 'faqs' from o1)::text;
insert into r select 'overview: stats today / 7d / 30d / total and 14 daily buckets', (select (j -> 'stats' ->> 'd30')::int = 8 and (j -> 'stats' ->> 'total')::int = 8 and jsonb_array_length(j -> 'stats' -> 'daily') = 14 and (j -> 'stats' -> 'daily' -> 13 ->> 'n')::int = (j -> 'stats' ->> 'today')::int and j -> 'stats' -> 'daily' -> 13 ->> 'day' = to_char(now() at time zone 'Asia/Shanghai', 'MM-DD') from o1), (select j -> 'stats' from o1)::text;
insert into r select 'overview: per-group counts', (select j -> 'stats' -> 'groups' -> 0 ->> 'group_id' = '88888' and (j -> 'stats' -> 'groups' -> 0 ->> 'n')::int = 7 from o1), (select j -> 'stats' -> 'groups' from o1)::text;
insert into r select 'hit log: newest first, with the matched FAQ, limit respected', jsonb_array_length(public.admin_qqbot_hits(3)) = 3 and (public.admin_qqbot_hits(1) -> 0 ->> 'group_id') is not null and jsonb_array_length(public.admin_qqbot_hits(100000)) = 8, null;
-- delete keeps the hits (shown as deleted)
insert into r select 'delete faq: removed, hits kept with faq_id null', (public.admin_qqbot_delete_faq((select id from public.qqbot_faq where '密码' = any(keywords))) ->> 'ok')::boolean and (select count(*) from jsonb_array_elements(public.admin_qqbot_hits(500)) x where x -> 'faq_id' = 'null'::jsonb) = 7, null;
insert into r select 'delete faq: unknown id -> not ok', (public.admin_qqbot_delete_faq(gen_random_uuid()) ->> 'ok')::boolean = false, null;
-- revoke the token -> the bot is locked out
insert into r select 'super: revoke token', (public.admin_qqbot_revoke_token() ->> 'ok')::boolean, null;
reset role;
set role anon;
insert into r select 'after revoke: old token gets nothing', (public.qqbot_pull((select t from tok)) ->> 'ok')::boolean = false and (public.qqbot_hit((select t from tok), (select (j -> 'faqs' -> 1 ->> 'id')::uuid from p1), '88888') ->> 'ok')::boolean = false, null;
reset role;
-- new token replaces the old one
set role authenticated;
insert into tok select public.admin_qqbot_new_token() ->> 'token';
reset role;
set role anon;
insert into r select 'new token works, the first one does not', (public.qqbot_pull((select t from tok offset 1)) ->> 'ok')::boolean and not (public.qqbot_pull((select t from tok limit 1)) ->> 'ok')::boolean, null;
reset role;

reset role;
revoke select on public.qqbot_settings, public.qqbot_faq, public.qqbot_hits from authenticated;
drop policy t_read on public.qqbot_settings; drop policy t_read on public.qqbot_faq; drop policy t_read on public.qqbot_hits;
-- ---------- report ----------
select case when ok then 'PASS' else 'FAIL' end || '  ' || name || coalesce('  -- ' || detail, '') as result from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
