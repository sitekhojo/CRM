-- =====================================================================
-- Site Khojo CRM — grants + row level security
-- =====================================================================

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_admin(), public.is_active_user() to authenticated;
revoke all on all tables in schema public from anon;

alter table public.profiles            enable row level security;
alter table public.stages              enable row level security;
alter table public.cities              enable row level security;
alter table public.drop_reasons        enable row level security;
alter table public.sites               enable row level security;
alter table public.site_stage_history  enable row level security;
alter table public.network_points      enable row level security;
alter table public.app_settings        enable row level security;
alter table public.site_comments       enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
-- inserts happen via the auth trigger; deletes via auth.users cascade

-- ---------- config tables: everyone reads, admins write ----------
do $$
declare t text;
begin
  foreach t in array array['stages', 'cities', 'drop_reasons', 'network_points', 'app_settings'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (true)', t);
    execute format('drop policy if exists %1$s_admin on public.%1$s', t);
    execute format('create policy %1$s_admin on public.%1$s for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ---------- sites ----------
-- Every active user can SEE all sites (avoids duplicate scouting on the map);
-- team members EDIT only sites they created or are assigned to.
drop policy if exists sites_select on public.sites;
create policy sites_select on public.sites for select to authenticated
  using (public.is_active_user());
drop policy if exists sites_insert on public.sites;
create policy sites_insert on public.sites for insert to authenticated
  with check (public.is_active_user());
drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites for update to authenticated
  using (public.is_admin() or (public.is_active_user() and (created_by = auth.uid() or assigned_to = auth.uid())))
  with check (public.is_admin() or (public.is_active_user() and (created_by = auth.uid() or assigned_to = auth.uid())));
drop policy if exists sites_delete on public.sites;
create policy sites_delete on public.sites for delete to authenticated
  using (public.is_admin());

-- ---------- stage history (written only by triggers) ----------
drop policy if exists ssh_select on public.site_stage_history;
create policy ssh_select on public.site_stage_history for select to authenticated
  using (public.is_active_user());
revoke insert, update, delete on public.site_stage_history from authenticated;

-- ---------- comments ----------
drop policy if exists comments_select on public.site_comments;
create policy comments_select on public.site_comments for select to authenticated
  using (public.is_active_user());
drop policy if exists comments_insert on public.site_comments;
create policy comments_insert on public.site_comments for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid());
drop policy if exists comments_delete on public.site_comments;
create policy comments_delete on public.site_comments for delete to authenticated
  using (public.is_admin() or author_id = auth.uid());
revoke update on public.site_comments from authenticated;
