-- =====================================================================
-- Site Khojo CRM — v1.1: Lead vs Deal, new stages, site types
-- Safe to re-run.
-- =====================================================================

-- 1. Every record is either a Lead or a Deal
alter table public.sites
  add column if not exists record_type text not null default 'deal';
do $$ begin
  alter table public.sites add constraint sites_record_type_chk check (record_type in ('lead', 'deal'));
exception when duplicate_object then null; end $$;
create index if not exists sites_record_type_idx on public.sites (record_type);
create index if not exists sites_site_type_idx on public.sites (site_type);

-- 2. New pipeline stages
insert into public.stages (key, name, sort_order, color, sla_days, category, admin_only) values
  ('site_feasibility', 'Site Feasibility',       4,  '#a855f7', 7,  'active', false),
  ('loi_signed',       'LOI / Agreement Signed', 7,  '#eab308', 10, 'active', false),
  ('deployment_ho',    'Deployment HO',          11, '#06b6d4', 7,  'active', false)
on conflict (key) do nothing;

update public.stages set sort_order = case key
  when 'new_lead' then 1          when 'scouted' then 2           when 'initial_eval' then 3
  when 'site_feasibility' then 4  when 'tech_feasibility' then 5  when 'commercial' then 6
  when 'loi_signed' then 7        when 'documentation' then 8     when 'internal_approval' then 9
  when 'approved' then 10         when 'deployment_ho' then 11    when 'deployment' then 12
  when 'live' then 13             when 'dropped' then 14          else sort_order end;

-- 3. Rebuild the overview view so it includes the new column
drop view if exists public.site_overview;
create view public.site_overview with (security_invoker = true) as
select
  s.*,
  st.name        as stage_name,
  st.color       as stage_color,
  st.category    as stage_category,
  st.sort_order  as stage_order,
  st.sla_days    as stage_sla_days,
  cb.full_name   as created_by_name,
  ab.full_name   as assigned_to_name,
  round((extract(epoch from (now() - s.stage_entered_at)) / 86400.0)::numeric, 1) as days_in_stage,
  (st.category = 'active' and st.sla_days is not null
     and now() - s.stage_entered_at > make_interval(days => st.sla_days)) as is_overdue,
  (select count(*) from public.site_comments c where c.site_id = s.id)::int as comment_count
from public.sites s
join public.stages st on st.id = s.stage_id
left join public.profiles cb on cb.id = s.created_by
left join public.profiles ab on ab.id = s.assigned_to;

grant select on public.site_overview to authenticated;
