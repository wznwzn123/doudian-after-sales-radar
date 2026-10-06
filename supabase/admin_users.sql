-- 售后雷达 Pro 5.0 管理员权限
-- 先在 Supabase -> Authentication -> Users 找到你的账号 UUID，替换下面的 YOUR_USER_UUID 后执行。

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- 把 YOUR_USER_UUID 替换成你的登录账号 UUID 后再执行：
-- insert into public.admin_users(user_id) values ('YOUR_USER_UUID') on conflict do nothing;
