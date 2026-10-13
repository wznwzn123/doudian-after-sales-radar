-- 售后雷达 Pro 6.39：QQ 群 AI「主动接话」（没人 @ 时偶尔自己插一句）+ 表情包
-- （需要在 SQL Editor 执行；只有 1 段，末尾有核对查询）
-- 状态：待用户执行。可重复执行。依赖 v6_38、v6_39。
--
-- 用户 2026-10-13：「让他自己和群友对话，按照自己的想法，还会发表情包，要不然太人机味了」。
--   * ai_chime：开了以后，群里没人 @ 机器人时，脚本按 ai_chime_rate（%）的概率、并且同一个群至少隔 ai_chime_gap 分钟，把最近几句群聊发给 AI，
--     由 AI 决定接不接话（不想说就不说）。每天上限和 @ 回复共用（v6_39 的 ai_daily_limit / ai_group_daily_limit）。
--   * 表情包在手机脚本目录里（「表情包」文件夹，文件名就是名字），不经过数据库。
--   * 仍然是 AI：被认真问到时承认（系统提示里的规则不变）。
-- 改动：qqbot_settings 加 3 列；qqbot_pull 多返回 ai 对象（脚本据此决定要不要主动接话）；admin_qqbot_ai_get / admin_qqbot_save_ai 加这 3 项。
-- 回滚：重新执行 v6_38 里 qqbot_pull 的定义和 v6_39 里 admin_qqbot_ai_get / admin_qqbot_save_ai 的定义；
--       alter table public.qqbot_settings drop column if exists ai_chime, drop column if exists ai_chime_rate, drop column if exists ai_chime_gap;

alter table public.qqbot_settings
  add column if not exists ai_chime boolean not null default false,
  add column if not exists ai_chime_rate int not null default 10 check (ai_chime_rate between 1 and 50),
  add column if not exists ai_chime_gap int not null default 5 check (ai_chime_gap between 1 and 120);

-- 机器人：拉配置（在 v6_38 的基础上多返回 ai：总开关 + AI 开关、主动接话开关、概率、间隔）
create or replace function public.qqbot_pull(p_token text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; begin if not public.qqbot_token_ok(p_token) then return jsonb_build_object('ok', false, 'message', '连接码不对或已作废'); end if; update public.qqbot_settings set last_seen_at = now() where id = 1 and (last_seen_at is null or last_seen_at < now() - interval '1 minute'); select * into s from public.qqbot_settings where id = 1; return jsonb_build_object('ok', true, 'enabled', s.enabled, 'groups', to_jsonb(s.groups), 'cooldown_sec', s.cooldown_sec, 'require_at', s.require_at, 'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'keywords', to_jsonb(f.keywords), 'answer', f.answer) order by f.sort, f.created_at) from public.qqbot_faq f where f.enabled), '[]'::jsonb), 'ai', jsonb_build_object('enabled', s.enabled and s.ai_enabled, 'chime', s.enabled and s.ai_enabled and s.ai_chime, 'chime_rate', s.ai_chime_rate, 'chime_gap', s.ai_chime_gap), 'server_time', now()); end $f$;

-- 管理员：AI 设定 + 用量（v6_39 + 主动接话 3 项）
create or replace function public.admin_qqbot_ai_get() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; d date := (now() at time zone 'Asia/Shanghai')::date; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into s from public.qqbot_settings where id = 1; return jsonb_build_object('ai_enabled', coalesce(s.ai_enabled, false), 'ai_name', coalesce(s.ai_name, '小雷'), 'ai_style', coalesce(s.ai_style, ''), 'ai_daily_limit', coalesce(s.ai_daily_limit, 200), 'ai_group_daily_limit', coalesce(s.ai_group_daily_limit, 50), 'ai_chime', coalesce(s.ai_chime, false), 'ai_chime_rate', coalesce(s.ai_chime_rate, 10), 'ai_chime_gap', coalesce(s.ai_chime_gap, 5),
  'today', (select jsonb_build_object('calls', coalesce(sum(calls), 0), 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from public.qqbot_ai_usage where day = d),
  'd30', (select jsonb_build_object('calls', coalesce(sum(calls), 0), 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from public.qqbot_ai_usage where day > d - 30),
  'groups_today', coalesce((select jsonb_agg(jsonb_build_object('group_id', group_id, 'calls', calls) order by calls desc) from public.qqbot_ai_usage where day = d), '[]'::jsonb)); end $f$;

-- 管理员：保存 AI 设定（v6_39 + 主动接话 3 项；没传这 3 项时保持原值）
create or replace function public.admin_qqbot_save_ai(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare nm text := btrim(coalesce(p ->> 'ai_name', '')); st text := btrim(coalesce(p ->> 'ai_style', '')); lim int; glim int; rate int; gap int; cur public.qqbot_settings%rowtype; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into cur from public.qqbot_settings where id = 1; if char_length(nm) < 1 or char_length(nm) > 20 then return jsonb_build_object('ok', false, 'message', 'AI 的名字要 1～20 个字'); end if; if char_length(st) > 500 then return jsonb_build_object('ok', false, 'message', '语气说明最多 500 字'); end if; lim := case when coalesce(p ->> 'ai_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_daily_limit')::int else -1 end; glim := case when coalesce(p ->> 'ai_group_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_group_daily_limit')::int else -1 end; if lim < 0 or lim > 5000 then return jsonb_build_object('ok', false, 'message', '全站每天上限要在 0～5000 之间'); end if; if glim < 0 or glim > 1000 then return jsonb_build_object('ok', false, 'message', '每个群每天上限要在 0～1000 之间'); end if; rate := case when p ? 'ai_chime_rate' then case when coalesce(p ->> 'ai_chime_rate', '') ~ '^[0-9]{1,3}$' then (p ->> 'ai_chime_rate')::int else -1 end else cur.ai_chime_rate end; gap := case when p ? 'ai_chime_gap' then case when coalesce(p ->> 'ai_chime_gap', '') ~ '^[0-9]{1,4}$' then (p ->> 'ai_chime_gap')::int else -1 end else cur.ai_chime_gap end; if rate < 1 or rate > 50 then return jsonb_build_object('ok', false, 'message', '主动接话的概率要在 1%～50% 之间'); end if; if gap < 1 or gap > 120 then return jsonb_build_object('ok', false, 'message', '主动接话的间隔要在 1～120 分钟之间'); end if; update public.qqbot_settings set ai_enabled = coalesce((p ->> 'ai_enabled')::boolean, false), ai_name = nm, ai_style = st, ai_daily_limit = lim, ai_group_daily_limit = glim, ai_chime = case when p ? 'ai_chime' then coalesce((p ->> 'ai_chime')::boolean, false) else cur.ai_chime end, ai_chime_rate = rate, ai_chime_gap = gap, updated_at = now(), updated_by = auth.uid() where id = 1; insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_ai', 'QQ 机器人 AI 聊天：' || case when coalesce((p ->> 'ai_enabled')::boolean, false) then '开启' else '关闭' end || '，名字「' || nm || '」，每天最多 ' || lim || ' 次（每群 ' || glim || ' 次）' || case when (case when p ? 'ai_chime' then coalesce((p ->> 'ai_chime')::boolean, false) else cur.ai_chime end) then '，主动接话 ' || rate || '%、间隔 ' || gap || ' 分钟' else '，不主动接话' end); return jsonb_build_object('ok', true); end $f$;

revoke execute on function public.qqbot_pull(text), public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb) from public, anon, authenticated;
grant execute on function public.qqbot_pull(text) to anon, authenticated;
grant execute on function public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb) to authenticated;

-- 核对
select 'chime columns' as check, count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'qqbot_settings' and column_name in ('ai_chime', 'ai_chime_rate', 'ai_chime_gap')
union all select 'pull returns ai settings', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'qqbot_pull' and pg_get_functiondef(p.oid) like '%chime_rate%' and has_function_privilege('anon', p.oid, 'execute')
union all select 'admin functions (login only)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_qqbot_ai_get', 'admin_qqbot_save_ai') and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and pg_get_functiondef(p.oid) like '%ai_chime%'
union all select 'chime off by default', count(*) from public.qqbot_settings where id = 1 and not ai_chime;
-- 期望：chime columns = 3，pull returns ai settings = 1，admin functions = 2，chime off by default = 1（第一次执行时）
