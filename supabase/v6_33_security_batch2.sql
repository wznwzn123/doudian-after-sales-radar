-- 售后雷达 Pro 6.33：安全审计第 2 批（需要在 SQL Editor 执行；分 2 段，每段末尾有核对查询）+ 管理后台「最近活跃」
-- 状态：待用户执行。可重复执行。
-- 写之前已用只读查询核对（2026-10-11）：
--   * 下面新建的 5 个函数名在库里都不存在；revoked_sessions / device_sessions（v6_27）已存在；
--   * after_sales_tasks 现有数据里没有「store_id 指向别人店铺」的行（0 行），加限制性策略不会让现有售后改不动；
--   * admin_users 前端只有 select 权限，所以 insert_self / update_self 两条策略目前用不上（潜在风险），直接删除；
--   * 重复索引：admin_users(user_id) 两个唯一索引（约束用的是 admin_users_user_id_unique，删另一个）、
--     after_sales_tasks(user_id) 两个、after_sales_tasks(store_id) 两个 —— 都是完全相同的定义，删掉多余的；
--   * 存储桶 after-sales-evidence 现有文件：jpeg 3 个（最大 1.2MB）、mp4 2 个（最大 50.7MB）；前端 accept = 图片/视频/pdf/doc/docx/xls/xlsx/txt；
--   * 「最后登录」不刷新的原因：auth.users.last_sign_in_at 只在输入密码登录时更新，一直保持登录（刷新令牌）不会更新；
--     例：一个 iPhone 微信账号 last_sign_in_at 停在 10-07，但设备 last_seen 是今天。所以新增 admin_user_activity() 取「最近活跃」
--     = 最后登录、设备最后出现、登录会话最后刷新 三者最晚的那个。
-- 回滚（第 1 段）：drop function if exists public.take_quota(uuid, text, integer, integer), public.auth_identity_taken(uuid, text, text),
--       public.revoke_other_sessions(), public.admin_revoke_user_sessions(uuid), public.admin_user_activity(); drop table if exists public.quota_counters;
--       再执行一次 v6_27 第 1 段的 remove_my_device 恢复旧版本。
-- 回滚（第 2 段）：见第 2 段开头注释。

-- ===== 第 1 段：函数（只新增 / 替换函数，不改表结构，不影响现有数据）=====

-- 服务端计数器（快递100 查询额度、换绑查重次数）。只有服务端（Edge Function 的 secret key）能调用，前端碰不到。
create table if not exists public.quota_counters (user_id uuid not null, bucket text not null, window_start timestamptz not null default now(), n integer not null default 0, primary key (user_id, bucket));
alter table public.quota_counters enable row level security;
revoke all on public.quota_counters from anon, authenticated;

-- 固定窗口计数：窗口过期就从 1 重新计；返回这次是否还在额度内
create or replace function public.take_quota(p_user uuid, p_bucket text, p_limit integer, p_window_seconds integer) returns boolean language plpgsql security definer set search_path to 'public' as $f$ declare ok boolean; begin if p_user is null or coalesce(p_bucket, '') = '' or coalesce(p_limit, 0) < 1 or coalesce(p_window_seconds, 0) < 1 then return false; end if; insert into public.quota_counters as q (user_id, bucket, window_start, n) values (p_user, left(p_bucket, 100), now(), 1) on conflict (user_id, bucket) do update set window_start = case when q.window_start <= now() - make_interval(secs => p_window_seconds) then now() else q.window_start end, n = case when q.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else q.n + 1 end returning n <= p_limit into ok; return ok; end $f$;

-- 换绑前查「手机号 / 邮箱是否已被别的账号用」：代替 Edge Function 里逐页扫描全部用户
create or replace function public.auth_identity_taken(p_user uuid, p_kind text, p_value text) returns boolean language sql stable security definer set search_path to 'public' as $f$ select case when p_kind = 'email' then exists (select 1 from auth.users u where u.id <> p_user and lower(u.email) = lower(btrim(p_value))) when p_kind = 'phone' then exists (select 1 from auth.users u where u.id <> p_user and u.phone = regexp_replace(btrim(p_value), '^\+', '')) else null end $f$;

-- 退出其他所有设备（修改密码后自动调用；「登录记录」里也有按钮）：
-- 除了当前这个登录，其余登录全部记进 revoked_sessions（还没过期的访问令牌也立刻读写不了数据）并从 auth.sessions 删除（刷新令牌作废）
create or replace function public.revoke_other_sessions() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); sid text := coalesce(auth.jwt() ->> 'session_id', ''); n int := 0; begin if uid is null then return jsonb_build_object('ok', false, 'message', '请先登录'); end if; if sid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok', false, 'message', '无法识别当前登录，请重新登录后再试'); end if; if public.is_session_revoked() then return jsonb_build_object('ok', false, 'message', '这台设备的登录已失效，请重新登录'); end if; insert into public.revoked_sessions (session_id, user_id, device_id) select s.id, uid, (select d.device_id from public.device_sessions d where d.session_id = s.id) from auth.sessions s where s.user_id = uid and s.id::text <> sid on conflict (session_id) do nothing; delete from auth.sessions s where s.user_id = uid and s.id::text <> sid; get diagnostics n = row_count; delete from public.device_sessions where user_id = uid and session_id::text <> sid; insert into public.admin_operation_logs (user_id, action, detail) values (uid, 'logout_others', '退出了其他所有设备（' || n || ' 个登录）'); return jsonb_build_object('ok', true, 'sessions', n); end $f$;

-- 管理员让某个账号的所有设备退出登录（管理员重置密码后自动调用）。服务端校验管理员。
create or replace function public.admin_revoke_user_sessions(p_user_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); n int := 0; label text; begin if uid is null or not exists (select 1 from public.admin_users a where a.user_id = uid) then raise exception '没有管理员权限'; end if; if public.is_session_revoked() then return jsonb_build_object('ok', false, 'message', '这台设备的登录已失效，请重新登录'); end if; if p_user_id is null then return jsonb_build_object('ok', false, 'message', '用户编号不正确'); end if; if p_user_id = uid then return jsonb_build_object('ok', false, 'message', '不能对自己操作，请用「登录记录 → 退出其他所有设备」'); end if; select coalesce(nullif(u.email, ''), u.phone) into label from auth.users u where u.id = p_user_id; if not found then return jsonb_build_object('ok', false, 'message', '找不到该账号'); end if; insert into public.revoked_sessions (session_id, user_id, device_id) select s.id, p_user_id, (select d.device_id from public.device_sessions d where d.session_id = s.id) from auth.sessions s where s.user_id = p_user_id on conflict (session_id) do nothing; delete from auth.sessions s where s.user_id = p_user_id; get diagnostics n = row_count; delete from public.device_sessions where user_id = p_user_id; insert into public.admin_operation_logs (user_id, action, detail) values (uid, 'admin_logout_user', '让 ' || coalesce(label, left(p_user_id::text, 8)) || ' 的所有设备退出登录（' || n || ' 个登录）'); return jsonb_build_object('ok', true, 'sessions', n); end $f$;

-- 管理后台「最近活跃」：最后登录、设备最后出现、登录会话最后刷新 三者取最晚；同时给出最近用的设备名
create or replace function public.admin_user_activity() returns table(user_id uuid, last_active timestamptz, last_device text) language plpgsql stable security definer set search_path to 'public' as $f$ #variable_conflict use_column
begin if not exists (select 1 from public.admin_users a where a.user_id = auth.uid()) then raise exception '没有管理员权限'; end if; return query select u.id, greatest(u.last_sign_in_at, d.seen, s.seen), d.name from auth.users u left join lateral (select greatest(x.last_seen, x.last_seen_at) as seen, coalesce(nullif(x.device_name, ''), x.platform) as name from public.security_devices x where x.user_id = u.id order by greatest(x.last_seen, x.last_seen_at) desc nulls last limit 1) d on true left join lateral (select max(greatest(y.updated_at, y.created_at)) as seen from auth.sessions y where y.user_id = u.id) s on true; end $f$;

-- 删除设备（v6_27 的升级版）：除了那台设备上报过的登录，再把「从来没上报过、对不上任何设备」的登录也一并作废
-- （不配合的客户端 / 改过的网页不会上报自己的登录，以前删不掉；当前这台的登录除外）。其余逻辑和 v6_27 完全一样。
create or replace function public.remove_my_device(p_id uuid, p_current_device text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare uid uuid := auth.uid(); sid text := coalesce(auth.jwt() ->> 'session_id', ''); d public.security_devices%rowtype; n int := 0; m int := 0; begin if uid is null then return jsonb_build_object('ok', false, 'message', '请先登录'); end if; if public.is_session_revoked() then return jsonb_build_object('ok', false, 'message', '这台设备的登录已失效，请重新登录'); end if; select * into d from public.security_devices where id = p_id and user_id = uid; if not found then return jsonb_build_object('ok', false, 'message', '找不到这台设备（可能已经删除）'); end if; if d.device_id = btrim(coalesce(p_current_device, '')) then return jsonb_build_object('ok', false, 'message', '不能删除你正在使用的这台设备'); end if; insert into public.revoked_devices (user_id, device_id, revoked_at) values (uid, d.device_id, now()) on conflict (user_id, device_id) do update set revoked_at = now(); insert into public.revoked_sessions (session_id, user_id, device_id) select s.session_id, uid, d.device_id from public.device_sessions s where s.user_id = uid and s.device_id = d.device_id on conflict (session_id) do nothing; delete from auth.sessions a using public.device_sessions s where s.user_id = uid and s.device_id = d.device_id and a.id = s.session_id and a.user_id = uid; get diagnostics n = row_count; delete from public.device_sessions where user_id = uid and device_id = d.device_id; if sid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then insert into public.revoked_sessions (session_id, user_id, device_id) select a.id, uid, null from auth.sessions a where a.user_id = uid and a.id::text <> sid and not exists (select 1 from public.device_sessions s where s.session_id = a.id) on conflict (session_id) do nothing; delete from auth.sessions a where a.user_id = uid and a.id::text <> sid and not exists (select 1 from public.device_sessions s where s.session_id = a.id); get diagnostics m = row_count; end if; if coalesce(d.status, '') <> 'blocked' then delete from public.security_devices where id = d.id and user_id = uid; end if; insert into public.admin_operation_logs (user_id, action, detail) values (uid, 'remove_device', '用户删除了自己的设备：' || coalesce(nullif(d.device_name, ''), nullif(d.platform, ''), left(d.device_id, 10)) || '（强制退出 ' || n || ' 个登录' || case when m > 0 then '，另有 ' || m || ' 个未识别的登录一并退出' else '' end || '）'); return jsonb_build_object('ok', true, 'sessions', n, 'unknown_sessions', m, 'kept_blocked', coalesce(d.status, '') = 'blocked'); end $f$;

revoke execute on function public.take_quota(uuid, text, integer, integer), public.auth_identity_taken(uuid, text, text) from public, anon, authenticated;
grant execute on function public.take_quota(uuid, text, integer, integer), public.auth_identity_taken(uuid, text, text) to service_role;
revoke execute on function public.revoke_other_sessions(), public.admin_revoke_user_sessions(uuid), public.admin_user_activity(), public.remove_my_device(uuid, text) from public, anon;
grant execute on function public.revoke_other_sessions(), public.admin_revoke_user_sessions(uuid), public.admin_user_activity(), public.remove_my_device(uuid, text) to authenticated;

select 'table' as check, count(*) as n from information_schema.tables where table_schema = 'public' and table_name = 'quota_counters'
union all select 'server only', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('take_quota', 'auth_identity_taken') and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
union all select 'user functions', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('revoke_other_sessions', 'admin_revoke_user_sessions', 'admin_user_activity', 'remove_my_device') and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute');
-- 期望：table = 1，server only = 2，user functions = 4

-- ===== 第 2 段：权限规则清理 + 店铺归属 + 重复索引 + 上传限制 =====
-- 回滚：重复的策略 / 索引是多余的，删掉不影响功能，一般不需要恢复；店铺归属：drop policy if exists tasks_store_owned_insert on public.after_sales_tasks;
--       drop policy if exists tasks_store_owned_update on public.after_sales_tasks; 上传限制：update storage.buckets set file_size_limit = 524288000, allowed_mime_types = null where id = 'after-sales-evidence';
begin;
-- admin_users：前端只需要读自己那一行（是不是管理员）；「自己插入/修改」两条删掉，重复的 select 删一条
drop policy if exists admin_users_insert_self on public.admin_users;
drop policy if exists admin_users_update_self on public.admin_users;
drop policy if exists admin_users_select_self on public.admin_users;
alter policy admin_users_self_read on public.admin_users using (user_id = (select auth.uid()));
-- 每张业务表只留一条「只能读写自己的」宽松策略（其余是完全重复的），auth.uid() 改成 (select auth.uid())（每条查询只算一次，更快）
drop policy if exists events_owner on public.after_sales_events;
alter policy after_sales_events_user_access on public.after_sales_events using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists tasks_owner on public.after_sales_tasks;
drop policy if exists after_sales_tasks_insert_own on public.after_sales_tasks;
drop policy if exists after_sales_tasks_update_own on public.after_sales_tasks;
alter policy after_sales_tasks_user_access on public.after_sales_tasks using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists files_owner on public.evidence_files;
alter policy evidence_files_user_access on public.evidence_files using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists evidence_library_select_own on public.evidence_library;
drop policy if exists evidence_library_insert_own on public.evidence_library;
drop policy if exists evidence_library_update_own on public.evidence_library;
drop policy if exists evidence_library_delete_own on public.evidence_library;
alter policy library_owner on public.evidence_library using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists shop_stores_select_own on public.shop_stores;
drop policy if exists shop_stores_insert_own on public.shop_stores;
drop policy if exists shop_stores_update_own on public.shop_stores;
drop policy if exists shop_stores_delete_own on public.shop_stores;
alter policy shop_stores_owner on public.shop_stores using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists tracking_owner on public.tracking_records;
alter policy tracking_records_user_access on public.tracking_records using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- 售后只能挂在自己的店铺下（限制性策略：和上面的宽松策略同时满足才行；以前的店铺检查写在宽松策略里，被另一条宽松策略「或」掉了，等于没检查）
drop policy if exists tasks_store_owned_insert on public.after_sales_tasks;
create policy tasks_store_owned_insert on public.after_sales_tasks as restrictive for insert to authenticated with check (after_sales_tasks.store_id is null or exists (select 1 from public.shop_stores s where s.id = after_sales_tasks.store_id and s.user_id = (select auth.uid())));
drop policy if exists tasks_store_owned_update on public.after_sales_tasks;
create policy tasks_store_owned_update on public.after_sales_tasks as restrictive for update to authenticated using (true) with check (after_sales_tasks.store_id is null or exists (select 1 from public.shop_stores s where s.id = after_sales_tasks.store_id and s.user_id = (select auth.uid())));
-- 完全重复的索引
drop index if exists public.idx_admin_users_user_id_unique;
drop index if exists public.idx_after_sales_tasks_user_id;
drop index if exists public.tasks_store_idx;
-- 上传：单个文件最大 200MB，只收图片 / 视频 / pdf / Word / Excel / txt（和前端「选择文件」允许的类型一致）
update storage.buckets set file_size_limit = 209715200, allowed_mime_types = array['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'image/bmp', 'video/*', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain'] where id = 'after-sales-evidence';
commit;

select 'admin_users policies' as check, count(*) as n from pg_policies where schemaname = 'public' and tablename = 'admin_users'
union all select 'owner policies', count(*) from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and tablename in ('after_sales_events', 'after_sales_tasks', 'evidence_files', 'evidence_library', 'shop_stores', 'tracking_records')
union all select 'store restrictive', count(*) from pg_policies where schemaname = 'public' and tablename = 'after_sales_tasks' and policyname in ('tasks_store_owned_insert', 'tasks_store_owned_update') and permissive = 'RESTRICTIVE'
union all select 'dup indexes left', count(*) from pg_indexes where schemaname = 'public' and indexname in ('idx_admin_users_user_id_unique', 'idx_after_sales_tasks_user_id', 'tasks_store_idx')
union all select 'bucket limited', count(*) from storage.buckets where id = 'after-sales-evidence' and file_size_limit = 209715200 and array_length(allowed_mime_types, 1) = 14;
-- 期望：admin_users policies = 1，owner policies = 6，store restrictive = 2，dup indexes left = 0，bucket limited = 1
