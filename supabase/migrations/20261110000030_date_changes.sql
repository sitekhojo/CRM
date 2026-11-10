-- History of Expected HO / Expected energisation (and actual HO / energisation) date changes per site.
create table if not exists public.site_date_changes (
  id bigserial primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  field text not null check (field in ('expected_ho', 'expected_en', 'ho_date', 'energized_on')),
  old_value date,
  new_value date,
  changed_by uuid default auth.uid() references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists site_date_changes_site_idx on public.site_date_changes (site_id, field, changed_at);

alter table public.site_date_changes enable row level security;
drop policy if exists site_date_changes_read on public.site_date_changes;
create policy site_date_changes_read on public.site_date_changes for select to authenticated using (public.is_active_user());
revoke all on public.site_date_changes from anon;
grant select on public.site_date_changes to authenticated;

-- Written only by this trigger: every time one of the four dates changes on a site.
create or replace function public.sites_log_date_changes() returns trigger
language plpgsql security definer set search_path = public as $$
declare f text; o text; n text;
begin
  foreach f in array array['expected_ho', 'expected_en', 'ho_date', 'energized_on'] loop
    o := nullif(left(coalesce(old.extra ->> f, ''), 10), '');
    n := nullif(left(coalesce(new.extra ->> f, ''), 10), '');
    if o is distinct from n then
      begin
        insert into public.site_date_changes (site_id, field, old_value, new_value)
        values (new.id, f, o::date, n::date);
      exception when others then null; -- never block a save over an odd date string
      end;
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.sites_log_date_changes() from public, anon, authenticated;
drop trigger if exists sites_log_date_changes on public.sites;
create trigger sites_log_date_changes after update of extra on public.sites
  for each row when (old.extra is distinct from new.extra) execute function public.sites_log_date_changes();
