-- 售后雷达 Pro 6.24 / 6.25：新设备登录邮件提醒（手机号账号可以绑定一个提醒邮箱）+ 换绑登录手机号 / 登录邮箱
-- 状态：待用户在 Supabase SQL Editor 执行（一段，可重复执行）。前提：v6_23_login_alerts.sql 的两段都已执行（邮件提醒要用 my_login_alerts）。
-- 写之前已用只读查询核对：
--   * 本项目 public 下新建表的默认权限不给 service_role 读写（只有 TRUNCATE/REFERENCES/TRIGGER），所以下面要显式 grant 给 service_role；
--   * security_devices 没有任何策略、authenticated 也没有权限，Edge Function 不直接读它，而是用调用者身份调 my_login_alerts()（只返回本人设备）；
--   * admin_operation_logs 同样没有给 service_role insert —— 6.21 的「重置密码」审计记录因此一直没写进去（2 次重置都没有记录），这里一并补上。
-- 提醒邮箱存在新表里，不改 auth.users.email，所以 is_account_pending()（手机号账号审核）完全不受影响。
-- 换绑（6.25）的操作会写进 admin_operation_logs（action = change_phone / change_email，user_id = 本人），管理后台「日志」里能看到。
-- 两张新表前端都不能直接读写，只有 login-alert-mail 这个 Edge Function（服务端 secret key）能读写。
-- 回滚：drop table if exists public.login_alert_mails, public.login_alert_emails; revoke insert on public.admin_operation_logs from service_role;

create table if not exists public.login_alert_emails (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  verified_at timestamptz,
  pending_email text,
  code_hash text,
  code_expires timestamptz,
  code_tries integer not null default 0,
  last_sent_at timestamptz,
  sent_count integer not null default 0,
  sent_window timestamptz,
  prompt_declined_at timestamptz,
  chg_email text,
  chg_code_hash text,
  chg_code_expires timestamptz,
  chg_tries integer not null default 0,
  pw_fail_count integer not null default 0,
  pw_fail_at timestamptz,
  updated_at timestamptz not null default now()
);
-- 6.25 换绑用的列（chg_* = 换绑登录邮箱的验证码；pw_fail_* = 换绑时输错当前密码的次数）。表已经建过时也能补上：
alter table public.login_alert_emails add column if not exists chg_email text, add column if not exists chg_code_hash text, add column if not exists chg_code_expires timestamptz, add column if not exists chg_tries integer not null default 0, add column if not exists pw_fail_count integer not null default 0, add column if not exists pw_fail_at timestamptz;
alter table public.login_alert_emails enable row level security;
revoke all on public.login_alert_emails from anon, authenticated;
grant select, insert, update, delete on public.login_alert_emails to service_role;

create table if not exists public.login_alert_mails (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, device_id)
);
alter table public.login_alert_mails enable row level security;
revoke all on public.login_alert_mails from anon, authenticated;
grant select, insert, delete on public.login_alert_mails to service_role;

grant insert on public.admin_operation_logs to service_role;

select 'tables' as check, count(*) as n from information_schema.tables where table_schema = 'public' and table_name in ('login_alert_emails', 'login_alert_mails')
union all select 'service grants', count(*) from (values ('login_alert_emails'), ('login_alert_mails'), ('admin_operation_logs')) t(x) where has_table_privilege('service_role', 'public.' || x, 'insert')
union all select 'client blocked', count(*) from (values ('login_alert_emails'), ('login_alert_mails')) t(x) where not has_table_privilege('authenticated', 'public.' || x, 'select') and not has_table_privilege('anon', 'public.' || x, 'select')
union all select 'rebind columns', count(*) from information_schema.columns where table_schema = 'public' and table_name = 'login_alert_emails' and column_name in ('chg_email', 'chg_code_hash', 'chg_code_expires', 'chg_tries', 'pw_fail_count', 'pw_fail_at');
-- 期望：tables = 2，service grants = 3，client blocked = 2，rebind columns = 6
