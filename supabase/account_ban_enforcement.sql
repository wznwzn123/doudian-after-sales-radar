-- 售后雷达 Pro 6.2 账号封禁：服务端强制
--
-- 现状（已用真实库核对）：账号封禁只在 security_register_device / security_check 里检查，
-- 也就是依赖前端调用；业务表的 RLS 只校验 user_id = auth.uid()。
-- 被封账号如果绕过前端直接调 API，仍然能读写自己名下的数据。
--
-- 这里给业务表和存储桶加「限制性（restrictive）策略」：被封账号（is_user_banned）一律拒绝。
-- 限制性策略和现有策略是「且」的关系，所以不会放宽任何现有权限；未被封的用户完全不受影响。
-- 状态：已于 2026-10-10 在生产库执行（手动，Supabase SQL Editor）。
-- 回滚：对每张表执行  drop policy account_not_banned on public.<表名>;  存储桶：drop policy account_not_banned_evidence on storage.objects;
--
-- is_user_banned 判断：security_user_bans 里有 status='blocked' 且未过期的记录。
-- 管理员的 RPC 函数是 security definer，不受这些策略影响。

drop policy if exists account_not_banned on public.after_sales_tasks;
create policy account_not_banned on public.after_sales_tasks
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

drop policy if exists account_not_banned on public.after_sales_events;
create policy account_not_banned on public.after_sales_events
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

drop policy if exists account_not_banned on public.evidence_files;
create policy account_not_banned on public.evidence_files
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

drop policy if exists account_not_banned on public.evidence_library;
create policy account_not_banned on public.evidence_library
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

drop policy if exists account_not_banned on public.shop_stores;
create policy account_not_banned on public.shop_stores
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

drop policy if exists account_not_banned on public.tracking_records;
create policy account_not_banned on public.tracking_records
  as restrictive for all to authenticated
  using (not (select public.is_user_banned((select auth.uid()))))
  with check (not (select public.is_user_banned((select auth.uid()))));

-- 证据文件存储桶：只限制 after-sales-evidence 这个桶，其他桶不受影响
drop policy if exists account_not_banned_evidence on storage.objects;
create policy account_not_banned_evidence on storage.objects
  as restrictive for all to authenticated
  using (bucket_id <> 'after-sales-evidence' or not (select public.is_user_banned((select auth.uid()))))
  with check (bucket_id <> 'after-sales-evidence' or not (select public.is_user_banned((select auth.uid()))));
