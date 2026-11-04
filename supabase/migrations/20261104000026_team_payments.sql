-- Team login can log payments (FF / SD / IC) and set proposed amounts. Deleting / editing a logged payment stays admin-only.
drop policy if exists site_payments_admin on public.site_payments;
drop policy if exists site_payments_insert on public.site_payments;
create policy site_payments_insert on public.site_payments for insert to authenticated with check (public.is_active_user());
drop policy if exists site_payments_update on public.site_payments;
create policy site_payments_update on public.site_payments for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists site_payments_delete on public.site_payments;
create policy site_payments_delete on public.site_payments for delete to authenticated using (public.is_admin());

-- created_by is always the person logging it.
create or replace function public.site_payments_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then new.created_by := auth.uid(); new.created_at := now(); end if;
  return new;
end $$;
revoke execute on function public.site_payments_stamp() from public, anon, authenticated;
drop trigger if exists site_payments_stamp on public.site_payments;
create trigger site_payments_stamp before insert on public.site_payments
  for each row execute function public.site_payments_stamp();

-- Proposed amounts are no longer admin-only; HO / energization dates still are.
create or replace function public.sites_dates_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if (new.extra->>'ho_date') is distinct from (old.extra->>'ho_date')
     or (new.extra->>'energized_on') is distinct from (old.extra->>'energized_on') then
    raise exception 'Only an admin can change handover / energization dates';
  end if;
  return new;
end $$;
