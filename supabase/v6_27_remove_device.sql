-- 售后雷达 Pro 6.27：用户在「登录记录」里删除陌生设备 → 那台设备被强制退出，必须重新输入密码登录
-- 状态：已于 2026-10-11 由用户在 SQL Editor 分 3 段执行（第 1 段又拆成两段贴），只读核对 3 / 3 / 8：三张表开 RLS 且前端不可读；四个函数 security definer、anon 不可执行；8 条限制性策略；my_login_alerts 已返回 id。可重复执行。
-- 写之前已用只读查询核对：
--   * 没有任何外键指向 security_devices，表上没有触发器 —— 删除一行不会连带删别的数据；
--   * postgres（security definer 函数的属主）对 auth.sessions 有 select/delete 权限；auth.refresh_tokens、auth.mfa_amr_claims 对 sessions 是 on delete cascade，
--     删掉 session 就等于在服务端作废这台设备的刷新令牌（它无法再续登录）；
--   * 访问令牌（最长 1 小时）里带 session_id，所以再加一条限制性 RLS「session_not_revoked」：被移除的登录即使令牌还没过期，也读写不了任何业务数据；
--     覆盖的表和 account_not_banned 完全一样（7 张业务表 + support_messages + storage.objects 的 after-sales-evidence 桶）。
-- 怎么知道一台设备对应哪些登录：前端每次进入系统和每 2 分钟复查时调用 my_session_status(本机设备ID)，把「当前登录 session_id ↔ 设备ID」记进 device_sessions。
-- 删除设备 remove_my_device(设备行 id, 本机设备ID)：只能删自己的、不能删正在用的这台；
--   ① 记一条 revoked_devices（之后这台设备上在此之前建立的登录一律作废，哪怕之前没上报过 session）；
--   ② 已知的 session 记进 revoked_sessions 并从 auth.sessions 删除；③ 删除 security_devices 这一行（被管理员封禁的设备保留，不能借此解封）；
--   ④ 写 admin_operation_logs（action = remove_device）。
--   对方重新输入密码登录会产生新的 session（不受影响），并被当成新设备 → 账号主人会再收到新设备提醒（系统内 + 邮件）。
-- 回滚：drop policy if exists session_not_revoked on <下面每张表>; drop policy if exists session_not_revoked_evidence on storage.objects;
--       drop function if exists public.remove_my_device(uuid, text), public.my_session_status(text), public.is_session_revoked();
--       drop table if exists public.revoked_sessions, public.revoked_devices, public.device_sessions;
--       再执行一次 v6_23 第 2 段恢复 my_login_alerts（这里只是给它多返回了一个 id 字段）。

-- ===== 第 1 段：表 + 函数 =====
create table if not exists public.device_sessions (session_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, device_id text not null, seen_at timestamptz not null default now());
create index if not exists device_sessions_user_device_idx on public.device_sessions (user_id, device_id);
create table if not exists public.revoked_sessions (session_id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade, device_id text, revoked_at timestamptz not null default now());
create table if not exists public.revoked_devices (user_id uuid not null references auth.users(id) on delete cascade, device_id text not null, revoked_at timestamptz not null default now(), primary key (user_id, device_id));
alter table public.device_sessions enable row level security;
alter table public.revoked_sessions enable row level security;
alter table public.revoked_devices enable row level security;
revoke all on public.device_sessions, public.revoked_sessions, public.revoked_devices from anon, authenticated;

create or replace function public.is_session_revoked() returns boolean language sql stable security definer set search_path to 'public' as $f$ select exists (select 1 from public.revoked_sessions r where r.session_id::text = coalesce(auth.jwt() ->> 'session_id', '')); $f$;

create or replace function public.my_session_status(p_device_id text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); sid text := coalesce(auth.jwt() ->> 'session_id', ''); dev text := btrim(coalesce(p_device_id, '')); s_created timestamptz; begin if uid is null then return jsonb_build_object('ok', false); end if; if exists (select 1 from public.revoked_sessions where session_id::text = sid) then return jsonb_build_object('ok', true, 'revoked', true); end if; if sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok', true, 'revoked', false); end if; select created_at into s_created from auth.sessions where id = sid::uuid; if dev <> '' and exists (select 1 from public.revoked_devices r where r.user_id = uid and r.device_id = dev and (s_created is null or s_created < r.revoked_at)) then insert into public.revoked_sessions (session_id, user_id, device_id) values (sid::uuid, uid, dev) on conflict (session_id) do nothing; delete from auth.sessions where id = sid::uuid and user_id = uid; return jsonb_build_object('ok', true, 'revoked', true); end if; if dev <> '' and length(dev) <= 200 then insert into public.device_sessions (session_id, user_id, device_id, seen_at) values (sid::uuid, uid, dev, now()) on conflict (session_id) do update set device_id = excluded.device_id, seen_at = now() where public.device_sessions.user_id = uid; end if; return jsonb_build_object('ok', true, 'revoked', false); end $f$;

create or replace function public.remove_my_device(p_id uuid, p_current_device text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); d public.security_devices%rowtype; n int := 0; begin if uid is null then return jsonb_build_object('ok', false, 'message', '请先登录'); end if; if public.is_session_revoked() then return jsonb_build_object('ok', false, 'message', '这台设备的登录已失效，请重新登录'); end if; select * into d from public.security_devices where id = p_id and user_id = uid; if not found then return jsonb_build_object('ok', false, 'message', '找不到这台设备（可能已经删除）'); end if; if d.device_id = btrim(coalesce(p_current_device, '')) then return jsonb_build_object('ok', false, 'message', '不能删除你正在使用的这台设备'); end if; insert into public.revoked_devices (user_id, device_id, revoked_at) values (uid, d.device_id, now()) on conflict (user_id, device_id) do update set revoked_at = now(); insert into public.revoked_sessions (session_id, user_id, device_id) select s.session_id, uid, d.device_id from public.device_sessions s where s.user_id = uid and s.device_id = d.device_id on conflict (session_id) do nothing; delete from auth.sessions a using public.device_sessions s where s.user_id = uid and s.device_id = d.device_id and a.id = s.session_id and a.user_id = uid; get diagnostics n = row_count; delete from public.device_sessions where user_id = uid and device_id = d.device_id; if coalesce(d.status, '') <> 'blocked' then delete from public.security_devices where id = d.id and user_id = uid; end if; insert into public.admin_operation_logs (user_id, action, detail) values (uid, 'remove_device', '用户删除了自己的设备：' || coalesce(nullif(d.device_name, ''), nullif(d.platform, ''), left(d.device_id, 10)) || '（强制退出 ' || n || ' 个登录）'); return jsonb_build_object('ok', true, 'sessions', n, 'kept_blocked', coalesce(d.status, '') = 'blocked'); end $f$;

-- my_login_alerts：和 v6_23 完全一样，只是每台设备多返回 'id'（security_devices 的行编号，删除时用）
create or replace function public.my_login_alerts(p_device_id text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); base timestamptz; begin if uid is null then return jsonb_build_object('ok', false); end if; select seen_at into base from public.login_alert_acks where user_id = uid; if base is null then insert into public.login_alert_acks (user_id, seen_at) values (uid, now()) on conflict (user_id) do nothing; base := now(); end if; return jsonb_build_object('ok', true, 'since', base, 'devices', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'device', left(d.device_id, 10), 'current', d.device_id = btrim(p_device_id), 'name', d.device_name, 'platform', d.platform, 'first_seen', d.first_seen, 'last_seen', greatest(d.last_seen, d.last_seen_at), 'ip', host(d.last_ip), 'status', d.status, 'is_new', d.first_seen > base and d.device_id <> btrim(p_device_id)) order by greatest(d.last_seen, d.last_seen_at) desc nulls last) from public.security_devices d where d.user_id = uid), '[]'::jsonb)); end $f$;

revoke execute on function public.is_session_revoked(), public.my_session_status(text), public.remove_my_device(uuid, text), public.my_login_alerts(text) from public, anon;
grant execute on function public.is_session_revoked(), public.my_session_status(text), public.remove_my_device(uuid, text), public.my_login_alerts(text) to authenticated;

-- ===== 第 2 段：服务端强制（被移除的登录读写不了任何业务数据）+ 核对 =====
drop policy if exists session_not_revoked on public.after_sales_tasks;
create policy session_not_revoked on public.after_sales_tasks as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked on public.after_sales_events;
create policy session_not_revoked on public.after_sales_events as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked on public.evidence_files;
create policy session_not_revoked on public.evidence_files as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked on public.evidence_library;
create policy session_not_revoked on public.evidence_library as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked on public.shop_stores;
create policy session_not_revoked on public.shop_stores as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked on public.tracking_records;
create policy session_not_revoked on public.tracking_records as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked on public.support_messages;
create policy session_not_revoked on public.support_messages as restrictive for all to authenticated using (not (select public.is_session_revoked())) with check (not (select public.is_session_revoked()));
drop policy if exists session_not_revoked_evidence on storage.objects;
create policy session_not_revoked_evidence on storage.objects as restrictive for all to authenticated using ((bucket_id <> 'after-sales-evidence') or (not (select public.is_session_revoked()))) with check ((bucket_id <> 'after-sales-evidence') or (not (select public.is_session_revoked())));
select 'tables' as check, count(*) as n from information_schema.tables where table_schema = 'public' and table_name in ('device_sessions', 'revoked_sessions', 'revoked_devices')
union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_session_revoked', 'my_session_status', 'remove_my_device') and not has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
union all select 'policies', count(*) from pg_policies where policyname in ('session_not_revoked', 'session_not_revoked_evidence');
-- 期望：tables = 3，functions = 3，policies = 8
