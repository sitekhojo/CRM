-- Security hardening.
-- 1) Self sign-ups (anyone calling the public sign-up API) get an INACTIVE profile with no access.
--    Only users created by an admin (Users page → server API sets app_metadata.role) are active.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role;
  v_admin_created boolean := coalesce(new.raw_app_meta_data->>'role', '') in ('admin', 'team');
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
    v_admin_created := true;
  elsif v_admin_created then
    v_role := (new.raw_app_meta_data->>'role')::public.app_role;
  else
    v_role := 'team';
  end if;

  insert into public.profiles (id, email, full_name, role, is_active)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          v_role, v_admin_created)
  on conflict (id) do nothing;
  return new;
end $$;

-- 2) Signed-out visitors (anon) get no table access at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- 3) Nobody calls internal functions through the API; trigger functions run on their own.
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke execute on functions from anon, public;
revoke execute on function public.handle_new_user(), public.profiles_guard(), public.site_visits_guard(),
  public.sites_after_insert(), public.sites_after_update(), public.sites_before_insert(), public.sites_before_update(),
  public.sites_dates_guard(), public.sites_default_owner(), public.sites_ho_hot(), public.sites_milestones()
  from authenticated;
-- Functions the app and the access rules use while signed in.
grant execute on function public.is_admin(), public.is_active_user(), public.stage_allowed(integer, text) to authenticated;
grant execute on function public.log_site_visit(text, double precision, double precision, numeric, text, uuid, text, text, text, text, text) to authenticated;

-- 4) Reference data (network, team, cities, stages, priority locations, settings) only for ACTIVE users.
do $$
declare t text;
begin
  foreach t in array array['app_settings','cities','drop_reasons','network_points','stages','target_locations','team_members'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_active_user())', t || '_read', t);
  end loop;
end $$;
