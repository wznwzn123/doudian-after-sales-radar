-- 售后雷达 Pro 6.23：新设备登录提醒（系统内提醒）+ 登录记录
-- 状态：待用户在 Supabase SQL Editor 执行（分 2 段贴；可重复执行）。
-- 写之前已用只读查询核对：security_devices 已有 first_seen / last_seen / device_name / user_agent / last_ip 列，
-- security_register_device() 按 (user_id, device_id) 注册设备并写 first_seen，但不写设备型号和 IP；request_ip() 从请求头取 IP。
-- 这里不改 security_register_device（设备安全的核心函数），只新增：
--   login_alert_acks 表：每个账号「已确认看过」的时间点（前端不能直接读写）
--   note_login_device()：本人给自己的设备补上型号描述和 IP（只能改自己的、只改这三列）
--   my_login_alerts()：返回本账号的设备列表 + 上次确认之后新出现的「其他设备」
--   ack_login_alerts()：标记已看过
-- 「新设备」= first_seen 晚于上次确认时间、且不是当前这台设备。第一次调用时只建立基准，不对历史设备报警。
-- 回滚：drop function if exists public.my_login_alerts(text), public.ack_login_alerts(), public.note_login_device(text, text, text); drop table if exists public.login_alert_acks;

-- ===== 第 1 段 =====
create table if not exists public.login_alert_acks (user_id uuid primary key references auth.users(id) on delete cascade, seen_at timestamptz not null default now());
alter table public.login_alert_acks enable row level security;
revoke all on public.login_alert_acks from anon, authenticated;
create or replace function public.note_login_device(p_device_id text, p_label text, p_user_agent text) returns void language sql security definer set search_path to 'public' as $f$ update public.security_devices set device_name = left(nullif(btrim(p_label), ''), 60), user_agent = left(nullif(btrim(p_user_agent), ''), 300), last_ip = coalesce(public.request_ip(), last_ip) where user_id = auth.uid() and device_id = btrim(p_device_id); $f$;
create or replace function public.ack_login_alerts() returns void language sql security definer set search_path to 'public' as $f$ insert into public.login_alert_acks (user_id, seen_at) values (auth.uid(), now()) on conflict (user_id) do update set seen_at = now(); $f$;

-- ===== 第 2 段 =====
create or replace function public.my_login_alerts(p_device_id text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); base timestamptz; begin if uid is null then return jsonb_build_object('ok', false); end if; select seen_at into base from public.login_alert_acks where user_id = uid; if base is null then insert into public.login_alert_acks (user_id, seen_at) values (uid, now()) on conflict (user_id) do nothing; base := now(); end if; return jsonb_build_object('ok', true, 'since', base, 'devices', coalesce((select jsonb_agg(jsonb_build_object('device', left(d.device_id, 10), 'current', d.device_id = btrim(p_device_id), 'name', d.device_name, 'platform', d.platform, 'first_seen', d.first_seen, 'last_seen', greatest(d.last_seen, d.last_seen_at), 'ip', host(d.last_ip), 'status', d.status, 'is_new', d.first_seen > base and d.device_id <> btrim(p_device_id)) order by greatest(d.last_seen, d.last_seen_at) desc nulls last) from public.security_devices d where d.user_id = uid), '[]'::jsonb)); end $f$;
revoke execute on function public.note_login_device(text, text, text), public.ack_login_alerts(), public.my_login_alerts(text) from public, anon;
grant execute on function public.note_login_device(text, text, text), public.ack_login_alerts(), public.my_login_alerts(text) to authenticated;
select 'alert table' as check, count(*) as n from information_schema.tables where table_schema = 'public' and table_name = 'login_alert_acks'
union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('note_login_device', 'ack_login_alerts', 'my_login_alerts')
union all select 'anon blocked', count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('note_login_device', 'ack_login_alerts', 'my_login_alerts') and not has_function_privilege('anon', p.oid, 'execute');
-- 期望：alert table = 1，functions = 3，anon blocked = 3
