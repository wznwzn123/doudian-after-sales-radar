-- 售后雷达 Pro 6.37：QQ 群问答机器人的后台（管理后台「QQ 机器人」页 + 给机器人脚本用的两个接口）
-- （需要在 SQL Editor 执行；只有 1 段，末尾有核对查询）
-- 状态：待用户执行。可重复执行。
-- 写之前已用只读查询核对（2026-10-13）：public 里没有 qq 开头的表；is_admin() / is_super_admin() / is_session_revoked() 都在；admin_users(user_id, is_super)。
--
-- 机器人本身是独立项目（手机上的 FunBox 脚本，另一个仓库），这里只放它要用的数据：
--   * qqbot_settings：一行。开关、生效的群号、冷却秒数、是否只回复 @、连接码的 sha256（明文只在生成时显示一次）、机器人最近一次来拉配置的时间。
--   * qqbot_faq：「关键词 → 回复」。
--   * qqbot_hits：命中记录，只有「哪个群、命中哪条问答、什么时间」。不存群友 QQ 号、昵称、原话（用户 2026-10-13 选择）。保留 180 天。
-- 三张表都开 RLS、没有策略、收回 anon / authenticated 的全部表权限：网页和机器人都只能通过下面的函数访问。
--   * 管理员（网页，登录 JWT）：admin_qqbot_overview / admin_qqbot_hits / admin_qqbot_save_settings / admin_qqbot_save_faq / admin_qqbot_delete_faq，
--     函数内校验 is_admin() 且这台设备的登录没被作废；生成 / 作废连接码（admin_qqbot_new_token / admin_qqbot_revoke_token）只有超级管理员能做。都写 admin_operation_logs。
--   * 机器人（不登录，publishable key + 连接码）：qqbot_pull（拉开关、群号、问答）、qqbot_hit（记一次命中）。连接码不对什么都拿不到；
--     qqbot_hit 只接受设置里的群号、存在的问答，全站 10 分钟最多 300 条（连接码泄露时也写不爆），顺手删 180 天前的记录。
--     连接码 = 两个 gen_random_uuid 去掉横线（64 位十六进制），泄露了在后台「生成新连接码」旧的立即作废。
-- 回滚：drop function if exists public.qqbot_pull(text), public.qqbot_hit(text, uuid, text), public.qqbot_token_ok(text), public.qqbot_admin_ok(),
--         public.admin_qqbot_overview(), public.admin_qqbot_hits(integer), public.admin_qqbot_save_settings(jsonb), public.admin_qqbot_save_faq(jsonb),
--         public.admin_qqbot_delete_faq(uuid), public.admin_qqbot_new_token(), public.admin_qqbot_revoke_token();
--       drop table if exists public.qqbot_hits, public.qqbot_faq, public.qqbot_settings;

create table if not exists public.qqbot_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  groups text[] not null default '{}',
  cooldown_sec int not null default 60 check (cooldown_sec between 5 and 3600),
  require_at boolean not null default false,
  token_hash text,
  token_set_at timestamptz,
  last_seen_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.qqbot_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.qqbot_faq (
  id uuid primary key default gen_random_uuid(),
  keywords text[] not null check (cardinality(keywords) between 1 and 20),
  answer text not null check (char_length(answer) between 1 and 1000),
  enabled boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.qqbot_hits (
  id bigint generated always as identity primary key,
  faq_id uuid references public.qqbot_faq(id) on delete set null,
  group_id text not null check (group_id ~ '^[0-9]{5,12}$'),
  created_at timestamptz not null default now()
);
create index if not exists qqbot_hits_created_at_idx on public.qqbot_hits (created_at);
create index if not exists qqbot_hits_faq_id_idx on public.qqbot_hits (faq_id);

alter table public.qqbot_settings enable row level security;
alter table public.qqbot_faq enable row level security;
alter table public.qqbot_hits enable row level security;
revoke all on public.qqbot_settings, public.qqbot_faq, public.qqbot_hits from anon, authenticated;

-- 内部：连接码对不对（不给任何人直接调用）
create or replace function public.qqbot_token_ok(p_token text) returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce(char_length(p_token) between 32 and 128, false) and exists (select 1 from public.qqbot_settings s where s.id = 1 and s.token_hash is not null and s.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')) $f$;
-- 内部：当前登录是管理员、且这台设备的登录没被作废
create or replace function public.qqbot_admin_ok() returns boolean language sql stable security definer set search_path to 'public' as $f$ select auth.uid() is not null and exists (select 1 from public.admin_users a where a.user_id = auth.uid()) and not public.is_session_revoked() $f$;

-- 机器人：拉配置
create or replace function public.qqbot_pull(p_token text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; begin if not public.qqbot_token_ok(p_token) then return jsonb_build_object('ok', false, 'message', '连接码不对或已作废'); end if; update public.qqbot_settings set last_seen_at = now() where id = 1 and (last_seen_at is null or last_seen_at < now() - interval '1 minute'); select * into s from public.qqbot_settings where id = 1; return jsonb_build_object('ok', true, 'enabled', s.enabled, 'groups', to_jsonb(s.groups), 'cooldown_sec', s.cooldown_sec, 'require_at', s.require_at, 'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'keywords', to_jsonb(f.keywords), 'answer', f.answer) order by f.sort, f.created_at) from public.qqbot_faq f where f.enabled), '[]'::jsonb), 'server_time', now()); end $f$;

-- 机器人：记一次命中（只有群号、问答、时间）
create or replace function public.qqbot_hit(p_token text, p_faq_id uuid, p_group text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare g text := btrim(coalesce(p_group, '')); begin if not public.qqbot_token_ok(p_token) then return jsonb_build_object('ok', false, 'message', '连接码不对或已作废'); end if; if g !~ '^[0-9]{5,12}$' or not exists (select 1 from public.qqbot_settings s where s.id = 1 and g = any (s.groups)) then return jsonb_build_object('ok', false, 'message', '这个群不在机器人设置里'); end if; if p_faq_id is null or not exists (select 1 from public.qqbot_faq f where f.id = p_faq_id) then return jsonb_build_object('ok', false, 'message', '找不到这条问答'); end if; if (select count(*) from public.qqbot_hits h where h.created_at > now() - interval '10 minutes') >= 300 then return jsonb_build_object('ok', false, 'message', '记录太频繁，先不记了'); end if; delete from public.qqbot_hits where created_at < now() - interval '180 days'; insert into public.qqbot_hits (faq_id, group_id) values (p_faq_id, g); return jsonb_build_object('ok', true); end $f$;

-- 管理员：设置 + 问答（带命中数）+ 统计
create or replace function public.admin_qqbot_overview() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; day0 timestamptz := date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into s from public.qqbot_settings where id = 1; return jsonb_build_object(
  'settings', jsonb_build_object('enabled', coalesce(s.enabled, false), 'groups', to_jsonb(coalesce(s.groups, '{}'::text[])), 'cooldown_sec', coalesce(s.cooldown_sec, 60), 'require_at', coalesce(s.require_at, false), 'token_set', s.token_hash is not null, 'token_set_at', s.token_set_at, 'last_seen_at', s.last_seen_at, 'updated_at', s.updated_at),
  'is_super', public.is_super_admin(),
  'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'keywords', to_jsonb(f.keywords), 'answer', f.answer, 'enabled', f.enabled, 'sort', f.sort, 'updated_at', f.updated_at, 'hits_30d', (select count(*) from public.qqbot_hits h where h.faq_id = f.id and h.created_at > now() - interval '30 days'), 'hits_total', (select count(*) from public.qqbot_hits h where h.faq_id = f.id), 'last_hit', (select max(h.created_at) from public.qqbot_hits h where h.faq_id = f.id)) order by f.sort, f.created_at) from public.qqbot_faq f), '[]'::jsonb),
  'stats', jsonb_build_object('today', (select count(*) from public.qqbot_hits where created_at >= day0), 'd7', (select count(*) from public.qqbot_hits where created_at > now() - interval '7 days'), 'd30', (select count(*) from public.qqbot_hits where created_at > now() - interval '30 days'), 'total', (select count(*) from public.qqbot_hits),
    'daily', (select jsonb_agg(jsonb_build_object('day', to_char(d at time zone 'Asia/Shanghai', 'MM-DD'), 'n', (select count(*) from public.qqbot_hits h where h.created_at >= d and h.created_at < d + interval '1 day')) order by d) from generate_series(day0 - interval '13 days', day0, interval '1 day') d),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group_id', x.group_id, 'n', x.n) order by x.n desc) from (select group_id, count(*) n from public.qqbot_hits where created_at > now() - interval '30 days' group by group_id) x), '[]'::jsonb))); end $f$;

-- 管理员：命中记录（最近的在前，最多 500 条）
create or replace function public.admin_qqbot_hits(p_limit integer default 200) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; return coalesce((select jsonb_agg(jsonb_build_object('created_at', x.created_at, 'group_id', x.group_id, 'faq_id', x.faq_id, 'keywords', to_jsonb(x.keywords), 'answer', x.answer) order by x.created_at desc, x.id desc) from (select h.id, h.created_at, h.group_id, h.faq_id, f.keywords, f.answer from public.qqbot_hits h left join public.qqbot_faq f on f.id = h.faq_id order by h.created_at desc, h.id desc limit greatest(1, least(coalesce(p_limit, 200), 500))) x), '[]'::jsonb); end $f$;

-- 管理员：保存开关 / 群号 / 冷却 / 只回复 @
create or replace function public.admin_qqbot_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare gs text[]; bad text; cd int; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; if jsonb_typeof(p -> 'groups') <> 'array' then return jsonb_build_object('ok', false, 'message', '群号格式不对'); end if; select array_agg(distinct g order by g) filter (where g <> ''), min(g) filter (where g <> '' and g !~ '^[0-9]{5,12}$') into gs, bad from (select btrim(v) g from jsonb_array_elements_text(p -> 'groups') v) t; if bad is not null then return jsonb_build_object('ok', false, 'message', '群号只能是 5～12 位数字：' || left(bad, 20)); end if; gs := coalesce(gs, '{}'); if cardinality(gs) > 50 then return jsonb_build_object('ok', false, 'message', '最多 50 个群'); end if; cd := case when coalesce(p ->> 'cooldown_sec', '') ~ '^[0-9]{1,5}$' then (p ->> 'cooldown_sec')::int else -1 end; if cd < 5 or cd > 3600 then return jsonb_build_object('ok', false, 'message', '冷却时间要在 5～3600 秒之间'); end if; if coalesce((p ->> 'enabled')::boolean, false) and cardinality(gs) = 0 then return jsonb_build_object('ok', false, 'message', '要开启机器人，先填至少一个群号'); end if; update public.qqbot_settings set enabled = coalesce((p ->> 'enabled')::boolean, false), groups = gs, cooldown_sec = cd, require_at = coalesce((p ->> 'require_at')::boolean, false), updated_at = now(), updated_by = auth.uid() where id = 1; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_settings', 'QQ 机器人：' || case when coalesce((p ->> 'enabled')::boolean, false) then '开启' else '暂停' end || '，' || cardinality(gs) || ' 个群，冷却 ' || cd || ' 秒' || case when coalesce((p ->> 'require_at')::boolean, false) then '，只回复 @' else '' end); return jsonb_build_object('ok', true); end $f$;

-- 管理员：新增 / 修改一条问答（p.id 为空 = 新增）
create or replace function public.admin_qqbot_save_faq(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare v_id uuid; kws text[]; ans text := btrim(coalesce(p ->> 'answer', '')); srt int; en boolean := coalesce((p ->> 'enabled')::boolean, true); begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; if coalesce(p ->> 'id', '') <> '' then if (p ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return jsonb_build_object('ok', false, 'message', '问答编号不对'); end if; v_id := (p ->> 'id')::uuid; if not exists (select 1 from public.qqbot_faq where id = v_id) then return jsonb_build_object('ok', false, 'message', '找不到这条问答（可能已被删除）'); end if; end if; if jsonb_typeof(p -> 'keywords') <> 'array' then return jsonb_build_object('ok', false, 'message', '至少填一个关键词'); end if; select array_agg(k order by o) into kws from (select k, min(o) o from (select btrim(v) k, o from jsonb_array_elements_text(p -> 'keywords') with ordinality t(v, o)) a where k <> '' group by k) b; if kws is null then return jsonb_build_object('ok', false, 'message', '至少填一个关键词'); end if; if cardinality(kws) > 20 then return jsonb_build_object('ok', false, 'message', '关键词最多 20 个'); end if; if exists (select 1 from unnest(kws) k where char_length(k) > 30) then return jsonb_build_object('ok', false, 'message', '每个关键词最多 30 个字'); end if; if ans = '' or char_length(ans) > 1000 then return jsonb_build_object('ok', false, 'message', '回复内容要在 1～1000 字之间'); end if; srt := case when coalesce(p ->> 'sort', '') ~ '^-?[0-9]{1,6}$' then (p ->> 'sort')::int else 0 end; if v_id is null then if (select count(*) from public.qqbot_faq) >= 200 then return jsonb_build_object('ok', false, 'message', '问答最多 200 条'); end if; insert into public.qqbot_faq (keywords, answer, enabled, sort) values (kws, ans, en, srt) returning id into v_id; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_faq_add', 'QQ 机器人新增问答：' || left(array_to_string(kws, ' / '), 80)); else update public.qqbot_faq set keywords = kws, answer = ans, enabled = en, sort = srt, updated_at = now() where id = v_id; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_faq_edit', 'QQ 机器人修改问答：' || left(array_to_string(kws, ' / '), 80)); end if; return jsonb_build_object('ok', true, 'id', v_id); end $f$;

-- 管理员：删除一条问答（命中记录保留，显示为「已删除的问答」）
create or replace function public.admin_qqbot_delete_faq(p_id uuid) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare kws text[]; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; delete from public.qqbot_faq where id = p_id returning keywords into kws; if kws is null then return jsonb_build_object('ok', false, 'message', '找不到这条问答（可能已被删除）'); end if; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_faq_delete', 'QQ 机器人删除问答：' || left(array_to_string(kws, ' / '), 80)); return jsonb_build_object('ok', true); end $f$;

-- 超级管理员：生成新连接码（旧的立即作废；明文只返回这一次，数据库只存 sha256）
create or replace function public.admin_qqbot_new_token() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare t text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; if not public.is_super_admin() then return jsonb_build_object('ok', false, 'message', '只有超级管理员才能生成连接码'); end if; update public.qqbot_settings set token_hash = encode(sha256(convert_to(t, 'UTF8')), 'hex'), token_set_at = now(), last_seen_at = null, updated_at = now(), updated_by = auth.uid() where id = 1; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_token', 'QQ 机器人：生成了新连接码（旧的作废）'); return jsonb_build_object('ok', true, 'token', t); end $f$;

-- 超级管理员：作废连接码（机器人立刻拿不到配置，也记不了命中）
create or replace function public.admin_qqbot_revoke_token() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; if not public.is_super_admin() then return jsonb_build_object('ok', false, 'message', '只有超级管理员才能作废连接码'); end if; update public.qqbot_settings set token_hash = null, token_set_at = null, updated_at = now(), updated_by = auth.uid() where id = 1; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_token_revoke', 'QQ 机器人：作废了连接码'); return jsonb_build_object('ok', true); end $f$;

revoke execute on function public.qqbot_token_ok(text), public.qqbot_admin_ok(), public.qqbot_pull(text), public.qqbot_hit(text, uuid, text), public.admin_qqbot_overview(), public.admin_qqbot_hits(integer), public.admin_qqbot_save_settings(jsonb), public.admin_qqbot_save_faq(jsonb), public.admin_qqbot_delete_faq(uuid), public.admin_qqbot_new_token(), public.admin_qqbot_revoke_token() from public, anon, authenticated;
grant execute on function public.qqbot_pull(text), public.qqbot_hit(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_qqbot_overview(), public.admin_qqbot_hits(integer), public.admin_qqbot_save_settings(jsonb), public.admin_qqbot_save_faq(jsonb), public.admin_qqbot_delete_faq(uuid), public.admin_qqbot_new_token(), public.admin_qqbot_revoke_token() to authenticated;

-- 核对
select 'tables (RLS on, no access for anon/authenticated)' as check, count(*) as n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('qqbot_settings', 'qqbot_faq', 'qqbot_hits') and c.relrowsecurity and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'insert')
union all select 'settings row (off, no token yet)', count(*) from public.qqbot_settings where id = 1
union all select 'bot functions (anon can call)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qqbot_pull', 'qqbot_hit') and has_function_privilege('anon', p.oid, 'execute')
union all select 'admin functions (login only, not anon)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'admin_qqbot_%' and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
union all select 'internal helpers (nobody can call)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qqbot_token_ok', 'qqbot_admin_ok') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute');
-- 期望：tables = 3，settings row = 1，bot functions = 2，admin functions = 7，internal helpers = 2
