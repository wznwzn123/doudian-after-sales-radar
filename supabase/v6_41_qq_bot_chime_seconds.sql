-- 售后雷达 Pro 6.39.3：QQ 群 AI「主动接话」的间隔改用秒，概率上限放宽到 100%
-- （需要在 SQL Editor 执行；只有 1 段，末尾有核对查询）
-- 状态：待用户执行。可重复执行。依赖 v6_38、v6_39、v6_40。
--
-- 用户 2026-10-14：「主动回复我也不要那么久」。v6_40 的间隔最短 1 分钟、概率最高 50%。
--   * 新列 ai_chime_gap_sec：同一个群两次主动接话至少隔几秒（10～7200，默认 300 = 原来的 5 分钟）。
--     第一次执行时按原来的 ai_chime_gap（分钟）换算，不改变现有设置。
--   * ai_chime_rate 上限 50 → 100。
--   * 旧列 ai_chime_gap（分钟）保留并同步（向上取整到 1～120），旧版脚本照样能用。
--   * qqbot_pull 多返回 ai.chime_gap_sec；admin_qqbot_ai_get / admin_qqbot_save_ai 带 ai_chime_gap_sec（旧页面只传分钟时照样能存）。
--   * 主动接话仍然和 @ 回复共用每天上限（全站 / 每群），间隔再短也不会超过上限。
-- 回滚：重新执行 v6_40 全文（恢复 3 个函数），然后：
--   update public.qqbot_settings set ai_chime_rate = least(ai_chime_rate, 50);
--   alter table public.qqbot_settings drop constraint if exists qqbot_settings_ai_chime_rate_check, add constraint qqbot_settings_ai_chime_rate_check check (ai_chime_rate between 1 and 50);
--   alter table public.qqbot_settings drop column if exists ai_chime_gap_sec;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'qqbot_settings' and column_name = 'ai_chime_gap_sec') then
    alter table public.qqbot_settings add column ai_chime_gap_sec int not null default 300 check (ai_chime_gap_sec between 10 and 7200);
    update public.qqbot_settings set ai_chime_gap_sec = least(7200, greatest(10, ai_chime_gap * 60));
  end if;
end $$;

alter table public.qqbot_settings drop constraint if exists qqbot_settings_ai_chime_rate_check;
alter table public.qqbot_settings add constraint qqbot_settings_ai_chime_rate_check check (ai_chime_rate between 1 and 100);

-- 机器人：拉配置（v6_40 + chime_gap_sec）
create or replace function public.qqbot_pull(p_token text) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; begin if not public.qqbot_token_ok(p_token) then return jsonb_build_object('ok', false, 'message', '连接码不对或已作废'); end if; update public.qqbot_settings set last_seen_at = now() where id = 1 and (last_seen_at is null or last_seen_at < now() - interval '1 minute'); select * into s from public.qqbot_settings where id = 1; return jsonb_build_object('ok', true, 'enabled', s.enabled, 'groups', to_jsonb(s.groups), 'cooldown_sec', s.cooldown_sec, 'require_at', s.require_at, 'faqs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'keywords', to_jsonb(f.keywords), 'answer', f.answer) order by f.sort, f.created_at) from public.qqbot_faq f where f.enabled), '[]'::jsonb), 'ai', jsonb_build_object('enabled', s.enabled and s.ai_enabled, 'chime', s.enabled and s.ai_enabled and s.ai_chime, 'chime_rate', s.ai_chime_rate, 'chime_gap', s.ai_chime_gap, 'chime_gap_sec', s.ai_chime_gap_sec), 'server_time', now()); end $f$;

-- 管理员：AI 设定 + 用量（v6_40 + ai_chime_gap_sec）
create or replace function public.admin_qqbot_ai_get() returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare s public.qqbot_settings%rowtype; d date := (now() at time zone 'Asia/Shanghai')::date; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into s from public.qqbot_settings where id = 1; return jsonb_build_object('ai_enabled', coalesce(s.ai_enabled, false), 'ai_name', coalesce(s.ai_name, '小雷'), 'ai_style', coalesce(s.ai_style, ''), 'ai_daily_limit', coalesce(s.ai_daily_limit, 200), 'ai_group_daily_limit', coalesce(s.ai_group_daily_limit, 50), 'ai_chime', coalesce(s.ai_chime, false), 'ai_chime_rate', coalesce(s.ai_chime_rate, 10), 'ai_chime_gap', coalesce(s.ai_chime_gap, 5), 'ai_chime_gap_sec', coalesce(s.ai_chime_gap_sec, 300),
  'today', (select jsonb_build_object('calls', coalesce(sum(calls), 0), 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from public.qqbot_ai_usage where day = d),
  'd30', (select jsonb_build_object('calls', coalesce(sum(calls), 0), 'input_tokens', coalesce(sum(input_tokens), 0), 'output_tokens', coalesce(sum(output_tokens), 0)) from public.qqbot_ai_usage where day > d - 30),
  'groups_today', coalesce((select jsonb_agg(jsonb_build_object('group_id', group_id, 'calls', calls) order by calls desc) from public.qqbot_ai_usage where day = d), '[]'::jsonb)); end $f$;

-- 管理员：保存 AI 设定。间隔优先看 ai_chime_gap_sec（秒）；只传 ai_chime_gap（分钟，旧页面）时换算；都没传保持原值
create or replace function public.admin_qqbot_save_ai(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare nm text := btrim(coalesce(p ->> 'ai_name', '')); st text := btrim(coalesce(p ->> 'ai_style', '')); lim int; glim int; rate int; gsec int; chime boolean; cur public.qqbot_settings%rowtype; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into cur from public.qqbot_settings where id = 1; if char_length(nm) < 1 or char_length(nm) > 20 then return jsonb_build_object('ok', false, 'message', 'AI 的名字要 1～20 个字'); end if; if char_length(st) > 500 then return jsonb_build_object('ok', false, 'message', '语气说明最多 500 字'); end if; lim := case when coalesce(p ->> 'ai_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_daily_limit')::int else -1 end; glim := case when coalesce(p ->> 'ai_group_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_group_daily_limit')::int else -1 end; if lim < 0 or lim > 5000 then return jsonb_build_object('ok', false, 'message', '全站每天上限要在 0～5000 之间'); end if; if glim < 0 or glim > 1000 then return jsonb_build_object('ok', false, 'message', '每个群每天上限要在 0～1000 之间'); end if;
  rate := case when p ? 'ai_chime_rate' then case when coalesce(p ->> 'ai_chime_rate', '') ~ '^[0-9]{1,3}$' then (p ->> 'ai_chime_rate')::int else -1 end else cur.ai_chime_rate end;
  gsec := case when p ? 'ai_chime_gap_sec' then case when coalesce(p ->> 'ai_chime_gap_sec', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_chime_gap_sec')::int else -1 end
               when p ? 'ai_chime_gap' then case when coalesce(p ->> 'ai_chime_gap', '') ~ '^[0-9]{1,4}$' and (p ->> 'ai_chime_gap')::int between 1 and 120 then (p ->> 'ai_chime_gap')::int * 60 else -1 end
               else cur.ai_chime_gap_sec end;
  chime := case when p ? 'ai_chime' then coalesce((p ->> 'ai_chime')::boolean, false) else cur.ai_chime end;
  if rate < 1 or rate > 100 then return jsonb_build_object('ok', false, 'message', '主动接话的概率要在 1%～100% 之间'); end if;
  if gsec < 10 or gsec > 7200 then return jsonb_build_object('ok', false, 'message', '主动接话的间隔要在 10～7200 秒之间'); end if;
  update public.qqbot_settings set ai_enabled = coalesce((p ->> 'ai_enabled')::boolean, false), ai_name = nm, ai_style = st, ai_daily_limit = lim, ai_group_daily_limit = glim, ai_chime = chime, ai_chime_rate = rate, ai_chime_gap_sec = gsec, ai_chime_gap = least(120, greatest(1, ceil(gsec / 60.0)::int)), updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_ai', 'QQ 机器人 AI 聊天：' || case when coalesce((p ->> 'ai_enabled')::boolean, false) then '开启' else '关闭' end || '，名字「' || nm || '」，每天最多 ' || lim || ' 次（每群 ' || glim || ' 次）' || case when chime then '，主动接话 ' || rate || '%、间隔 ' || gsec || ' 秒' else '，不主动接话' end);
  return jsonb_build_object('ok', true); end $f$;

revoke execute on function public.qqbot_pull(text), public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb) from public, anon, authenticated;
grant execute on function public.qqbot_pull(text) to anon, authenticated;
grant execute on function public.admin_qqbot_ai_get(), public.admin_qqbot_save_ai(jsonb) to authenticated;

-- 核对
select 'gap seconds column' as check, count(*) as n from information_schema.columns where table_schema = 'public' and table_name = 'qqbot_settings' and column_name = 'ai_chime_gap_sec'
union all select 'rate up to 100', count(*) from pg_constraint where conrelid = 'public.qqbot_settings'::regclass and conname = 'qqbot_settings_ai_chime_rate_check' and pg_get_constraintdef(oid) like '%100%'
union all select 'pull returns gap seconds', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'qqbot_pull' and pg_get_functiondef(p.oid) like '%chime_gap_sec%' and has_function_privilege('anon', p.oid, 'execute')
union all select 'admin functions (login only)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('admin_qqbot_ai_get', 'admin_qqbot_save_ai') and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and pg_get_functiondef(p.oid) like '%ai_chime_gap_sec%'
union all select 'existing gap kept (seconds = minutes x 60)', count(*) from public.qqbot_settings where id = 1 and ai_chime_gap_sec = least(7200, greatest(10, ai_chime_gap * 60));
-- 期望：1 / 1 / 1 / 2 / 1（第一次执行时；之后在后台改过秒数，最后一项可能是 0，属正常）
