-- Handover / energization dates: admin only (set from the list).
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
drop trigger if exists sites_a_dates_guard on public.sites;
create trigger sites_a_dates_guard before update on public.sites
  for each row execute function public.sites_dates_guard();

-- Probability % -> intent (hot >= 80, warm 50-79, cold < 50)
update public.sites set extra = (extra - 'probability') ||
  jsonb_build_object('intent', case when (extra->>'probability')::numeric >= 80 then 'hot' when (extra->>'probability')::numeric >= 50 then 'warm' else 'cold' end)
where extra ? 'probability' and (extra->>'probability') ~ '^[0-9.]+$';
update public.sites set extra = extra - 'probability' where extra ? 'probability';

-- "Energisation: 27 Dec 2026" in remarks -> extra.expected_en
update public.sites set extra = extra || jsonb_build_object('expected_en',
  to_char(to_date(substring(remarks from 'Energisation: (\d{1,2} [A-Za-z]{3} \d{4})'), 'DD Mon YYYY'), 'YYYY-MM-DD'))
where remarks ~ 'Energisation: \d{1,2} [A-Za-z]{3} \d{4}' and not (extra ? 'expected_en')
  and coalesce(extra->>'source','') <> 'qis_tracker';
