-- 售后雷达 Pro 6.35：打开「多设备即时同步」+ 补索引（需要在 SQL Editor 执行，一段）
-- 状态：待用户执行。可重复执行。
-- 写之前已用只读查询核对（2026-10-12）：
--   * 前端 subscribeRealtime() 订阅了 after_sales_tasks、evidence_files 的 postgres_changes（按 user_id 过滤），收到后 0.4 秒合并刷新、正在输入时不重开详情；
--     但 supabase_realtime 发布里一张表都没有（pg_publication_tables 为空），所以这个功能一直没生效 —— 另一台设备改了售后，这台要手动刷新才看得到。
--     加进发布后，Realtime 按订阅者自己的身份检查 RLS（account_not_banned / account_not_pending / session_not_revoked 照样生效），每人只收到自己的变更。
--     发布是 insert/update/delete 都发；两张表 replica identity = default（删除事件不带完整旧行，按 user_id 过滤的订阅收不到删除，前端其他刷新会补上，不影响）。
--   * Supabase 性能检查：3 个外键没有索引 —— tracking_records(task_id)（查物流、打开售后详情都按它查）、revoked_sessions(user_id)、evidence_library(store_id)；
--     admin_users 没有主键（只有唯一约束 admin_users_user_id_unique，没有外键引用它）。数据量很小（售后 11 条、快递记录 6 条），建索引瞬间完成。
-- 回滚：alter publication supabase_realtime drop table public.after_sales_tasks, public.evidence_files;
--       drop index if exists public.tracking_records_task_id_idx, public.revoked_sessions_user_id_idx, public.evidence_library_store_id_idx;
--       alter table public.admin_users drop constraint admin_users_pkey, add constraint admin_users_user_id_unique unique (user_id);

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'after_sales_tasks') then
    alter publication supabase_realtime add table public.after_sales_tasks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'evidence_files') then
    alter publication supabase_realtime add table public.evidence_files;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.admin_users'::regclass and contype = 'p') then
    alter table public.admin_users drop constraint if exists admin_users_user_id_unique, add constraint admin_users_pkey primary key (user_id);
  end if;
end $$;
create index if not exists tracking_records_task_id_idx on public.tracking_records (task_id);
create index if not exists revoked_sessions_user_id_idx on public.revoked_sessions (user_id);
create index if not exists evidence_library_store_id_idx on public.evidence_library (store_id);

select 'realtime tables' as check, count(*) as n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('after_sales_tasks', 'evidence_files')
union all select 'new indexes', count(*) from pg_indexes where schemaname = 'public' and indexname in ('tracking_records_task_id_idx', 'revoked_sessions_user_id_idx', 'evidence_library_store_id_idx')
union all select 'admin_users pk', count(*) from pg_constraint where conrelid = 'public.admin_users'::regclass and contype = 'p';
-- 期望：realtime tables = 2，new indexes = 3，admin_users pk = 1
