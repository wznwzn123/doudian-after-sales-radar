-- 售后雷达 Pro 6.39.4：QQ 群 AI「主动接话」的间隔最短 1 秒（v6_41 是 10 秒）
-- （需要在 SQL Editor 执行；只有 1 段，末尾有核对查询）
-- 状态：待用户执行。可重复执行。依赖 v6_41（已于 2026-10-14 执行）。
--
-- 用户 2026-10-14：「我想让他主动接话，最低为 1 秒」。
--   * ai_chime_gap_sec 的范围 10～7200 → 1～7200；admin_qqbot_save_ai 同样放宽。现有设置不变。
--   * 不变的保护：每天上限（全站 / 每群，和 @ 回复共用）；手机脚本在等 AI 回复时同一个群不会再发第二个请求。
-- 回滚：update public.qqbot_settings set ai_chime_gap_sec = greatest(ai_chime_gap_sec, 10);
--       alter table public.qqbot_settings drop constraint if exists qqbot_settings_ai_chime_gap_sec_check, add constraint qqbot_settings_ai_chime_gap_sec_check check (ai_chime_gap_sec between 10 and 7200);
--       再执行 v6_41 里 admin_qqbot_save_ai 的定义。

alter table public.qqbot_settings drop constraint if exists qqbot_settings_ai_chime_gap_sec_check;
alter table public.qqbot_settings add constraint qqbot_settings_ai_chime_gap_sec_check check (ai_chime_gap_sec between 1 and 7200);

-- 管理员：保存 AI 设定（v6_41，只把间隔下限 10 秒改成 1 秒）。间隔优先看 ai_chime_gap_sec（秒）；只传 ai_chime_gap（分钟，旧页面）时换算；都没传保持原值
create or replace function public.admin_qqbot_save_ai(p jsonb) returns jsonb language plpgsql security definer set search_path to 'public' as $f$ declare nm text := btrim(coalesce(p ->> 'ai_name', '')); st text := btrim(coalesce(p ->> 'ai_style', '')); lim int; glim int; rate int; gsec int; chime boolean; cur public.qqbot_settings%rowtype; begin if not public.qqbot_admin_ok() then raise exception '没有管理员权限'; end if; select * into cur from public.qqbot_settings where id = 1; if char_length(nm) < 1 or char_length(nm) > 20 then return jsonb_build_object('ok', false, 'message', 'AI 的名字要 1～20 个字'); end if; if char_length(st) > 500 then return jsonb_build_object('ok', false, 'message', '语气说明最多 500 字'); end if; lim := case when coalesce(p ->> 'ai_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_daily_limit')::int else -1 end; glim := case when coalesce(p ->> 'ai_group_daily_limit', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_group_daily_limit')::int else -1 end; if lim < 0 or lim > 5000 then return jsonb_build_object('ok', false, 'message', '全站每天上限要在 0～5000 之间'); end if; if glim < 0 or glim > 1000 then return jsonb_build_object('ok', false, 'message', '每个群每天上限要在 0～1000 之间'); end if;
  rate := case when p ? 'ai_chime_rate' then case when coalesce(p ->> 'ai_chime_rate', '') ~ '^[0-9]{1,3}$' then (p ->> 'ai_chime_rate')::int else -1 end else cur.ai_chime_rate end;
  gsec := case when p ? 'ai_chime_gap_sec' then case when coalesce(p ->> 'ai_chime_gap_sec', '') ~ '^[0-9]{1,5}$' then (p ->> 'ai_chime_gap_sec')::int else -1 end
               when p ? 'ai_chime_gap' then case when coalesce(p ->> 'ai_chime_gap', '') ~ '^[0-9]{1,4}$' and (p ->> 'ai_chime_gap')::int between 1 and 120 then (p ->> 'ai_chime_gap')::int * 60 else -1 end
               else cur.ai_chime_gap_sec end;
  chime := case when p ? 'ai_chime' then coalesce((p ->> 'ai_chime')::boolean, false) else cur.ai_chime end;
  if rate < 1 or rate > 100 then return jsonb_build_object('ok', false, 'message', '主动接话的概率要在 1%～100% 之间'); end if;
  if gsec < 1 or gsec > 7200 then return jsonb_build_object('ok', false, 'message', '主动接话的间隔要在 1～7200 秒之间'); end if;
  update public.qqbot_settings set ai_enabled = coalesce((p ->> 'ai_enabled')::boolean, false), ai_name = nm, ai_style = st, ai_daily_limit = lim, ai_group_daily_limit = glim, ai_chime = chime, ai_chime_rate = rate, ai_chime_gap_sec = gsec, ai_chime_gap = least(120, greatest(1, ceil(gsec / 60.0)::int)), updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.admin_operation_logs (user_id, action, detail) values (auth.uid(), 'qqbot_ai', 'QQ 机器人 AI 聊天：' || case when coalesce((p ->> 'ai_enabled')::boolean, false) then '开启' else '关闭' end || '，名字「' || nm || '」，每天最多 ' || lim || ' 次（每群 ' || glim || ' 次）' || case when chime then '，主动接话 ' || rate || '%、间隔 ' || gsec || ' 秒' else '，不主动接话' end);
  return jsonb_build_object('ok', true); end $f$;

revoke execute on function public.admin_qqbot_save_ai(jsonb) from public, anon, authenticated;
grant execute on function public.admin_qqbot_save_ai(jsonb) to authenticated;

-- 核对
select 'gap can be 1 second' as check, count(*) as n from pg_constraint where conrelid = 'public.qqbot_settings'::regclass and conname = 'qqbot_settings_ai_chime_gap_sec_check' and pg_get_constraintdef(oid) like '%>= 1)%'
union all select 'save_ai accepts 1 second (login only)', count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'admin_qqbot_save_ai' and pg_get_functiondef(p.oid) like '%gsec < 1 or gsec > 7200%' and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
union all select 'current settings kept', count(*) from public.qqbot_settings where id = 1 and ai_chime_gap_sec between 1 and 7200;
-- 期望：1 / 1 / 1
