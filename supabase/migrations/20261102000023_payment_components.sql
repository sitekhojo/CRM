-- Franchise payments are tracked in three parts: FF (franchise fee), SD (security deposit), IC (infra cost).
-- Proposed amounts live in sites.extra (ff_proposed / sd_proposed / ic_proposed); received = site_payments by component.
alter table public.site_payments add column if not exists component text check (component in ('ff', 'sd', 'ic'));
alter table public.site_payments alter column paid_on drop not null;   -- opening balances imported without a date

create or replace function public.sites_dates_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if (new.extra->>'ho_date') is distinct from (old.extra->>'ho_date')
     or (new.extra->>'energized_on') is distinct from (old.extra->>'energized_on') then
    raise exception 'Only an admin can change handover / energization dates';
  end if;
  if (new.extra->>'payment_proposed') is distinct from (old.extra->>'payment_proposed')
     or (new.extra->>'ff_proposed') is distinct from (old.extra->>'ff_proposed')
     or (new.extra->>'sd_proposed') is distinct from (old.extra->>'sd_proposed')
     or (new.extra->>'ic_proposed') is distinct from (old.extra->>'ic_proposed') then
    raise exception 'Only an admin can change proposed payment amounts';
  end if;
  return new;
end $$;
