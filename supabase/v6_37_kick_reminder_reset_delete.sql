-- 售后雷达 Pro 6.36：被踢设备立刻退出 + 到期提醒邮件 + 手机号账号用提醒邮箱找回密码 + 新手机号注册通知管理员 + 自助注销账号
-- （需要在 SQL Editor 执行；分 3 段，每段末尾有核对查询）
-- 状态：待用户执行。可重复执行。
-- 写之前已用只读查询核对（2026-10-12）：
--   * 强制下线 / 删除设备 / 退出其他设备在服务端是生效的（被踢之后那个账号没有任何新的写入或上传），但被踢的网页要等每 2 分钟一次的复查才发现，
--     期间页面还停在工作台、按钮看起来能用。第 1 段让每个用户能读到「自己的」revoked_sessions 并加进 Realtime 发布，前端订阅后被踢瞬间就退出。
--   * 已有定时任务 after-sales-deadline-every-minute（process_after_sales_deadlines，到期后自动结案）；pg_cron 已装，pg_net 没装。
--     到期提醒用新的定时任务 + pg_net 调 Edge Function deadline-reminder（不影响原来的任务）。调用凭据是第 2 段随机生成、只存在数据库表 app_secrets 里的 cron_key。
--   * after_sales_tasks 的 deadline 和 deadline_at 两列 14 行完全一致，这里用 coalesce(deadline_at, deadline)，和原定时任务一样。
--   * 账号删除：auth.users 删除时，业务表（售后、事件、举证、资料库、店铺、快递记录、客服消息、设备会话等）都会 ON DELETE CASCADE；
--     不会跟着删的：security_devices、security_events、quota_counters、security_user_bans、security_ip_bans（没有外键）—— 由 delete_user_extras() 删除；
--     admin_operation_logs 保留（安全审计记录，协议里已说明）。storage.objects 有 protect_objects_delete 触发器，只能通过 Storage 接口删文件 ——
--     这就是 10/6 那 3 个孤儿文件（某个已删除账号的文件夹）的来历，Edge Function delete-account 会先删文件、确认删干净才删账号。
-- 回滚：见每段开头。

-- ===== 第 1 段：被踢的设备立刻退出 =====
-- 回滚：alter publication supabase_realtime drop table public.revoked_sessions; drop policy if exists revoked_sessions_own_read on public.revoked_sessions; revoke select on public.revoked_sessions from authenticated;
grant select on public.revoked_sessions to authenticated;
drop policy if exists revoked_sessions_own_read on public.revoked_sessions;
create policy revoked_sessions_own_read on public.revoked_sessions for select to authenticated using (user_id = (select auth.uid()));
do $$ begin if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'revoked_sessions') then alter publication supabase_realtime add table public.revoked_sessions; end if; end $$;
select 'realtime revoked_sessions' as check, count(*) as n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'revoked_sessions'
union all select 'own-row policy', count(*) from pg_policies where schemaname = 'public' and tablename = 'revoked_sessions' and policyname = 'revoked_sessions_own_read'
union all select 'no insert/update/delete for users', count(*) from (values ('insert'), ('update'), ('delete')) v(p) where not has_table_privilege('authenticated', 'public.revoked_sessions', p);
-- 期望：realtime revoked_sessions = 1，own-row policy = 1，no insert/update/delete for users = 3

-- ===== 第 2 段：到期提醒邮件 =====
-- 回滚：select cron.unschedule('deadline-reminder-mail'); drop function if exists public.deadline_reminders_due(); drop table if exists public.task_deadline_mails;
--       delete from public.app_secrets where name = 'cron_key';（pg_net 扩展可以留着）
create extension if not exists pg_net with schema extensions;
create table if not exists public.app_secrets (name text primary key, value text not null, created_at timestamptz not null default now());
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
grant select on public.app_secrets to service_role;
insert into public.app_secrets (name, value) values ('cron_key', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')) on conflict (name) do nothing;

create table if not exists public.task_deadline_mails (task_id uuid not null references public.after_sales_tasks(id) on delete cascade, kind text not null, sent_at timestamptz not null default now(), primary key (task_id, kind));
alter table public.task_deadline_mails enable row level security;
revoke all on public.task_deadline_mails from anon, authenticated;
grant select, delete on public.task_deadline_mails to service_role;

alter table public.login_alert_emails add column if not exists deadline_mail_off boolean not null default false;

-- 该发的提醒：待处理、1 小时内到期的售后；剩 30 分钟以内发「30」档，否则发「60」档（发过 30 档就不再补发 60 档）。
-- 收件人：已验证的提醒邮箱，没有就用已验证的登录邮箱；关了到期提醒、或账号被封禁的不发。先写进 task_deadline_mails 占位再返回，保证不重复。
create or replace function public.deadline_reminders_due() returns table(task_id uuid, kind text, email text, order_id text, buyer_name text, status text, deadline timestamptz, store_name text) language plpgsql security definer set search_path to 'public' as $f$ #variable_conflict use_column
begin return query with cand as (select t.id, t.user_id, t.order_id, t.buyer_name, t.status, coalesce(t.deadline_at, t.deadline) as dl, t.store_id, case when coalesce(t.deadline_at, t.deadline) - now() <= interval '30 minutes' then '30' else '60' end as k from public.after_sales_tasks t where t.submission_status = 'pending' and coalesce(t.deadline_at, t.deadline) > now() and coalesce(t.deadline_at, t.deadline) <= now() + interval '60 minutes'), target as (select c.*, coalesce(case when e.verified_at is not null then nullif(e.email, '') end, case when u.email_confirmed_at is not null then nullif(u.email, '') end) as mail, coalesce(e.deadline_mail_off, false) as off from cand c join auth.users u on u.id = c.user_id left join public.login_alert_emails e on e.user_id = c.user_id where not public.is_user_banned(c.user_id)), claimed as (insert into public.task_deadline_mails as m (task_id, kind) select x.id, x.k from target x where x.mail is not null and not x.off and not (x.k = '60' and exists (select 1 from public.task_deadline_mails m2 where m2.task_id = x.id and m2.kind = '30')) on conflict do nothing returning m.task_id, m.kind) select c2.task_id, c2.kind, x.mail, x.order_id, x.buyer_name, x.status, x.dl, s.name from claimed c2 join target x on x.id = c2.task_id left join public.shop_stores s on s.id = x.store_id; end $f$;
revoke execute on function public.deadline_reminders_due() from public, anon, authenticated;
grant execute on function public.deadline_reminders_due() to service_role;

-- 每 5 分钟调用一次 Edge Function（同名任务重复执行会覆盖，不会重复）
select cron.schedule('deadline-reminder-mail', '*/5 * * * *', $c$ select net.http_post(url := 'https://bdnazzywqqmliqyhhtig.supabase.co/functions/v1/deadline-reminder', headers := jsonb_build_object('Content-Type', 'application/json', 'x-radar-cron', (select value from public.app_secrets where name = 'cron_key')), body := '{}'::jsonb, timeout_milliseconds := 30000); $c$);

select 'pg_net' as check, count(*) as n from pg_extension where extname = 'pg_net'
union all select 'cron_key (only server)', count(*) from public.app_secrets where name = 'cron_key' and length(value) = 64 and not has_table_privilege('authenticated', 'public.app_secrets', 'select') and not has_table_privilege('anon', 'public.app_secrets', 'select')
union all select 'reminder function (server only)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'deadline_reminders_due' and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
union all select 'cron jobs', count(*) from cron.job where jobname in ('deadline-reminder-mail', 'after-sales-deadline-every-minute') and active;
-- 期望：pg_net = 1，cron_key (only server) = 1，reminder function (server only) = 1，cron jobs = 2

-- ===== 第 3 段：手机号账号找回密码 + 新注册通知管理员 + 自助注销 =====
-- 回滚：drop function if exists public.auth_user_by_phone(text), public.service_revoke_all_sessions(uuid), public.user_storage_paths(uuid), public.delete_user_extras(uuid, text);
--       alter table public.login_alert_emails drop column if exists rst_code_hash, drop column if exists rst_code_expires, drop column if exists rst_tries, drop column if exists admin_notified_at;
alter table public.login_alert_emails add column if not exists rst_code_hash text, add column if not exists rst_code_expires timestamptz, add column if not exists rst_tries integer not null default 0, add column if not exists admin_notified_at timestamptz;

-- 按手机号找账号（找回密码用；只有服务端能调，前端拿不到「这个号有没有注册」）
create or replace function public.auth_user_by_phone(p_phone text) returns uuid language sql stable security definer set search_path to 'public' as $f$ select u.id from auth.users u where u.phone = regexp_replace(btrim(coalesce(p_phone, '')), '^\+', '') and coalesce(p_phone, '') <> '' limit 1 $f$;

-- 作废某个账号的所有登录（找回密码后用；只有服务端能调）
create or replace function public.service_revoke_all_sessions(p_user uuid) returns integer language plpgsql security definer set search_path to 'public' as $f$ declare n int := 0; begin if p_user is null then return 0; end if; insert into public.revoked_sessions (session_id, user_id, device_id) select s.id, p_user, (select d.device_id from public.device_sessions d where d.session_id = s.id) from auth.sessions s where s.user_id = p_user on conflict (session_id) do nothing; delete from auth.sessions s where s.user_id = p_user; get diagnostics n = row_count; delete from public.device_sessions where user_id = p_user; return n; end $f$;

-- 注销账号：这个账号在证据桶里的全部文件路径（按文件夹前缀 + 数据库里登记的路径）
create or replace function public.user_storage_paths(p_user uuid) returns setof text language sql stable security definer set search_path to 'public' as $f$ select o.name from storage.objects o where o.bucket_id = 'after-sales-evidence' and p_user is not null and (o.name like p_user::text || '/%' or o.name in (select f.storage_path from public.evidence_files f where f.user_id = p_user union select l.storage_path from public.evidence_library l where l.user_id = p_user)) $f$;

-- 注销账号：删除不会随账号级联删除的记录，并写一条审计日志（审计日志本身保留）
create or replace function public.delete_user_extras(p_user uuid, p_label text) returns void language plpgsql security definer set search_path to 'public' as $f$ begin if p_user is null then return; end if; delete from public.security_devices where user_id = p_user; delete from public.security_events where user_id = p_user; delete from public.quota_counters where user_id = p_user; delete from public.security_user_bans where user_id = p_user; delete from public.security_ip_bans where user_id = p_user; insert into public.admin_operation_logs (user_id, action, detail) values (p_user, 'account_delete', '用户自助注销账号：' || coalesce(nullif(p_label, ''), left(p_user::text, 8))); end $f$;

-- 注销时检查「密码错太多次」的锁定要读计数表（v6_33 只给了函数权限）
grant select on public.quota_counters to service_role;
revoke execute on function public.auth_user_by_phone(text), public.service_revoke_all_sessions(uuid), public.user_storage_paths(uuid), public.delete_user_extras(uuid, text) from public, anon, authenticated;
grant execute on function public.auth_user_by_phone(text), public.service_revoke_all_sessions(uuid), public.user_storage_paths(uuid), public.delete_user_extras(uuid, text) to service_role;

select 'new columns' as check, count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'login_alert_emails' and column_name in ('deadline_mail_off', 'rst_code_hash', 'rst_code_expires', 'rst_tries', 'admin_notified_at')
union all select 'server-only functions', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('auth_user_by_phone', 'service_revoke_all_sessions', 'user_storage_paths', 'delete_user_extras') and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
-- 期望：new columns = 5，server-only functions = 4
