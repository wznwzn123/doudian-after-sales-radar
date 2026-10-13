-- 售后雷达 Pro 6.38：QQ 群机器人的 AI 聊天（群友 @机器人、又没命中问答时，由 Claude 回复）
-- （需要在 SQL Editor 执行；只有 1 段，末尾有核对查询）
-- 状态：待用户执行。可重复执行。依赖 v6_38（qqbot_settings / qqbot_faq / qqbot_token_ok / qqbot_admin_ok）。
--
-- 用户 2026-10-13 的决定：AI 平时像群友一样自然聊天，但它是 AI —— 有人认真问是不是机器人 / AI 时要承认，不冒充真人。
-- 流程：手机上的模了个块脚本 → Edge Function qqbot-chat（不登录，带连接码）→ 本文件的 qqbot_ai_claim（只有服务端能调：校验连接码、开关、群号、每日上限，并先记一次）
--       → Claude API（ANTHROPIC_API_KEY 只在 Edge Function Secrets 里）→ qqbot_ai_usage_add 记 token 用量 → 回复发回群里。
-- 存什么：qqbot_ai_usage 只有「日期、群号、次数、输入 / 输出 token 数」。不存群友的消息、QQ 号和昵称（发给 Claude 的上下文里发言人已匿名成「群友A / 群友B」）。
-- 上限：全站每天 ai_daily_limit 次、每个群每天 ai_group_daily_limit 次（北京时间按天算），到了就不再调用 Claude，避免账单失控。
-- 回滚：drop function if exists public.qqbot_ai_claim(text, text), public.qqbot_ai_usage_add(text, integer, integer), public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb);
--       drop table if exists public.qqbot_ai_usage;
--       alter table public.qqbot_settings drop column if exists ai_enabled, drop column if exists ai_name, drop column if exists ai_style, drop column if exists ai_daily_limit, drop column if exists ai_group_daily_limit;

alter table public.qqbot_settings
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_name text not null default '小雷' check (char_length(ai_name) between 1 and 20),
  add column if not exists ai_style text not null default '' check (char_length(ai_style) <= 500),
  add column if not exists ai_daily_limit int not null default 200 check (ai_daily_limit between 0 and 5000),
  add column if not exists ai_group_daily_limit int not null default 50 check (ai_group_daily_limit between 0 and 1000);

create table if not exists public.qqbot_ai_usage (
  day date not null,
  group_id text not null check (group_id ~ '^[0-9]{5,12}$'),
  calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (day, group_id)
);
alter table public.qqbot_ai_usage enable row level security;
revoke all on public.qqbot_ai_usage from anon, authenticated;

-- 服务端（Edge Function qqbot-chat）：校验连接码、开关、群号、每日上限，通过就先记一次并返回 AI 设定和问答（给 AI 当参考）
create or replace function public.qqbot_ai_claim(p_token text, p_group text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; g text := btrim(coalesce(p_group, '')); d date := (now() at time zone 'Asia/Shanghai')::date; total int; mine int; begin if not public.qqbot_token_ok(p_token) then return jsonb_build_object('ok', false, 'code', 'bad_token'); end if; select * into s from public.qqbot_settings where id = 1; if not s.enabled or not s.ai_enabled then return jsonb_build_object('ok', false, 'code', 'off'); end if; if g !~ '^[0-9]{5,12}$' or not (g = any (s.groups)) then return jsonb_build_object('ok', false, 'code', 'group'); end if; perform pg_advisory_xact_lock(hashtext('qqbot_ai_claim')); select coalesce(sum(calls), 0), coalesce(sum(calls) filter (where group_id = g), 0) into total, mine from public.qqbot_ai_usage where day = d; if total >= s.ai_daily_limit or mine >= s.ai_group_daily_limit then return jsonb_build_object('ok', false, 'code', 'limit'); end if; insert into public.qqbot_ai_usage as u (day, group_id, calls) values (d, g, 1) on conflict (day, group_id) do update set calls = u.calls + 1; delete from public.qqbot_ai_usage where day < d - 400; return jsonb_build_object('ok', true, 'name', s.ai_name, 'style', s.ai_style, 'faqs', coalesce((select jsonb_agg(jsonb_build_object('keywords', to_jsonb(f.keywords), 'answer', f.answer) order by f.sort, f.created_at) from (select * from public.qqbot_faq where enabled order by sort, created_at limit 50) f), '[]'::jsonb)); end $f$;

-- 服务端：记这次调用用掉的 token（只有数字）
create or replace function public.qqbot_ai_usage_add(p_group text, p_in integer, p_out integer) returns void language sql security definer set search_path to 'public' as $f$ update public.qqbot_ai_usage set input_tokens = input_tokens + greatest(coalesce(p_in, 0), 0), output_tokens = output_tokens + greatest(coalesce(p_out, 0), 0) where day = (now() at time zone 'Asia/Shanghai')::date and group_id = btrim(coalesce(p_group, '')) $f$;

-- 管理员：AI 设定 + 用量
create or replace function public.admin_qqbot_ai_get() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; d date := (now() at time zone 'Asia/Shanghai')::date; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into s from public.qqbot_settings where id = 1; return jsonb_build_object('ai_enabled', coalesce(s.ai_enabled, false), 'ai_name', coalesce(s.ai_name, '小雷'), 'ai_style', coalesce(s.ai_style, ''), 'ai_daily_limit', coalesce(s.ai_daily_limit, 200), 'ai_group_daily_limit', coalesce(s.ai_group_daily_limit, 50),
  'today', (select jsonb_build_object('calls', coalesce(sum(calls), 0), 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from public.qqbot_ai_usage where day = d),
  'd30', (select jsonb_build_object('calls', coalesce(sum(calls), 0), 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from public.qqbot_ai_usage where day > d - 30),
  'groups_today', coalesce((select jsonb_agg(jsonb_build_object('group_id', group_id, 'calls', calls) order by calls desc) from public.qqbot_ai_usage where day = d), '[]'::jsonb)); end $f$;

-- 管理员：保存 AI 设定
create or replace function public.admin_qqbot_save_ai(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare nm text := btrim(coalesce(p ->> 'ai_name', '')); st text := btrim(coalesce(p ->> 'ai_style', '')); lim int; glim int; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; if char_length(nm) < 1 or char_length(nm) > 20 then return jsonb_build_object('ok', false, 'message', 'AI 的名字要 1～20 个字'); end if; if char_length(st) > 500 then return jsonb_build_object('ok', false, 'message', '语气说明最多 500 字'); end if; lim := case when coalesce(p ->> 'ai_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_daily_limit')::int else -1 end; glim := case when coalesce(p ->> 'ai_group_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_group_daily_limit')::int else -1 end; if lim < 0 or lim > 5000 then return jsonb_build_object('ok', false, 'message', '全站每天上限要在 0～5000 之间'); end if; if glim < 0 or glim > 1000 then return jsonb_build_object('ok', false, 'message', '每个群每天上限要在 0～1000 之间'); end if; update public.qqbot_settings set ai_enabled = coalesce((p ->> 'ai_enabled')::boolean, false), ai_name = nm, ai_style = st, ai_daily_limit = lim, ai_group_daily_limit = glim, updated_at = now(), updated_by = auth.uid() where id = 1; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_ai', 'QQ 机器人 AI 聊天：' || case when coalesce((p ->> 'ai_enabled')::boolean, false) then '开启' else '关闭' end || '，名字「' || nm || '」，每天最多 ' || lim || ' 次（每群 ' || glim || ' 次）'); return jsonb_build_object('ok', true); end $f$;

revoke execute on function public.qqbot_ai_claim(text, text), public.qqbot_ai_usage_add(text, integer, integer), public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb) from public, anon, authenticated;
grant execute on function public.qqbot_ai_claim(text, text), public.qqbot_ai_usage_add(text, integer, integer) to service_role;
grant execute on function public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb) to authenticated;

-- 核对
select 'ai columns' as check, count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'qqbot_settings' and column_name in ('ai_enabled', 'ai_name', 'ai_style', 'ai_daily_limit', 'ai_group_daily_limit')
union all select 'usage table (RLS on, no access for anon/authenticated)', count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'qqbot_ai_usage' and c.relrowsecurity and not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('authenticated', c.oid, 'select')
union all select 'server-only functions', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('qqbot_ai_claim', 'qqbot_ai_usage_add') and has_function_privilege('service_role', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
union all select 'admin functions (login only)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_qqbot_ai_get', 'admin_qqbot_save_ai') and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
union all select 'AI off by default', count(*) from public.qqbot_settings where id = 1 and not ai_enabled;
-- 期望：ai columns = 5，usage table = 1，server-only functions = 2，admin functions = 2，AI off by default = 1（第一次执行时）
