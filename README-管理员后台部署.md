# 售后雷达 Pro 5.0 管理员后台

本版本不是“后门”，而是受 Supabase Auth + RLS + Edge Function 保护的管理员后台。

## 1. 创建管理员表
在 Supabase -> SQL Editor 执行：

`supabase/admin_users.sql`

## 2. 把自己的账号加入管理员
进入 Supabase -> Authentication -> Users，复制你自己的 User UID。

执行：

```sql
insert into public.admin_users(user_id)
values ('你的User UID')
on conflict (user_id) do nothing;
```

## 3. 部署 Edge Function
把 `supabase/functions/admin-users/index.ts` 部署成 Supabase Edge Function，名称必须是：

`admin-users`

该函数使用 Supabase 的 `SUPABASE_SERVICE_ROLE_KEY` 读取 Auth 用户邮箱；service_role 只存在 Edge Function 服务端环境，不放进前端。

如果你使用 Supabase CLI：

```bash
supabase functions deploy admin-users
```

## 4. 使用
重新登录网站后，顶部会出现：

`管理后台`

管理员可以看到：
- 注册用户总数
- 当前在线人数
- 24 小时活跃人数
- 所有用户邮箱
- 用户 UUID
- 注册时间
- 最后登录时间
- 每个用户的售后任务数量

普通用户不会看到管理员按钮，也不能直接读取 `auth.users`。

## 安全注意
不要把 `service_role` Key 写进 index.html，也不要把它放进 GitHub Pages。所有读取邮箱的操作必须经过 Edge Function，并在服务端检查 `admin_users`。
