-- 售后雷达 Pro 6.16：售后金额 + 在线客服 + 手机号用户在管理后台显示
-- 状态：已于 2026-10-10 由用户在 Supabase SQL Editor 执行，并用只读查询核对（2 / 1 / 5）。可重复执行。
-- 写之前已用只读查询核对：after_sales_tasks 没有金额列；没有 support_messages 表；
-- is_admin()、is_user_banned() 已存在（security definer，可直接复用，不重复创建）；
-- supabase_realtime 发布里没有任何表（所以前端用定时刷新，不依赖 Realtime）。
--
-- 回滚（需要时）：
--   alter table public.after_sales_tasks drop column if exists order_amount, drop column if exists refund_amount;
--   drop table if exists public.support_messages;
--   以及把 admin_list_all_users 改回 u.email::text（见文末注释）。

-- ========== 1) 售后金额（手动填写，可以为空，不能为负）==========
alter table public.after_sales_tasks
  add column if not exists order_amount numeric(12,2),
  add column if not exists refund_amount numeric(12,2);
alter table public.after_sales_tasks drop constraint if exists after_sales_tasks_order_amount_nonneg;
alter table public.after_sales_tasks add constraint after_sales_tasks_order_amount_nonneg check (order_amount is null or order_amount >= 0);
alter table public.after_sales_tasks drop constraint if exists after_sales_tasks_refund_amount_nonneg;
alter table public.after_sales_tasks add constraint after_sales_tasks_refund_amount_nonneg check (refund_amount is null or refund_amount >= 0);
-- 现有 RLS（user_id = auth.uid() 等）对新列同样生效，不需要新策略。

-- ========== 2) 在线客服 ==========
-- 每个用户一个会话（user_id = 会话所属用户），sender 区分是用户发的还是管理员回复的。
create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sender text not null check (sender in ('user', 'admin')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists support_messages_user_created_idx on public.support_messages (user_id, created_at);
alter table public.support_messages enable row level security;

-- 权限：只能读、发；只能改 read_at（标记已读），不能改内容、不能删
revoke all on public.support_messages from anon, authenticated;
grant select, insert on public.support_messages to authenticated;
grant update (read_at) on public.support_messages to authenticated;

-- 读：自己的会话；管理员看全部（管理员身份在服务端用 is_admin() 校验，不靠前端隐藏按钮）
drop policy if exists support_select on public.support_messages;
create policy support_select on public.support_messages for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- 发：用户只能以 user 身份发到自己的会话；管理员只能以 admin 身份回复
drop policy if exists support_insert_user on public.support_messages;
create policy support_insert_user on public.support_messages for insert to authenticated
  with check (user_id = (select auth.uid()) and sender = 'user');
drop policy if exists support_insert_admin on public.support_messages;
create policy support_insert_admin on public.support_messages for insert to authenticated
  with check ((select public.is_admin()) and sender = 'admin');

-- 标记已读：用户只能标记管理员发给自己的；管理员只能标记用户发来的
drop policy if exists support_mark_read on public.support_messages;
create policy support_mark_read on public.support_messages for update to authenticated
  using ((user_id = (select auth.uid()) and sender = 'admin') or ((select public.is_admin()) and sender = 'user'))
  with check ((user_id = (select auth.uid()) and sender = 'admin') or ((select public.is_admin()) and sender = 'user'));

-- 和其他业务表一致：被封账号一律拒绝
drop policy if exists account_not_banned on public.support_messages;
create policy account_not_banned on public.support_messages
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

-- ========== 3) 管理后台用户列表：手机号注册的用户没有邮箱，显示手机号 ==========
-- 只改一处：u.email::text -> coalesce(nullif(u.email,''), u.phone)::text；返回列、权限校验都不变。
create or replace function public.admin_list_all_users()
 returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, task_count bigint, is_admin boolean)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception '没有管理员权限'; end if; return query select u.id,coalesce(nullif(u.email,''),u.phone)::text,u.created_at,u.last_sign_in_at,(select count(*) from public.after_sales_tasks t where t.user_id=u.id)::bigint,exists(select 1 from public.admin_users a where a.user_id=u.id) from auth.users u order by u.created_at desc; end$function$;
-- 回滚：把上面的 coalesce(nullif(u.email,''),u.phone)::text 改回 u.email::text 再执行一次。

-- ========== 执行后核对（只读）==========
select 'amount columns' as check, count(*) as n from information_schema.columns
  where table_schema='public' and table_name='after_sales_tasks' and column_name in ('order_amount','refund_amount')
union all
select 'support table', count(*) from information_schema.tables where table_schema='public' and table_name='support_messages'
union all
select 'support policies', count(*) from pg_policies where schemaname='public' and tablename='support_messages';
-- 期望：amount columns = 2，support table = 1，support policies = 5
