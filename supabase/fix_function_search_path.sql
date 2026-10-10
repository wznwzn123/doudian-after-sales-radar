-- 售后雷达：给触发器函数 sync_after_sales_deadline 固定 search_path
--
-- Supabase 安全检查提示（WARN）：public.sync_after_sales_deadline 的 search_path 不固定。
-- 已用只读查询核对：它是 after_sales_tasks 上 BEFORE INSERT/UPDATE 触发器 trg_sync_after_sales_deadline 的函数，
-- SECURITY INVOKER，函数体只读写 NEW 的字段并调用 NOW()，不引用任何表或自定义函数。
-- 所以只需要固定 search_path，不改函数逻辑，不影响现有功能。
--
-- 状态：已于 2026-10-10 在生产库执行（手动，Supabase SQL Editor），已用只读查询确认 search_path 已固定，安全检查对应警告消失。
-- 回滚：alter function public.sync_after_sales_deadline() reset search_path;

alter function public.sync_after_sales_deadline() set search_path = public, pg_catalog;
