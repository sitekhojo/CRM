-- Field visits: the ground team logs every location they visit (GPS only), optionally linked to a lead/deal.
create table if not exists public.site_visits (
  id           bigserial primary key,
  member       text not null references public.team_members(name) on update cascade,
  visited_at   timestamptz not null default now(),
  visit_date   date not null default ((now() at time zone 'Asia/Kolkata')::date),
  latitude     double precision not null check (latitude between -90 and 90),
  longitude    double precision not null check (longitude between -180 and 180),
  accuracy_m   numeric,
  visit_type   text not null check (visit_type in ('new_site', 'follow_up', 'franchisee_meeting', 'discom', 'other')),
  site_id      uuid references public.sites(id) on delete set null,
  lead_created boolean not null default false,
  remarks      text,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists site_visits_date_idx on public.site_visits (visit_date, member);
create index if not exists site_visits_site_idx on public.site_visits (site_id);

alter table public.site_visits enable row level security;
drop policy if exists site_visits_read on public.site_visits;
create policy site_visits_read on public.site_visits for select to authenticated using (public.is_active_user());
drop policy if exists site_visits_insert on public.site_visits;
create policy site_visits_insert on public.site_visits for insert to authenticated with check (public.is_active_user());
drop policy if exists site_visits_update on public.site_visits;
create policy site_visits_update on public.site_visits for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists site_visits_delete on public.site_visits;
create policy site_visits_delete on public.site_visits for delete to authenticated using (public.is_admin());
grant select, insert, update, delete on public.site_visits to authenticated;
grant usage, select on sequence public.site_visits_id_seq to authenticated;

-- Time is always the server's (no backdating). Non-admins may only fix type / lead / remarks, and only on the same day.
create or replace function public.site_visits_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.visited_at := now();
    new.visit_date := (now() at time zone 'Asia/Kolkata')::date;
    new.created_at := now();
    return new;
  end if;
  if auth.uid() is null or public.is_admin() then return new; end if;
  if old.visit_date <> (now() at time zone 'Asia/Kolkata')::date then
    raise exception 'A visit can only be edited on the day it was logged (ask an admin)';
  end if;
  if new.member is distinct from old.member or new.visited_at is distinct from old.visited_at or new.visit_date is distinct from old.visit_date
     or new.latitude is distinct from old.latitude or new.longitude is distinct from old.longitude or new.accuracy_m is distinct from old.accuracy_m then
    raise exception 'Only the visit type, linked lead and remarks can be edited';
  end if;
  return new;
end $$;
drop trigger if exists site_visits_guard on public.site_visits;
create trigger site_visits_guard before insert or update on public.site_visits
  for each row execute function public.site_visits_guard();

-- Log a visit in one step; for a new site scouted with no linked lead, create the lead too.
create or replace function public.log_site_visit(
  p_member text, p_lat double precision, p_lng double precision, p_accuracy numeric,
  p_type text, p_site uuid default null, p_remarks text default null,
  p_new_name text default null, p_new_city text default null, p_new_site_type text default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_site uuid := p_site; v_code text; v_stage int; v_created boolean := false; v_id bigint;
begin
  if not exists (select 1 from public.team_members where name = p_member) then
    raise exception 'Pick your name from the list';
  end if;
  if p_type = 'new_site' and v_site is null then
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
  insert into public.site_visits (member, latitude, longitude, accuracy_m, visit_type, site_id, lead_created, remarks)
  values (p_member, p_lat, p_lng, p_accuracy, p_type, v_site, v_created, nullif(btrim(p_remarks), ''))
  returning id into v_id;
  return jsonb_build_object('visit_id', v_id, 'site_id', v_site, 'site_code', v_code, 'lead_created', v_created);
end $$;
grant execute on function public.log_site_visit(text, double precision, double precision, numeric, text, uuid, text, text, text, text) to authenticated;
