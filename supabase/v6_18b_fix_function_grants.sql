-- 补丁：v6_18 的审核函数默认对 PUBLIC 开放执行，revoke anon 没生效。改成只有登录用户（authenticated）能执行。
-- 影响：未登录的请求不能再调用这 4 个函数；登录用户和 RLS 策略不受影响。
revoke execute on function public.is_account_pending(uuid), public.my_account_status(), public.admin_list_pending_phone_users(), public.admin_approve_phone_user(uuid) from public, anon;
grant execute on function public.is_account_pending(uuid), public.my_account_status(), public.admin_list_pending_phone_users(), public.admin_approve_phone_user(uuid) to authenticated;
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_can, has_function_privilege('authenticated', p.oid, 'execute') as user_can from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('is_account_pending', 'my_account_status', 'admin_list_pending_phone_users', 'admin_approve_phone_user');
-- 期望：4 行，anon_can 全是 false，user_can 全是 true
