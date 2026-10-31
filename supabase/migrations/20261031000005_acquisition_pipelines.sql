-- =====================================================================
-- Site Khojo CRM — v1.2: pipelines per acquisition (site) type
--   Private  : Scouting → Deployment Feasibility → Agreement Signed → Agreement Registered
--              → HO Done → Energized → Energized & Commercialized   (+ Dropped)
--   Franchise: same, with LOI Signed after Deployment Feasibility
-- Stages with site_types = NULL apply to every site type.
-- Safe to re-run.
-- =====================================================================

-- 1. Stages can be limited to some site types
alter table public.stages add column if not exists site_types text[];

-- 2. Rename site type Pvt → Private
update public.sites set site_type = 'Private' where site_type in ('Pvt', 'pvt', 'PVT', 'private');

-- 3. New stage set
insert into public.stages (key, name, sort_order, color, sla_days, category, admin_only, site_types) values
  ('scouting',                 'Scouting',                   1, '#3b82f6', 3,    'active',   false, null),
  ('deployment_feasibility',   'Deployment Feasibility',     2, '#8b5cf6', 7,    'active',   false, null),
  ('loi_signed',               'LOI Signed',                 3, '#eab308', 10,   'active',   false, '{Franchise}'),
  ('agreement_signed',         'Agreement Signed',           4, '#f97316', 15,   'approved', true,  null),
  ('agreement_registered',     'Agreement Registered',       5, '#ec4899', 10,   'approved', false, null),
  ('ho_done',                  'HO Done',                    6, '#06b6d4', 15,   'approved', false, null),
  ('energized',                'Energized',                  7, '#14b8a6', 30,   'approved', false, null),
  ('energized_commercialized', 'Energized & Commercialized', 8, '#22c55e', null, 'live',     true,  null)
on conflict (key) do nothing;

update public.stages set name = 'LOI Signed', sort_order = 3, site_types = '{Franchise}', is_active = true,
       category = 'active', color = '#eab308', sla_days = coalesce(sla_days, 10)
 where key = 'loi_signed';
update public.stages set sort_order = 9, is_active = true where key = 'dropped';

-- 4. Move existing records off the old stages (writes a history entry for each), then retire them
create temp table stage_map (old_key text, new_key text) on commit drop;
insert into stage_map values
  ('new_lead', 'scouting'), ('scouted', 'scouting'),
  ('initial_eval', 'deployment_feasibility'), ('site_feasibility', 'deployment_feasibility'),
  ('tech_feasibility', 'deployment_feasibility'), ('commercial', 'deployment_feasibility'),
  ('documentation', 'deployment_feasibility'), ('internal_approval', 'deployment_feasibility'),
  ('approved', 'agreement_signed'), ('deployment_ho', 'ho_done'), ('deployment', 'ho_done'),
  ('live', 'energized_commercialized');

update public.sites s
   set stage_id = ns.id, stage_note = 'Moved to new pipeline (was ' || os.name || ')'
  from stage_map m
  join public.stages os on os.key = m.old_key
  join public.stages ns on ns.key = m.new_key
 where s.stage_id = os.id;

-- Franchise-only stage on a non-franchise site → Deployment Feasibility
update public.sites s
   set stage_id = (select id from public.stages where key = 'deployment_feasibility'),
       stage_note = 'LOI Signed applies to Franchise only'
 where s.stage_id = (select id from public.stages where key = 'loi_signed')
   and s.site_type is distinct from 'Franchise';

update public.stages set is_active = false
 where key in (select old_key from stage_map);

-- 5. Enforce stage ↔ site type in the database
create or replace function public.stage_allowed(p_stage int, p_site_type text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select site_types is null or p_site_type is null or p_site_type = any(site_types)
                     from public.stages where id = p_stage), true);
$$;

create or replace function public.sites_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  if new.stage_id is null then
    select id into new.stage_id from public.stages
     where is_active and category = 'active'
       and (site_types is null or new.site_type is null or new.site_type = any(site_types))
     order by sort_order limit 1;
  end if;
  select * into v_stage from public.stages where id = new.stage_id;

  if not public.stage_allowed(new.stage_id, new.site_type) then
    raise exception 'Stage "%" is only for % sites', v_stage.name, array_to_string(v_stage.site_types, ' / ');
  end if;

  if auth.uid() is not null then
    new.created_by := auth.uid();
    if not v_admin then
      new.assigned_to := auth.uid();
      if v_stage.admin_only then
        raise exception 'Only admins can create a site in stage "%"', v_stage.name;
      end if;
    else
      new.assigned_to := coalesce(new.assigned_to, auth.uid());
    end if;
  end if;

  if v_stage.category = 'dropped' and coalesce(trim(new.drop_reason), '') = '' then
    raise exception 'A drop reason is required';
  end if;

  if (auth.uid() is not null and not v_admin) or new.created_at is null or new.created_at > now() then
    new.created_at := now();
  end if;
  new.updated_at       := now();
  new.updated_by       := new.created_by;
  new.stage_entered_at := now();
  return new;
end $$;

create or replace function public.sites_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  new.id         := old.id;
  new.site_code  := old.site_code;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);

  if auth.uid() is not null and not v_admin
     and new.assigned_to is distinct from old.assigned_to then
    raise exception 'Only admins can reassign sites';
  end if;

  if new.stage_id is distinct from old.stage_id then
    select * into v_stage from public.stages where id = new.stage_id;

    if auth.uid() is not null and not v_admin then
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'You can only change the stage of sites assigned to you';
      end if;
      if v_stage.admin_only then
        raise exception 'Only admins can move a site to "%"', v_stage.name;
      end if;
    end if;

    if v_stage.category = 'dropped' then
      if coalesce(trim(new.drop_reason), '') = '' then
        raise exception 'A drop reason is required';
      end if;
    else
      new.drop_reason := null;
      new.drop_notes  := null;
    end if;
    new.stage_entered_at := now();
  else
    new.stage_entered_at := old.stage_entered_at;
    new.stage_note       := old.stage_note;
  end if;

  if (new.stage_id is distinct from old.stage_id or new.site_type is distinct from old.site_type)
     and not public.stage_allowed(new.stage_id, new.site_type) then
    select * into v_stage from public.stages where id = new.stage_id;
    raise exception 'Stage "%" is only for % sites', v_stage.name, array_to_string(v_stage.site_types, ' / ');
  end if;
  return new;
end $$;

-- 6. SLA applies to every open stage (pipeline + post-agreement), not just "active"
drop view if exists public.site_overview;
create view public.site_overview with (security_invoker = true) as
select
  s.*,
  st.name as stage_name, st.color as stage_color, st.category as stage_category,
  st.sort_order as stage_order, st.sla_days as stage_sla_days,
  cb.full_name as created_by_name, ab.full_name as assigned_to_name,
  round((extract(epoch from (now() - s.stage_entered_at)) / 86400.0)::numeric, 1) as days_in_stage,
  (st.category in ('active', 'approved') and st.sla_days is not null
     and now() - s.stage_entered_at > make_interval(days => st.sla_days)) as is_overdue,
  (select count(*) from public.site_comments c where c.site_id = s.id)::int as comment_count
from public.sites s
join public.stages st on st.id = s.stage_id
left join public.profiles cb on cb.id = s.created_by
left join public.profiles ab on ab.id = s.assigned_to;

grant select on public.site_overview to authenticated;
