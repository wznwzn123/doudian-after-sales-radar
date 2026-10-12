-- Scenario test for supabase/v6_34_super_admin_presence.sql on a LOCAL PostgreSQL (run after dev/supabase-mock.pg.sql).
-- The prelude adds what the mock lacks (service_role, admin_users, security_events, is_admin / is_user_banned / is_account_pending stubs,
-- realtime.messages + realtime.topic() from a GUC, the old admin functions) and installs v6_27 first (v6_34 itself replaces admin_revoke_user_sessions from v6_33).
-- NOT a test against the real database. See HANDOFF.md for how to run it.
\set ON_ERROR_STOP 1
\set QUIET 1
-- ---------- prelude ----------
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
alter table auth.users add column if not exists last_sign_in_at timestamptz, add column if not exists created_at timestamptz default now();
alter table auth.sessions add column if not exists updated_at timestamptz default now();
create table public.admin_users(user_id uuid not null, constraint admin_users_user_id_unique unique (user_id));
alter table public.admin_users enable row level security;
grant select on public.admin_users to authenticated;
create policy admin_users_self_read on public.admin_users for select to authenticated using (user_id = (select auth.uid()));
create table public.security_events(id serial primary key, user_id uuid, device_id text, event_type text, severity text, message text, metadata jsonb, created_at timestamptz default now());
alter table public.security_devices add column if not exists blocked_at timestamptz, add column if not exists blocked_reason text, add column if not exists blocked_by uuid, add column if not exists updated_at timestamptz;
create table public.bans(user_id uuid primary key);
create table public.pending(user_id uuid primary key);
create function public.is_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists(select 1 from public.admin_users where user_id=auth.uid()) $f$;
create function public.is_user_banned(p_user_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists(select 1 from public.bans where user_id=p_user_id) $f$;
create function public.is_account_pending(p_user_id uuid) returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists(select 1 from public.pending where user_id=p_user_id) $f$;
-- the production versions before v6_34 (flat admin model)
create function public.admin_add_user_by_email(p_email text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare target_id uuid; begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then return jsonb_build_object('ok',false,'message','没有管理员权限'); end if; select id into target_id from auth.users where lower(email)=lower(trim(p_email)) limit 1; if target_id is null then return jsonb_build_object('ok',false,'message','找不到该注册账号'); end if; insert into public.admin_users(user_id) values(target_id) on conflict do nothing; return jsonb_build_object('ok',true,'message','管理员添加成功'); end $f$;
create function public.admin_remove_user(p_user_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then return jsonb_build_object('ok',false,'message','没有管理员权限'); end if; if p_user_id=auth.uid() then return jsonb_build_object('ok',false,'message','不能移除当前登录管理员'); end if; delete from public.admin_users where user_id=p_user_id; return jsonb_build_object('ok',true,'message','管理员权限已移除'); end $f$;
-- realtime mock: Realtime sets realtime.topic for the RLS check
create schema realtime;
create table realtime.messages(id uuid primary key default gen_random_uuid(), topic text, extension text, payload jsonb, event text, private boolean default true);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $f$ select nullif(current_setting('realtime.topic', true), '') $f$;
grant usage on schema realtime to authenticated, anon; grant select, insert on realtime.messages to authenticated, anon; grant execute on function realtime.topic() to authenticated, anon;
\i supabase/v6_27_remove_device.sql
-- ---------- data ----------
-- O = owner (the only admin before v6_34), A = second admin added later, U = normal user, B = banned user
insert into auth.users(id, email, phone) values
 ('00000000-0000-0000-0000-0000000000a0', 'owner@x.com', null),
 ('00000000-0000-0000-0000-0000000000a1', 'second@x.com', null),
 ('00000000-0000-0000-0000-0000000000b0', 'user@x.com', null),
 ('00000000-0000-0000-0000-0000000000b1', 'banned@x.com', null),
 ('00000000-0000-0000-0000-0000000000b2', 'idle@x.com', null);
insert into public.admin_users(user_id) values ('00000000-0000-0000-0000-0000000000a0');
insert into public.bans values ('00000000-0000-0000-0000-0000000000b1');
insert into auth.sessions(id, user_id) values ('10000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a0'), ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1'), ('10000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b0'), ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1');
insert into public.security_devices(id, user_id, device_id, platform, status, last_seen, last_seen_at) values
 ('20000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000a0','WEB-owner-phone','android','active', now(), now()),
 ('20000000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-0000000000a0','WEB-owner-old','android','active', now() - interval '3 day', now() - interval '3 day'),
 ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','WEB-second','ios','active', now() - interval '1 day', now() - interval '1 day'),
 ('20000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b0','WEB-user','ios','active', now() - interval '2 hour', now() - interval '2 hour'),
 ('20000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000b2','WEB-idle','ios','active', now() - interval '20 minute', now() - interval '20 minute');
insert into public.device_sessions(session_id, user_id, device_id, seen_at) values ('10000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b0','WEB-user', now() - interval '1 minute');
create temp table r(name text, ok boolean, detail text);
grant all on r to authenticated, anon, service_role;
create or replace function pg_temp.as_user(uid text, sid text) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', coalesce(uid, ''), false);
  perform set_config('request.jwt.claims', case when uid is null then '{}' else json_build_object('sub', uid, 'session_id', sid)::text end, false); end $$;
-- ---------- before v6_34: the flat model (bug reproduced) ----------
insert into public.admin_users(user_id) values ('00000000-0000-0000-0000-0000000000a1');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1') \g /dev/null
insert into r select 'BEFORE: a second admin could remove the owner (bug reproduced)', (public.admin_remove_user('00000000-0000-0000-0000-0000000000a0')->>'ok')::boolean, null;
reset role;
-- restore: owner is the only admin, as in production today
delete from public.admin_users; insert into public.admin_users(user_id) values ('00000000-0000-0000-0000-0000000000a0');
-- ---------- install v6_34 (twice) ----------
\i supabase/v6_34_super_admin_presence.sql
\i supabase/v6_34_super_admin_presence.sql
insert into r values ('v6_34 runs twice without error', true, null);
insert into r select 'existing admin (owner) became the super admin', (select bool_and(is_super) and count(*) = 1 from public.admin_users), null;
-- ---------- owner adds a second admin ----------
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a0','10000000-0000-0000-0000-0000000000a0') \g /dev/null
insert into r select 'owner (super) can add an admin', (x->>'ok')::boolean, x::text from (select public.admin_add_user_by_email('Second@x.com') x) q;
reset role;
\i supabase/v6_34_super_admin_presence.sql
insert into r select 're-running v6_34 does not make the second admin super', (select is_super from public.admin_users where user_id = '00000000-0000-0000-0000-0000000000a1') = false, null;
insert into r select 'admin_add logged', exists (select 1 from public.admin_operation_logs where action = 'admin_add' and detail like '%second@x.com%'), null;
set role authenticated;
-- ---------- second admin A (not super) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1') \g /dev/null
insert into r select 'A cannot add admins', (x->>'ok')::boolean = false and x->>'message' like '%超级管理员%', x::text from (select public.admin_add_user_by_email('user@x.com') x) q;
insert into r select 'A cannot remove the owner', (x->>'ok')::boolean = false, x::text from (select public.admin_remove_user('00000000-0000-0000-0000-0000000000a0') x) q;
reset role;
insert into r select 'owner is still admin + super', exists (select 1 from public.admin_users where user_id = '00000000-0000-0000-0000-0000000000a0' and is_super), null;
set role authenticated;
insert into r select 'may_target: A -> owner no, A -> user yes, A -> self yes', not public.admin_may_target('00000000-0000-0000-0000-0000000000a0') and public.admin_may_target('00000000-0000-0000-0000-0000000000b0') and public.admin_may_target('00000000-0000-0000-0000-0000000000a1'), null;
do $$ begin perform public.admin_set_device_status('{"id":"20000000-0000-0000-0000-0000000000a9","action":"block","reason":"测试封禁"}'::jsonb); insert into r values ('A cannot block the owner''s device', false, 'went through'); exception when insufficient_privilege then insert into r values ('A cannot block the owner''s device', true, sqlerrm); end $$;
insert into r select 'A can block a normal user''s device', (public.admin_set_device_status('{"id":"20000000-0000-0000-0000-0000000000b0","action":"block","reason":"测试封禁"}'::jsonb)->>'ok')::boolean, null;
insert into r select 'A can unblock it again', (public.admin_set_device_status('{"id":"20000000-0000-0000-0000-0000000000b0","action":"unblock"}'::jsonb)->>'ok')::boolean, null;
insert into r select 'A cannot force the owner offline', (x->>'ok')::boolean = false and x->>'message' like '%其他管理员%', x::text from (select public.admin_revoke_user_sessions('00000000-0000-0000-0000-0000000000a0') x) q;
reset role;
insert into r select 'owner''s session untouched', exists (select 1 from auth.sessions where id = '10000000-0000-0000-0000-0000000000a0'), null;
set role authenticated;
insert into r select 'A sees who is super', (select is_super from public.admin_roles() where user_id = '00000000-0000-0000-0000-0000000000a0'), null;
-- ---------- owner O (super) ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a0','10000000-0000-0000-0000-0000000000a0') \g /dev/null
insert into r select 'may_target: owner -> A yes, owner -> self yes', public.admin_may_target('00000000-0000-0000-0000-0000000000a1') and public.admin_may_target('00000000-0000-0000-0000-0000000000a0'), null;
insert into r select 'owner can block A''s device', (public.admin_set_device_status('{"id":"20000000-0000-0000-0000-0000000000a1","action":"block","reason":"测试封禁"}'::jsonb)->>'ok')::boolean, null;
insert into r select 'owner can block own OTHER device, not the current one', (public.admin_set_device_status('{"id":"20000000-0000-0000-0000-0000000000a9","action":"block","reason":"旧手机","current_device_id":"WEB-owner-phone"}'::jsonb)->>'ok')::boolean, null;
do $$ begin perform public.admin_set_device_status('{"id":"20000000-0000-0000-0000-0000000000a0","action":"block","reason":"测试","current_device_id":"WEB-owner-phone"}'::jsonb); insert into r values ('owner cannot block the device in use', false, null); exception when others then insert into r values ('owner cannot block the device in use', sqlerrm like '%current device%', sqlerrm); end $$;
insert into r select 'owner can force A offline', (x->>'ok')::boolean and (x->>'sessions')::int = 1, x::text from (select public.admin_revoke_user_sessions('00000000-0000-0000-0000-0000000000a1') x) q;
insert into r select 'owner cannot remove self', (public.admin_remove_user('00000000-0000-0000-0000-0000000000a0')->>'ok')::boolean = false, null;
insert into r select 'owner can remove A', (x->>'ok')::boolean, x::text from (select public.admin_remove_user('00000000-0000-0000-0000-0000000000a1') x) q;
reset role;
insert into r select 'A is no longer admin; owner still super', not exists (select 1 from public.admin_users where user_id = '00000000-0000-0000-0000-0000000000a1') and (select is_super from public.admin_users where user_id = '00000000-0000-0000-0000-0000000000a0'), null;
set role authenticated;
reset role;
insert into r select 'admin_remove logged with the account', exists (select 1 from public.admin_operation_logs where action = 'admin_remove' and detail like '%second@x.com%'), null;
set role authenticated;
-- ---------- normal user ----------
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b0','10000000-0000-0000-0000-0000000000b0') \g /dev/null
do $$ begin perform public.admin_roles(); insert into r values ('normal user cannot list admin roles', false, null); exception when others then insert into r values ('normal user cannot list admin roles', sqlerrm like '%没有管理员权限%', sqlerrm); end $$;
insert into r select 'normal user: may_target always false', not public.admin_may_target('00000000-0000-0000-0000-0000000000b2'), null;
insert into r select 'normal user cannot add an admin (themselves)', (public.admin_add_user_by_email('user@x.com')->>'ok')::boolean = false, null;
reset role;
insert into r select 'normal user is still not an admin', not exists (select 1 from public.admin_users where user_id = '00000000-0000-0000-0000-0000000000b0'), null;
set role authenticated;
-- ---------- online_verify ----------
insert into r select 'online_verify: recent server activity counts (device seen now / session 1 min ago), idle 20 min and unknown ids do not', (select array_agg(x order by x) from unnest(public.online_verify(array['00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000ff']::uuid[])) x) = array['00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000b0']::uuid[], (select public.online_verify(array['00000000-0000-0000-0000-0000000000a0','00000000-0000-0000-0000-0000000000b0','00000000-0000-0000-0000-0000000000b2']::uuid[])::text);
insert into r select 'online_verify: empty / null input', public.online_verify('{}') = '{}' and public.online_verify(null) = '{}', null;
-- ---------- realtime policies ----------
select set_config('realtime.topic', 'after-sales-online', false) \g /dev/null
insert into realtime.messages(topic, extension, payload) values ('after-sales-online', 'presence', '{"user_id":"x"}');
insert into r values ('presence: logged-in user can track on after-sales-online', true, null);
insert into r select 'presence: logged-in user can receive', (select count(*) from realtime.messages) >= 1, null;
select set_config('realtime.topic', 'some-other-topic', false) \g /dev/null
do $$ begin insert into realtime.messages(topic, extension) values ('some-other-topic', 'presence'); insert into r values ('presence: other topics refused', false, null); exception when insufficient_privilege then insert into r values ('presence: other topics refused', true, null); end $$;
select set_config('realtime.topic', 'after-sales-online', false) \g /dev/null
do $$ begin insert into realtime.messages(topic, extension) values ('after-sales-online', 'broadcast'); insert into r values ('presence: broadcast on the topic refused (presence only)', false, null); exception when insufficient_privilege then insert into r values ('presence: broadcast on the topic refused (presence only)', true, null); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000b1') \g /dev/null
do $$ begin insert into realtime.messages(topic, extension) values ('after-sales-online', 'presence'); insert into r values ('presence: banned account refused', false, null); exception when insufficient_privilege then insert into r values ('presence: banned account refused', true, null); end $$;
insert into r select 'presence: banned account receives nothing', (select count(*) from realtime.messages) = 0, null;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1','10000000-0000-0000-0000-0000000000a1') \g /dev/null
do $$ begin insert into realtime.messages(topic, extension) values ('after-sales-online', 'presence'); insert into r values ('presence: a revoked login refused', false, null); exception when insufficient_privilege then insert into r values ('presence: a revoked login refused', true, null); end $$;
reset role;
set role anon;
select pg_temp.as_user(null, null) \g /dev/null
do $$ begin insert into realtime.messages(topic, extension) values ('after-sales-online', 'presence'); insert into r values ('presence: not logged in (anon) refused', false, null); exception when insufficient_privilege then insert into r values ('presence: not logged in (anon) refused', true, null); end $$;
insert into r select 'presence: anon receives nothing', (select count(*) from realtime.messages) = 0, null;
insert into r select 'online_verify not callable by anon', not has_function_privilege('anon', 'public.online_verify(uuid[])', 'execute'), null;
reset role;
\set QUIET 0
select case when ok then 'PASS' else 'FAIL' end as result, name, coalesce(detail, '') as detail from r;
select count(*) filter (where ok) || '/' || count(*) || ' passed' as summary from r;
