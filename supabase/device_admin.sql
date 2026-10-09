-- 售后雷达 Pro 6.2 管理员设备管理（服务端）
--
-- 执行方式（Supabase -> SQL Editor）：
--   1. 先执行 supabase/device_security_diagnostics.sql，确认现有表/函数/权限的真实情况。
--   2. 再按下面的编号，一段一段执行（每段单独粘贴、单独 Run，不要整份一次粘贴）。
--
-- 设计说明：
--   * 新函数只用「零参数」或「单个 jsonb 参数」，避开之前 SQL Editor 在多参数函数上反复出现的 42601。
--   * 管理员权限在数据库里校验（public.is_admin()），不是只在前端隐藏按钮。
--   * 两个函数都是 security definer，并且只授权给 authenticated，匿名和 public 不可调用。
--   * blocked_by 记录的是 auth.uid()（调用者自己的 UUID），前端无法伪造。

-- ------------------------------------------------------------------
-- 1) 列出所有设备（仅管理员）
-- ------------------------------------------------------------------
create or replace function public.admin_list_devices()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $fn$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc nulls last)
    from (
      select
        d.id,
        d.user_id,
        u.email as owner_email,
        d.device_name,
        d.device_id,
        d.platform,
        d.app_version,
        d.status,
        d.created_at,
        coalesce(d.last_seen_at, d.last_seen) as last_seen_at,
        d.blocked_at,
        d.blocked_reason,
        d.blocked_by
      from public.security_devices d
      left join auth.users u on u.id = d.user_id
    ) x
  ), '[]'::jsonb);
end;
$fn$;

-- ------------------------------------------------------------------
-- 2) 封禁 / 解除封禁（仅管理员）。参数是一个 jsonb：
--    {"id":"<security_devices.id>","action":"block|unblock","reason":"...","current_device_id":"<当前使用的设备ID>"}
-- ------------------------------------------------------------------
create or replace function public.admin_set_device_status(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
  v_action text;
  v_reason text;
  v_cur text;
  v_row public.security_devices%rowtype;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_id := (payload ->> 'id')::uuid;
  v_action := payload ->> 'action';
  v_reason := btrim(coalesce(payload ->> 'reason', ''));
  v_cur := btrim(coalesce(payload ->> 'current_device_id', ''));

  select * into v_row from public.security_devices where id = v_id for update;
  if not found then
    raise exception 'device not found' using errcode = 'P0002';
  end if;

  if v_action = 'block' then
    if char_length(v_reason) < 2 then
      raise exception 'block reason required' using errcode = '22023';
    end if;
    -- 防止管理员把自己正在用的设备封掉；没带当前设备ID时，管理员自己名下的设备一律不允许封
    if v_row.user_id = auth.uid() and (v_cur = '' or v_cur = v_row.device_id) then
      raise exception 'cannot block the admin current device' using errcode = '22023';
    end if;
    update public.security_devices
       set status = 'blocked',
           blocked_at = now(),
           blocked_reason = v_reason,
           blocked_by = auth.uid(),
           updated_at = now()
     where id = v_id;
  elsif v_action = 'unblock' then
    update public.security_devices
       set status = 'active',
           blocked_at = null,
           blocked_reason = null,
           blocked_by = null,
           updated_at = now()
     where id = v_id;
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'action', v_action);
end;
$fn$;

-- ------------------------------------------------------------------
-- 3) 函数权限：Supabase 默认会把新函数的 execute 给 anon/authenticated，所以必须显式收回
-- ------------------------------------------------------------------
revoke all on function public.admin_list_devices() from public;
revoke all on function public.admin_list_devices() from anon;
grant execute on function public.admin_list_devices() to authenticated;

revoke all on function public.admin_set_device_status(jsonb) from public;
revoke all on function public.admin_set_device_status(jsonb) from anon;
grant execute on function public.admin_set_device_status(jsonb) to authenticated;

-- ------------------------------------------------------------------
-- 4) 【先看诊断结果再执行】锁死 security_devices 的直接写入
--    目的：普通登录用户不能用 supabase.from('security_devices').update(...) 绕过 RPC 自己解封。
--    前提：diagnostics 里确认 security_register_device 是 security definer（prosecdef = true），
--          否则收回写权限会让设备注册失败。
-- ------------------------------------------------------------------
-- alter table public.security_devices enable row level security;
-- revoke insert, update, delete on public.security_devices from anon, authenticated;
