-- Team logins: add sites and edit site details on any site.
-- Only admins can delete, change stage or reassign owners.

drop policy if exists sites_update on public.sites;
create policy sites_update on public.sites for update to authenticated
  using (public.is_admin() or public.is_active_user())
  with check (public.is_admin() or public.is_active_user());

create or replace function public.sites_team_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.stage_id is distinct from old.stage_id then
    raise exception 'Your login can edit site details only. Ask an admin to change the stage.';
  end if;
  if new.owner is distinct from old.owner or new.assigned_to is distinct from old.assigned_to then
    raise exception 'Your login can edit site details only. Ask an admin to change the owner.';
  end if;
  if new.drop_reason is distinct from old.drop_reason or new.drop_notes is distinct from old.drop_notes then
    raise exception 'Your login can edit site details only. Ask an admin to drop a site.';
  end if;
  return new;
end $$;
drop trigger if exists sites_a_team_guard on public.sites;
create trigger sites_a_team_guard before update on public.sites
  for each row execute function public.sites_team_guard();
