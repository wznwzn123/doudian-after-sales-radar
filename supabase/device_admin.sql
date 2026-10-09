-- 售后雷达 Pro 6.2 管理员设备/账号封禁（服务端函数）
--
-- 基于你数据库里已经存在的对象（已用真实库核对）：
--   * public.security_devices         设备表（RLS 已开启，anon/authenticated 没有任何直接权限）
--   * public.security_user_bans       账号封禁表（security_register_device 已经在用 is_user_banned() 检查它）
--   * public.security_events          安全事件日志
--   * public.admin_operation_logs     管理员操作日志（admin_list_logs() 读取它）
--   * public.is_admin()               管理员判断
-- 这里只新增 4 个函数，不新建表，不改现有函数的逻辑。
--
-- 设计说明：
--   * 全部是零参数或「单个 jsonb 参数」，避开 SQL Editor 在多参数函数上出现过的 42601。
--   * 管理员权限在数据库里校验（is_admin()），不是只在前端隐藏按钮。
--   * 只授权给 authenticated，anon 和 public 不可执行。
--   * blocked_by / 日志里的操作人都取 auth.uid()，前端无法伪造。

-- ------------------------------------------------------------------
-- 1) 列出所有设备（仅管理员）。
--    注意：security_register_device 只更新 last_seen，不更新 last_seen_at，所以「最后在线」取两者较大值。
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
        u.email::text as owner_email,
        d.device_name,
        d.device_id,
        d.platform,
        d.app_version,
        d.status,
        d.created_at,
        greatest(d.last_seen, d.last_seen_at) as last_seen_at,
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
-- 2) 封禁 / 解除封禁设备（仅管理员）。参数是一个 jsonb：
--    {"id":"<security_devices.id>","action":"block|unblock","reason":"...","current_device_id":"<管理员当前使用的设备ID>"}
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

  insert into public.security_events (user_id, device_id, event_type, severity, message, metadata)
  values (
    v_row.user_id,
    v_row.device_id,
    case when v_action = 'block' then 'manual_block' else 'manual_unblock' end,
    case when v_action = 'block' then 'warning' else 'info' end,
    case when v_action = 'block' then '管理员封禁设备：' || v_reason else '管理员解除设备封禁' end,
    jsonb_build_object('scope', 'device', 'action', v_action, 'reason', v_reason, 'admin_id', auth.uid())
  );

  insert into public.admin_operation_logs (user_id, action, detail)
  values (auth.uid(), 'device_' || v_action, v_row.device_id || coalesce(' / ' || nullif(v_reason, ''), ''));

  return jsonb_build_object('ok', true, 'id', v_id, 'action', v_action);
end;
$fn$;

-- ------------------------------------------------------------------
-- 3) 列出当前生效的账号封禁（仅管理员）
-- ------------------------------------------------------------------
create or replace function public.admin_list_account_bans()
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
    select jsonb_agg(to_jsonb(x) order by x.blocked_at desc)
    from (
      select
        b.user_id,
        u.email::text as owner_email,
        b.reason,
        b.blocked_at,
        b.expires_at,
        b.blocked_by
      from public.security_user_bans b
      left join auth.users u on u.id = b.user_id
      where b.status = 'blocked'
        and (b.expires_at is null or b.expires_at > now())
    ) x
  ), '[]'::jsonb);
end;
$fn$;

-- ------------------------------------------------------------------
-- 4) 封禁 / 解除封禁账号（仅管理员）。参数是一个 jsonb：
--    {"user_id":"<auth.users.id>","action":"block|unblock","reason":"..."}
--    使用现有 security_user_bans：与 is_user_banned() / security_register_device 的判断完全一致。
--    不能封自己，不能封其他管理员。
-- ------------------------------------------------------------------
create or replace function public.admin_set_account_ban(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid;
  v_action text;
  v_reason text;
  v_n integer := 0;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_uid := (payload ->> 'user_id')::uuid;
  v_action := payload ->> 'action';
  v_reason := btrim(coalesce(payload ->> 'reason', ''));

  if v_uid is null then
    raise exception 'user_id required' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = v_uid) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;

  if v_action = 'block' then
    if char_length(v_reason) < 2 then
      raise exception 'block reason required' using errcode = '22023';
    end if;
    if v_uid = auth.uid() then
      raise exception 'cannot block your own account' using errcode = '22023';
    end if;
    if exists (select 1 from public.admin_users where user_id = v_uid) then
      raise exception 'cannot block an admin account' using errcode = '22023';
    end if;

    update public.security_user_bans
       set reason = v_reason,
           blocked_at = now(),
           blocked_by = auth.uid(),
           manual_release_required = true,
           expires_at = null,
           updated_at = now()
     where user_id = v_uid and status = 'blocked';
    get diagnostics v_n = row_count;

    if v_n = 0 then
      insert into public.security_user_bans (user_id, status, reason, blocked_by, manual_release_required)
      values (v_uid, 'blocked', v_reason, auth.uid(), true);
    end if;
  elsif v_action = 'unblock' then
    update public.security_user_bans
       set status = 'released',
           updated_at = now()
     where user_id = v_uid and status = 'blocked';
  else
    raise exception 'invalid action' using errcode = '22023';
  end if;

  insert into public.security_events (user_id, event_type, severity, message, metadata)
  values (
    v_uid,
    case when v_action = 'block' then 'manual_block' else 'manual_unblock' end,
    case when v_action = 'block' then 'warning' else 'info' end,
    case when v_action = 'block' then '管理员封禁账号：' || v_reason else '管理员解除账号封禁' end,
    jsonb_build_object('scope', 'account', 'action', v_action, 'reason', v_reason, 'admin_id', auth.uid())
  );

  insert into public.admin_operation_logs (user_id, action, detail)
  values (auth.uid(), 'account_' || v_action, v_uid::text || coalesce(' / ' || nullif(v_reason, ''), ''));

  return jsonb_build_object('ok', true, 'user_id', v_uid, 'action', v_action);
end;
$fn$;

-- ------------------------------------------------------------------
-- 5) 函数权限：Supabase 默认会让 anon/authenticated 都能执行新函数，所以必须显式收回
-- ------------------------------------------------------------------
revoke all on function public.admin_list_devices() from public;
revoke all on function public.admin_list_devices() from anon;
grant execute on function public.admin_list_devices() to authenticated;

revoke all on function public.admin_set_device_status(jsonb) from public;
revoke all on function public.admin_set_device_status(jsonb) from anon;
grant execute on function public.admin_set_device_status(jsonb) to authenticated;

revoke all on function public.admin_list_account_bans() from public;
revoke all on function public.admin_list_account_bans() from anon;
grant execute on function public.admin_list_account_bans() to authenticated;

revoke all on function public.admin_set_account_ban(jsonb) from public;
revoke all on function public.admin_set_account_ban(jsonb) from anon;
grant execute on function public.admin_set_account_ban(jsonb) to authenticated;

-- 现有的 admin_list_security_devices()：已用真实库核对，目前就只授权给 authenticated（匿名不可执行），
-- 内部也有 is_admin() 校验。下面三行是幂等的，只是让源码和线上保持一致，前端不使用它。
revoke all on function public.admin_list_security_devices() from public;
revoke all on function public.admin_list_security_devices() from anon;
grant execute on function public.admin_list_security_devices() to authenticated;
