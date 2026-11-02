-- New site scouted without creating a lead (e.g. owner details not available yet): store the reason.
alter table public.site_visits add column if not exists no_lead_reason text;
drop function if exists public.log_site_visit(text, double precision, double precision, numeric, text, uuid, text, text, text, text);
create or replace function public.log_site_visit(
  p_member text, p_lat double precision, p_lng double precision, p_accuracy numeric,
  p_type text, p_site uuid default null, p_remarks text default null,
  p_new_name text default null, p_new_city text default null, p_new_site_type text default null,
  p_no_lead_reason text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_site uuid := p_site; v_code text; v_stage int; v_created boolean := false; v_id bigint;
begin
  if not exists (select 1 from public.team_members where name = p_member) then
    raise exception 'Pick your name from the list';
  end if;
  if p_type = 'new_site' and v_site is null and coalesce(btrim(p_no_lead_reason), '') = '' then
    if coalesce(btrim(p_new_name), '') = '' or coalesce(btrim(p_new_city), '') = '' then
      raise exception 'Give the new site a name and city';
    end if;
    select id into v_stage from public.stages
      where is_active and category = 'active' and not coalesce(admin_only, false) order by sort_order limit 1;
    insert into public.sites (name, city, latitude, longitude, location_source, location_accuracy_m, site_type, stage_id, owner, record_type, remarks)
    values (btrim(p_new_name), btrim(p_new_city), p_lat, p_lng, 'gps', p_accuracy, nullif(btrim(p_new_site_type), ''), v_stage, p_member, 'lead', nullif(btrim(p_remarks), ''))
    returning id, site_code into v_site, v_code;
    v_created := true;
  elsif v_site is not null then
    select site_code into v_code from public.sites where id = v_site;
  end if;
  insert into public.site_visits (member, latitude, longitude, accuracy_m, visit_type, site_id, lead_created, remarks, no_lead_reason)
  values (p_member, p_lat, p_lng, p_accuracy, p_type, v_site, v_created, nullif(btrim(p_remarks), ''),
          case when p_type = 'new_site' and v_site is null then nullif(btrim(p_no_lead_reason), '') end)
  returning id into v_id;
  return jsonb_build_object('visit_id', v_id, 'site_id', v_site, 'site_code', v_code, 'lead_created', v_created);
end $$;
grant execute on function public.log_site_visit(text, double precision, double precision, numeric, text, uuid, text, text, text, text, text) to authenticated;
