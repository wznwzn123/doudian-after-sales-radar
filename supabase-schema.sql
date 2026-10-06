-- 售后雷达 Pro 5.0 云端版
create extension if not exists pgcrypto;

create table if not exists public.after_sales_tasks (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 order_id text not null default '',
 buyer_name text not null default '',
 tracking_no text not null default '',
 after_sales_type text not null default '退款/售后',
 reason text not null default '',
 status text not null default '待处理',
 risk text not null default '普通',
 evidence_reason text not null default '',
 deadline timestamptz,
 submission_status text not null default 'pending',
 monitoring boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.evidence_files (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null references public.after_sales_tasks(id) on delete cascade,
 file_name text not null,
 mime_type text not null default '',
 size_bytes bigint not null default 0,
 storage_path text not null,
 created_at timestamptz not null default now()
);

create table if not exists public.tracking_records (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid references public.after_sales_tasks(id) on delete set null,
 tracking_no text not null,
 carrier text not null default '',
 monitoring boolean not null default true,
 last_match text not null default '',
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

create table if not exists public.after_sales_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 task_id uuid not null references public.after_sales_tasks(id) on delete cascade,
 event_type text not null,
 message text not null default '',
 created_at timestamptz not null default now()
);

create index if not exists tasks_user_idx on public.after_sales_tasks(user_id);
create index if not exists files_task_idx on public.evidence_files(task_id);
create index if not exists tracking_user_idx on public.tracking_records(user_id);
create index if not exists events_task_idx on public.after_sales_events(task_id);

alter table public.after_sales_tasks enable row level security;
alter table public.evidence_files enable row level security;
alter table public.tracking_records enable row level security;
alter table public.after_sales_events enable row level security;

drop policy if exists tasks_owner on public.after_sales_tasks;
create policy tasks_owner on public.after_sales_tasks for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists files_owner on public.evidence_files;
create policy files_owner on public.evidence_files for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists tracking_owner on public.tracking_records;
create policy tracking_owner on public.tracking_records for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists events_owner on public.after_sales_events;
create policy events_owner on public.after_sales_events for all to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets(id,name,public)
values ('after-sales-evidence','after-sales-evidence',false)
on conflict(id) do nothing;

drop policy if exists evidence_objects_insert on storage.objects;
create policy evidence_objects_insert on storage.objects for insert to authenticated
with check (bucket_id='after-sales-evidence' and (storage.foldername(name))[1]=(select auth.jwt()->>'sub'));

drop policy if exists evidence_objects_select on storage.objects;
create policy evidence_objects_select on storage.objects for select to authenticated
using (bucket_id='after-sales-evidence' and (storage.foldername(name))[1]=(select auth.jwt()->>'sub'));

drop policy if exists evidence_objects_delete on storage.objects;
create policy evidence_objects_delete on storage.objects for delete to authenticated
using (bucket_id='after-sales-evidence' and (storage.foldername(name))[1]=(select auth.jwt()->>'sub'));

-- 注意：真正的抖店自动提交仍需官方 API/授权。
-- 本项目的 deadline 自动处理只负责云端状态处理，不能冒充抖店已提交。


-- ============================================================
-- 云端 3 小时后台任务：不依赖用户手机浏览器是否打开
-- Supabase Cron 每分钟执行一次；到期后自动处理本地任务状态。
-- 这不是抖店官方提交，真正抖店提交仍需官方 API/授权。
-- ============================================================

create or replace function public.process_after_sales_deadlines()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select t.id,
           exists (
             select 1
             from public.evidence_files f
             where f.task_id = t.id
               and f.user_id = t.user_id
           ) as has_evidence
    from public.after_sales_tasks t
    where t.status = '待举证'
      and t.submission_status = 'pending'
      and t.deadline is not null
      and t.deadline <= now()
  loop
    if r.has_evidence then
      update public.after_sales_tasks
      set status = '已完成',
          submission_status = 'submitted_auto_local',
          updated_at = now()
      where id = r.id
        and submission_status = 'pending';

      insert into public.after_sales_events(task_id, user_id, event_type, message)
      select r.id, t.user_id, 'deadline_auto_processed',
             '3小时截止，云端检测到举证材料，已自动完成本地处理'
      from public.after_sales_tasks t
      where t.id = r.id;
    else
      update public.after_sales_tasks
      set submission_status = 'failed_no_evidence',
          updated_at = now()
      where id = r.id
        and submission_status = 'pending';

      insert into public.after_sales_events(task_id, user_id, event_type, message)
      select r.id, t.user_id, 'deadline_failed_no_evidence',
             '3小时截止，但没有找到举证材料，未进行本地自动完成'
      from public.after_sales_tasks t
      where t.id = r.id;
    end if;
  end loop;
end;
$$;

revoke all on function public.process_after_sales_deadlines() from public;
revoke all on function public.process_after_sales_deadlines() from anon;
revoke all on function public.process_after_sales_deadlines() from authenticated;
grant execute on function public.process_after_sales_deadlines() to postgres;

-- 启用 Supabase Cron（如果项目尚未启用，先在 Dashboard:
-- Integrations -> Cron 中启用 pg_cron）。
create extension if not exists pg_cron;

select cron.unschedule(jobid)
from cron.job
where jobname = 'after-sales-deadline-every-minute';

select cron.schedule(
  'after-sales-deadline-every-minute',
  '* * * * *',
  $$select public.process_after_sales_deadlines();$$
);
