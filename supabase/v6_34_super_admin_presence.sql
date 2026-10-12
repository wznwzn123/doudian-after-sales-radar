-- 售后雷达 Pro 6.34：超级管理员保护 + 在线名单防冒充（需要在 SQL Editor 执行；分 2 段，每段末尾有核对查询）
-- 状态：已于 2026-10-12 由用户在 SQL Editor 执行（第 1 段拆成两次贴，各带 revoke/grant），只读核对通过；不登录加入 after-sales-online 实测被拒。可重复执行。
-- 写之前已用只读查询核对（2026-10-12）：
--   * admin_users 只有 user_id 一列、只有 1 行（1012968575@qq.com，项目主人）；前端对 admin_users 只有 select 权限；
--   * 以前所有管理员权力一样：任何管理员都能 admin_add_user_by_email（加管理员）、admin_remove_user（移除别的管理员，包括主人）、
--     admin_set_device_status（封禁别的管理员的设备）、admin_revoke_user_sessions（让别的管理员下线），
--     Edge Function admin-reset-password 也能重置别的管理员的密码（等于接管账号）。admin_set_account_ban 已经拒绝封禁管理员账号，不用改；
--   * 在线名单用的是公开频道 after-sales-presence：拿着网页里的公开 key、不登录也能加入，能看到在线用户编号，也能冒充任意编号「在线」；
--     realtime.messages 已开 RLS、没有任何策略，所以私有频道（private: true）目前谁都进不去 —— 下面第 2 段加策略后，只有正常登录的用户能进；
--   * 服务端每 2 分钟记录一次每个登录的活动（device_sessions.seen_at，由 my_session_status 用 auth.uid() 写入，前端改不了），用来核实「在线」。
-- 第 1 段规则：is_super = 超级管理员（现有的唯一管理员 = 主人自动成为超级管理员）。
--   只有超级管理员能加 / 移除管理员；对「另一个管理员」的操作（重置密码、强制下线、封禁 / 解封设备）只有超级管理员能做，而且谁都不能对超级管理员做。
--   对普通用户的操作不变（任何管理员都能做）。
-- 回滚（第 1 段）：drop function if exists public.admin_may_target(uuid), public.is_super_admin(), public.admin_roles();
--       alter table public.admin_users drop column if exists is_super; 再执行一次 v6_33 第 1 段恢复 admin_revoke_user_sessions；
--       admin_add_user_by_email / admin_remove_user / admin_set_device_status 恢复成本文件开头注释里描述的旧逻辑（见 git 历史里本文件的说明）。
-- 回滚（第 2 段）：drop policy if exists online_presence_read on realtime.messages; drop policy if exists online_presence_write on realtime.messages;
--       drop function if exists public.online_verify(uuid[]);（前端 6.34 会退回显示未核实的名单）

-- ===== 第 1 段：超级管理员 =====
alter table public.admin_users add column if not exists is_super boolean not null default false;
update public.admin_users set is_super = true where not exists (select 1 from public.admin_users where is_super);

create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists (select 1 from public.admin_users where user_id = auth.uid() and is_super) $f$;

-- 调用者能不能对这个账号做管理操作：必须是管理员；对普通用户 / 自己可以；对别的管理员只有超级管理员可以，且不能是超级管理员
create or replace function public.admin_may_target(p_user uuid) returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists (select 1 from public.admin_users where user_id = auth.uid()) and (p_user = auth.uid() or not exists (select 1 from public.admin_users where user_id = p_user) or (exists (select 1 from public.admin_users where user_id = auth.uid() and is_super) and not exists (select 1 from public.admin_users where user_id = p_user and is_super))) $f$;

-- 管理后台「管理员」页用：谁是超级管理员（只有管理员能调）
create or replace function public.admin_roles() returns table(user_id uuid, is_super boolean) language plpgsql stable security definer set search_path to 'public' as $f$ #variable_conflict use_column
begin if not exists (select 1 from public.admin_users a where a.user_id = auth.uid()) then raise exception '没有管理员权限'; end if; return query select a.user_id, a.is_super from public.admin_users a; end $f$;

create or replace function public.admin_add_user_by_email(p_email text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare target_id uuid; begin if not exists (select 1 from public.admin_users where user_id = auth.uid()) then return jsonb_build_object('ok', false, 'message', '没有管理员权限'); end if; if not public.is_super_admin() then return jsonb_build_object('ok', false, 'message', '只有超级管理员才能添加管理员'); end if; select id into target_id from auth.users where lower(email) = lower(trim(p_email)) limit 1; if target_id is null then return jsonb_build_object('ok', false, 'message', '找不到该注册账号'); end if; insert into public.admin_users(user_id) values (target_id) on conflict do nothing; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'admin_add', '添加管理员：' || lower(trim(p_email))); return jsonb_build_object('ok', true, 'message', '管理员添加成功'); end $f$;

create or replace function public.admin_remove_user(p_user_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ begin if not exists (select 1 from public.admin_users where user_id = auth.uid()) then return jsonb_build_object('ok', false, 'message', '没有管理员权限'); end if; if p_user_id = auth.uid() then return jsonb_build_object('ok', false, 'message', '不能移除当前登录管理员'); end if; if not public.is_super_admin() then return jsonb_build_object('ok', false, 'message', '只有超级管理员才能移除管理员'); end if; if exists (select 1 from public.admin_users where user_id = p_user_id and is_super) then return jsonb_build_object('ok', false, 'message', '不能移除超级管理员'); end if; delete from public.admin_users where user_id = p_user_id; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'admin_remove', '移除管理员：' || coalesce((select coalesce(nullif(email, ''), phone) from auth.users where id = p_user_id), p_user_id::text)); return jsonb_build_object('ok', true, 'message', '管理员权限已移除'); end $f$;

-- 和原来完全一样，只多一条：别的管理员的设备，要 admin_may_target 允许才能封禁 / 解封
create or replace function public.admin_set_device_status(payload jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare v_id uuid; v_action text; v_reason text; v_cur text; v_row public.security_devices%rowtype; begin if auth.uid() is null or not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if; v_id := (payload ->> 'id')::uuid; v_action := payload ->> 'action'; v_reason := btrim(coalesce(payload ->> 'reason', '')); v_cur := btrim(coalesce(payload ->> 'current_device_id', '')); select * into v_row from public.security_devices where id = v_id for update; if not found then raise exception 'device not found' using errcode = 'P0002'; end if; if v_row.user_id <> auth.uid() and not public.admin_may_target(v_row.user_id) then raise exception 'cannot change another admin''s device' using errcode = '42501'; end if; if v_action = 'block' then if char_length(v_reason) < 2 then raise exception 'block reason required' using errcode = '22023'; end if; if v_row.user_id = auth.uid() and (v_cur = '' or v_cur = v_row.device_id) then raise exception 'cannot block the admin current device' using errcode = '22023'; end if; update public.security_devices set status = 'blocked', blocked_at = now(), blocked_reason = v_reason, blocked_by = auth.uid(), updated_at = now() where id = v_id; elsif v_action = 'unblock' then update public.security_devices set status = 'active', blocked_at = null, blocked_reason = null, blocked_by = null, updated_at = now() where id = v_id; else raise exception 'invalid action' using errcode = '22023'; end if; insert into public.security_events (user_id, device_id, event_type, severity, message, metadata) values (v_row.user_id, v_row.device_id, case when v_action = 'block' then 'manual_block' else 'manual_unblock' end, case when v_action = 'block' then 'warning' else 'info' end, case when v_action = 'block' then '管理员封禁设备：' || v_reason else '管理员解除设备封禁' end, jsonb_build_object('scope', 'device', 'action', v_action, 'reason', v_reason, 'admin_id', auth.uid())); insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'device_' || v_action, v_row.device_id || coalesce(' / ' || nullif(v_reason, ''), '')); return jsonb_build_object('ok', true, 'id', v_id, 'action', v_action); end; $f$;

-- v6_33 的版本 + 一条：对别的管理员要 admin_may_target 允许
create or replace function public.admin_revoke_user_sessions(p_user_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); n int := 0; label text; begin if uid is null or not exists (select 1 from public.admin_users a where a.user_id = uid) then raise exception '没有管理员权限'; end if; if public.is_session_revoked() then return jsonb_build_object('ok', false, 'message', '这台设备的登录已失效，请重新登录'); end if; if p_user_id is null then return jsonb_build_object('ok', false, 'message', '用户编号不正确'); end if; if p_user_id = uid then return jsonb_build_object('ok', false, 'message', '不能对自己操作，请用「登录记录 → 退出其他所有设备」'); end if; if not public.admin_may_target(p_user_id) then return jsonb_build_object('ok', false, 'message', '不能对其他管理员操作（只有超级管理员可以，且不能对超级管理员操作）'); end if; select coalesce(nullif(u.email, ''), u.phone) into label from auth.users u where u.id = p_user_id; if not found then return jsonb_build_object('ok', false, 'message', '找不到该账号'); end if; insert into public.revoked_sessions (session_id, user_id, device_id) select s.id, p_user_id, (select d.device_id from public.device_sessions d where d.session_id = s.id) from auth.sessions s where s.user_id = p_user_id on conflict (session_id) do nothing; delete from auth.sessions s where s.user_id = p_user_id; get diagnostics n = row_count; delete from public.device_sessions where user_id = p_user_id; insert into public.admin_operation_logs (user_id, action, detail) values (uid, 'admin_logout_user', '让 ' || coalesce(label, left(p_user_id::text, 8)) || ' 的所有设备退出登录（' || n || ' 个登录）'); return jsonb_build_object('ok', true, 'sessions', n); end $f$;

revoke execute on function public.is_super_admin(), public.admin_may_target(uuid), public.admin_roles(), public.admin_add_user_by_email(text), public.admin_remove_user(uuid), public.admin_set_device_status(jsonb), public.admin_revoke_user_sessions(uuid) from public, anon;
grant execute on function public.is_super_admin(), public.admin_may_target(uuid), public.admin_roles(), public.admin_add_user_by_email(text), public.admin_remove_user(uuid), public.admin_set_device_status(jsonb), public.admin_revoke_user_sessions(uuid) to authenticated;

select 'super admins' as check, count(*) as n from public.admin_users where is_super
union all select 'admins', count(*) from public.admin_users
union all select 'functions', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('is_super_admin', 'admin_may_target', 'admin_roles', 'admin_add_user_by_email', 'admin_remove_user', 'admin_set_device_status', 'admin_revoke_user_sessions') and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
union all select 'guarded', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_add_user_by_email', 'admin_remove_user', 'admin_set_device_status', 'admin_revoke_user_sessions') and (p.prosrc like '%is_super_admin()%' or p.prosrc like '%admin_may_target(%');
-- 期望：super admins = 1，admins = 1，functions = 7，guarded = 4

-- ===== 第 2 段：在线名单只让正常登录的用户进 + 服务端核实 =====
-- 私有频道 after-sales-online（前端 6.34 改用它，private: true）：只有登录、没被封、不是待审核、登录没被作废的用户能收 / 发在线状态
drop policy if exists online_presence_read on realtime.messages;
create policy online_presence_read on realtime.messages for select to authenticated using (realtime.messages.extension = 'presence' and (select realtime.topic()) = 'after-sales-online' and not (select public.is_user_banned((select auth.uid()))) and not (select public.is_account_pending((select auth.uid()))) and not (select public.is_session_revoked()));
drop policy if exists online_presence_write on realtime.messages;
create policy online_presence_write on realtime.messages for insert to authenticated with check (realtime.messages.extension = 'presence' and (select realtime.topic()) = 'after-sales-online' and not (select public.is_user_banned((select auth.uid()))) and not (select public.is_account_pending((select auth.uid()))) and not (select public.is_session_revoked()));

-- 在线名单里的编号是各设备自己报的；只承认最近 5 分钟服务端真的记录到活动的账号（每 2 分钟一次的登录复查会写 device_sessions / security_devices）
create or replace function public.online_verify(p_ids uuid[]) returns uuid[] language sql stable security definer set search_path to 'public' as $f$ select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest((coalesce(p_ids, '{}'::uuid[]))[1:500]) x where auth.uid() is not null and (exists (select 1 from public.device_sessions s where s.user_id = x and s.seen_at > now() - interval '5 minutes') or exists (select 1 from public.security_devices d where d.user_id = x and greatest(d.last_seen, d.last_seen_at) > now() - interval '5 minutes')) $f$;
revoke execute on function public.online_verify(uuid[]) from public, anon;
grant execute on function public.online_verify(uuid[]) to authenticated;

select 'presence policies' as check, count(*) as n from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname in ('online_presence_read', 'online_presence_write')
union all select 'online_verify', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'online_verify' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
-- 期望：presence policies = 2，online_verify = 1
