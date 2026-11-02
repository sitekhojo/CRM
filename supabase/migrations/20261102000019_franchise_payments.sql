-- Franchise payments: proposed amount (sites.extra.payment_proposed) vs received (sum of logged payments).
create table if not exists public.site_payments (
  id bigserial primary key,
  site_id uuid not null references public.sites(id) on delete cascade,
  paid_on date not null default ((now() at time zone 'Asia/Kolkata')::date),
  amount numeric(14,2) not null check (amount <> 0),
  mode text,          -- NEFT / RTGS / UPI / Cheque / Cash / Adjustment
  reference text,     -- UTR / cheque no.
  notes text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists site_payments_site_idx on public.site_payments (site_id);
alter table public.site_payments enable row level security;
drop policy if exists site_payments_read on public.site_payments;
create policy site_payments_read on public.site_payments for select to authenticated using (public.is_active_user());
drop policy if exists site_payments_admin on public.site_payments;
create policy site_payments_admin on public.site_payments for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.site_payments to authenticated;
grant usage, select on sequence public.site_payments_id_seq to authenticated;

-- Proposed amount is admin-only too (extend the dates guard).
create or replace function public.sites_dates_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if (new.extra->>'ho_date') is distinct from (old.extra->>'ho_date')
     or (new.extra->>'energized_on') is distinct from (old.extra->>'energized_on') then
    raise exception 'Only an admin can change handover / energization dates';
  end if;
  if (new.extra->>'payment_proposed') is distinct from (old.extra->>'payment_proposed') then
    raise exception 'Only an admin can change the proposed payment amount';
  end if;
  return new;
end $$;
