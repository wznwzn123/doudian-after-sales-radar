-- 售后雷达 Pro 6.2 设备安全诊断（只读，不修改任何数据）
-- 在 Supabase -> SQL Editor 里，一条一条执行下面的查询，把结果发给我（不含任何密钥）。

-- A) 现有设备相关函数：参数签名、是否 security definer、谁有执行权限
select p.oid::regprocedure as signature,
       p.prosecdef as security_definer,
       p.proacl as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'security\_%' or p.proname like 'admin\_%' or p.proname = 'is_admin')
order by 1;

-- B) security_register_device 的完整定义（重点：它会不会覆盖 status、会不会在 blocked 时仍更新为 active）
select pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'security_register_device';

-- C) security_devices 的 RLS 是否开启、有哪些策略
select c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'security_devices';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'security_devices';

-- D) anon / authenticated 对 security_devices 的直接表权限
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'security_devices'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type;

-- E) 字段类型与约束（确认 status、blocked_by 的类型，以及 status 是否有 check 约束）
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'security_devices'
order by ordinal_position;

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.security_devices'::regclass;

-- F) 当前所有设备（只看状态，不含公钥）
select id, user_id, device_id, platform, app_version, status, blocked_at, blocked_reason, blocked_by, last_seen_at
from public.security_devices
order by created_at;
