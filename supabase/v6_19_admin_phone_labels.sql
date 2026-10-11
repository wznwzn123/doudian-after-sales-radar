-- 售后雷达 Pro 6.19：管理后台各列表里，手机号注册的用户显示手机号（原来只读 email，手机号用户是空的）
-- 状态：待用户在 Supabase SQL Editor 执行（每个函数一行，可分段贴；可重复执行）。
-- 写之前已用 pg_get_functiondef 读出这 9 个函数的现有定义：下面只把 u.email::text 换成
--   coalesce(nullif(u.email::text,''), u.phone::text)，返回列、权限校验、排序等其余部分完全照抄。
-- 前端实际调用的列表函数就是这 9 个；admin_list_security_bans / admin_list_security_devices / admin_list_stores 前端没调用，没改。
-- 回滚：把 coalesce(nullif(u.email::text,''), u.phone::text) 改回 u.email::text 再执行一次。

-- 管理员列表（「管理员」页）
create or replace function public.admin_list_users() returns table(id uuid, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, task_count bigint) language plpgsql security definer set search_path to 'public' as $function$begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception '没有管理员权限'; end if; return query select a.user_id,coalesce(nullif(u.email::text,''),u.phone::text),u.created_at,u.last_sign_in_at,(select count(*) from public.after_sales_tasks t where t.user_id=a.user_id)::bigint from public.admin_users a join auth.users u on u.id=a.user_id order by u.created_at desc; end$function$;

-- 售后
create or replace function public.admin_list_all_tasks() returns table(id uuid, order_id text, store_name text, email text, status text, risk text, tracking_no text, created_at timestamp with time zone) language plpgsql security definer set search_path to 'public' as $function$begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception '没有管理员权限'; end if; return query select t.id,t.order_id,coalesce(s.name,'未关联店铺'),coalesce(nullif(u.email::text,''),u.phone::text),t.status,t.risk,t.tracking_no,t.created_at from public.after_sales_tasks t left join public.shop_stores s on s.id=t.store_id left join auth.users u on u.id=t.user_id order by t.created_at desc; end$function$;

-- 快递
create or replace function public.admin_list_tracking() returns table(id uuid, tracking_no text, email text, order_id text, monitoring boolean, created_at timestamp with time zone) language plpgsql security definer set search_path to 'public' as $function$begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception '没有管理员权限'; end if; return query select r.id,r.tracking_no,coalesce(nullif(u.email::text,''),u.phone::text),coalesce(t.order_id,''),r.monitoring,r.created_at from public.tracking_records r left join auth.users u on u.id=r.user_id left join public.after_sales_tasks t on t.id=r.task_id order by r.created_at desc; end$function$;

-- 店铺
create or replace function public.admin_list_all_stores() returns table(store_id uuid, owner_user_id uuid, owner_email text, store_name text, platform text, shop_id text, status text, task_count bigint, created_at timestamp with time zone) language plpgsql security definer set search_path to 'public' as $function$begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception '没有管理员权限'; end if; return query select s.id,s.user_id,coalesce(nullif(u.email::text,''),u.phone::text),s.name,s.platform,s.shop_id,s.status,(select count(*) from public.after_sales_tasks t where t.store_id=s.id)::bigint,s.created_at from public.shop_stores s left join auth.users u on u.id=s.user_id order by s.created_at desc; end$function$;

-- 资料库
create or replace function public.admin_list_library() returns table(id uuid, file_name text, email text, store_name text, platform text, usage_count integer, created_at timestamp with time zone) language plpgsql security definer set search_path to 'public' as $function$begin if not exists(select 1 from public.admin_users where user_id=auth.uid()) then raise exception '没有管理员权限'; end if; return query select l.id,l.file_name,coalesce(nullif(u.email::text,''),u.phone::text),coalesce(s.name,'通用'),l.platform,l.usage_count,l.created_at from public.evidence_library l left join public.shop_stores s on s.id=l.store_id left join auth.users u on u.id=l.user_id order by l.created_at desc; end$function$;

-- 举证
create or replace function public.admin_list_all_evidence() returns table(id uuid, task_id uuid, user_id uuid, email text, file_name text, mime_type text, size_bytes bigint, created_at timestamp with time zone) language plpgsql security definer set search_path to 'public' as $function$ BEGIN IF NOT public.admin_guard() THEN RAISE EXCEPTION '没有管理员权限'; END IF; RETURN QUERY SELECT e.id,e.task_id,e.user_id,coalesce(nullif(u.email::text,''),u.phone::text),e.file_name,e.mime_type,e.size_bytes,e.created_at FROM public.evidence_files e LEFT JOIN auth.users u ON u.id=e.user_id ORDER BY e.created_at DESC; END; $function$;

-- 日志
create or replace function public.admin_list_logs() returns table(id uuid, user_id uuid, email text, action text, detail text, created_at timestamp with time zone) language plpgsql security definer set search_path to 'public' as $function$ BEGIN IF NOT public.admin_guard() THEN RAISE EXCEPTION '没有管理员权限'; END IF; RETURN QUERY SELECT l.id,l.user_id,coalesce(nullif(u.email::text,''),u.phone::text),l.action,l.detail,l.created_at FROM public.admin_operation_logs l LEFT JOIN auth.users u ON u.id=l.user_id ORDER BY l.created_at DESC LIMIT 500; END; $function$;

-- 账号（封禁列表）
create or replace function public.admin_list_account_bans() returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$ begin if auth.uid() is null or not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if; return coalesce((select jsonb_agg(to_jsonb(x) order by x.blocked_at desc) from (select b.user_id, coalesce(nullif(u.email::text,''),u.phone::text) as owner_email, b.reason, b.blocked_at, b.expires_at, b.blocked_by from public.security_user_bans b left join auth.users u on u.id = b.user_id where b.status = 'blocked' and (b.expires_at is null or b.expires_at > now())) x), '[]'::jsonb); end; $function$;

-- 设备
create or replace function public.admin_list_devices() returns jsonb language plpgsql security definer set search_path to 'public', 'auth' as $function$ begin if auth.uid() is null or not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if; return coalesce((select jsonb_agg(to_jsonb(x) order by x.last_seen_at desc nulls last) from (select d.id, d.user_id, coalesce(nullif(u.email::text,''),u.phone::text) as owner_email, d.device_name, d.device_id, d.platform, d.app_version, d.status, d.created_at, greatest(d.last_seen, d.last_seen_at) as last_seen_at, d.blocked_at, d.blocked_reason, d.blocked_by from public.security_devices d left join auth.users u on u.id = d.user_id) x), '[]'::jsonb); end; $function$;

-- 核对（只读）：9 个函数里都应包含 u.phone
select count(*) as updated from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('admin_list_users','admin_list_all_tasks','admin_list_tracking','admin_list_all_stores','admin_list_library','admin_list_all_evidence','admin_list_logs','admin_list_account_bans','admin_list_devices') and pg_get_functiondef(p.oid) like '%u.phone::text%';
-- 期望：updated = 9
