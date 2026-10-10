-- 售后雷达 Pro 6.18：手机号注册的账号需要管理员审核后才能使用（服务端强制）
-- 状态：已于 2026-10-10 由用户在 SQL Editor 分 3 段执行并核对（1 / 4 / 7）；当时的 revoke 只对 anon、没撤 PUBLIC，已在本文件修正，补丁见 v6_18b_fix_function_grants.sql。
-- 写之前已用只读查询核对：没有审核相关的表/函数；account_not_banned 限制性策略在 7 张业务表 + storage.objects（after-sales-evidence 桶）上，
-- 这里用同样的方式加 account_not_pending。客服表 support_messages 不加，待审核的用户以后仍可联系客服。
--
-- 「待审核」= 只有手机号、没有邮箱的账号，且不在审核通过表里，且不是管理员。邮箱注册的账号完全不受影响。
-- 回滚：对下面每张表 drop policy if exists account_not_pending on public.<表名>;
--       drop policy if exists account_not_pending_evidence on storage.objects;
--       drop function if exists public.admin_approve_phone_user(uuid), public.admin_list_pending_phone_users(), public.my_account_status(), public.is_account_pending(uuid);
--       drop table if exists public.phone_account_approvals;

-- ========== 审核通过记录（前端不能直接读写，只能通过下面的管理员函数）==========
create table if not exists public.phone_account_approvals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  approved_at timestamptz not null default now(),
  approved_by uuid
);
alter table public.phone_account_approvals enable row level security;
revoke all on public.phone_account_approvals from anon, authenticated;

-- ========== 判断是否待审核 ==========
create or replace function public.is_account_pending(p_user_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select exists (select 1 from auth.users u where u.id = p_user_id and coalesce(u.email, '') = '' and coalesce(u.phone, '') <> '')
     and not exists (select 1 from public.phone_account_approvals a where a.user_id = p_user_id)
     and not exists (select 1 from public.admin_users x where x.user_id = p_user_id);
$function$;

-- 当前登录用户自己的状态（前端进入系统时调用）
create or replace function public.my_account_status()
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$ select jsonb_build_object('pending', public.is_account_pending(auth.uid())); $function$;

-- ========== 管理员：待审核列表 / 通过审核（函数内校验管理员）==========
create or replace function public.admin_list_pending_phone_users()
 returns table(id uuid, phone text, created_at timestamptz, last_sign_in_at timestamptz)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$begin
  if not exists(select 1 from public.admin_users where user_id = auth.uid()) then raise exception '没有管理员权限'; end if;
  return query select u.id, u.phone::text, u.created_at, u.last_sign_in_at from auth.users u
    where coalesce(u.email, '') = '' and coalesce(u.phone, '') <> ''
      and not exists (select 1 from public.phone_account_approvals a where a.user_id = u.id)
      and not exists (select 1 from public.admin_users x where x.user_id = u.id)
    order by u.created_at desc;
end$function$;

create or replace function public.admin_approve_phone_user(p_user_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$begin
  if not exists(select 1 from public.admin_users where user_id = auth.uid()) then return jsonb_build_object('ok', false, 'message', '没有管理员权限'); end if;
  if not exists(select 1 from auth.users where id = p_user_id) then return jsonb_build_object('ok', false, 'message', '找不到该账号'); end if;
  insert into public.phone_account_approvals(user_id, approved_by) values (p_user_id, auth.uid()) on conflict (user_id) do nothing;
  return jsonb_build_object('ok', true, 'message', '已通过审核');
end$function$;

-- 注意：函数默认对 PUBLIC 开放执行，只 revoke anon 不够；要先 revoke public 再只授权 authenticated（RLS 策略里用到 is_account_pending，authenticated 必须能执行）
revoke execute on function public.is_account_pending(uuid), public.my_account_status(), public.admin_list_pending_phone_users(), public.admin_approve_phone_user(uuid) from public, anon;
grant execute on function public.is_account_pending(uuid), public.my_account_status(), public.admin_list_pending_phone_users(), public.admin_approve_phone_user(uuid) to authenticated;

-- ========== 服务端强制：待审核账号读写不了任何业务数据 ==========
drop policy if exists account_not_pending on public.after_sales_tasks;
create policy account_not_pending on public.after_sales_tasks as restrictive for all to authenticated
  using (not (select public.is_account_pending((select auth.uid())))) with check (not (select public.is_account_pending((select auth.uid()))));
drop policy if exists account_not_pending on public.after_sales_events;
create policy account_not_pending on public.after_sales_events as restrictive for all to authenticated
  using (not (select public.is_account_pending((select auth.uid())))) with check (not (select public.is_account_pending((select auth.uid()))));
drop policy if exists account_not_pending on public.evidence_files;
create policy account_not_pending on public.evidence_files as restrictive for all to authenticated
  using (not (select public.is_account_pending((select auth.uid())))) with check (not (select public.is_account_pending((select auth.uid()))));
drop policy if exists account_not_pending on public.evidence_library;
create policy account_not_pending on public.evidence_library as restrictive for all to authenticated
  using (not (select public.is_account_pending((select auth.uid())))) with check (not (select public.is_account_pending((select auth.uid()))));
drop policy if exists account_not_pending on public.shop_stores;
create policy account_not_pending on public.shop_stores as restrictive for all to authenticated
  using (not (select public.is_account_pending((select auth.uid())))) with check (not (select public.is_account_pending((select auth.uid()))));
drop policy if exists account_not_pending on public.tracking_records;
create policy account_not_pending on public.tracking_records as restrictive for all to authenticated
  using (not (select public.is_account_pending((select auth.uid())))) with check (not (select public.is_account_pending((select auth.uid()))));
drop policy if exists account_not_pending_evidence on storage.objects;
create policy account_not_pending_evidence on storage.objects as restrictive for all to authenticated
  using ((bucket_id <> 'after-sales-evidence') or (not (select public.is_account_pending((select auth.uid())))))
  with check ((bucket_id <> 'after-sales-evidence') or (not (select public.is_account_pending((select auth.uid())))));

-- ========== 执行后核对（只读）==========
select 'approval table' as check, count(*) as n from information_schema.tables where table_schema='public' and table_name='phone_account_approvals'
union all
select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_account_pending','my_account_status','admin_list_pending_phone_users','admin_approve_phone_user')
union all
select 'pending policies', count(*) from pg_policies where policyname in ('account_not_pending','account_not_pending_evidence');
-- 期望：approval table = 1，functions = 4，pending policies = 7
