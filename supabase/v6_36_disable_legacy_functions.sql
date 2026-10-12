-- 售后雷达 Pro 6.36：暂停 10 个网页没有用到的旧函数（不删除，以后做安卓 App 时可以一行恢复）
-- 状态：待用户执行。可重复执行。
-- 背景：用户说目前没有安卓 App，但以后考虑做。这些函数看起来是给 App 用的（设备授权、版本检查、安全详情等），网页里一次都没调用；
--   每个能被前端调用的 security definer 函数都是一个攻击入口，所以先收回前端（anon / authenticated）的执行权限，保留定义。
-- 写之前已用只读查询核对（2026-10-12）：
--   * 没有任何 RLS 策略、触发器、视图用到它们；
--   * admin_guard() 被 admin_list_all_evidence()、admin_list_logs() 在内部调用 —— 这两个都是 security definer（属主 postgres），
--     内部调用按属主的权限检查，不受影响（本地 PostgreSQL 实测：收回 authenticated 的权限后，管理员调 admin_list_logs() 照常返回）；
--   * current_device_id() 只被 security_check()（也在这次暂停的名单里）调用；admin_set_device_status 里出现的是 payload 的同名字段，不是调用。
-- 以后做 App 需要哪个，就单独恢复：grant execute on function public.函数名(参数类型) to authenticated;（参数见下面）
-- 回滚（全部恢复）：把下面 revoke 那几行的 revoke … from 改成 grant … to authenticated 再执行。

revoke execute on function
  public.security_check(),
  public.security_app_check(text, text),
  public.security_authorize_device(text, text, text),
  public.current_device_id(),
  public.admin_guard(),
  public.admin_list_security_bans(),
  public.admin_get_security_detail(uuid),
  public.admin_security_release_all(uuid),
  public.admin_list_security_devices(),
  public.admin_list_stores()
from public, anon, authenticated;

select 'still callable by users' as check, count(*) as n from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('security_check', 'security_app_check', 'security_authorize_device', 'current_device_id', 'admin_guard', 'admin_list_security_bans', 'admin_get_security_detail', 'admin_security_release_all', 'admin_list_security_devices', 'admin_list_stores')
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
union all select 'kept (not deleted)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('security_check', 'security_app_check', 'security_authorize_device', 'current_device_id', 'admin_guard', 'admin_list_security_bans', 'admin_get_security_detail', 'admin_security_release_all', 'admin_list_security_devices', 'admin_list_stores')
union all select 'admin pages still work', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
  and p.proname in ('admin_list_all_evidence', 'admin_list_logs') and has_function_privilege('authenticated', p.oid, 'execute');
-- 期望：still callable by users = 0，kept (not deleted) = 10，admin pages still work = 2
