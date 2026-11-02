-- Handover Done sites are always Hot.
create or replace function public.sites_ho_hot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select key from public.stages where id = new.stage_id) = 'ho_done' then
    new.extra := coalesce(new.extra, '{}'::jsonb) || '{"intent":"hot"}'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists sites_z_ho_hot on public.sites;
create trigger sites_z_ho_hot before insert or update on public.sites
  for each row execute function public.sites_ho_hot();

update public.sites s set extra = coalesce(s.extra, '{}'::jsonb) || '{"intent":"hot"}'::jsonb
from public.stages st where st.id = s.stage_id and st.key = 'ho_done' and coalesce(s.extra->>'intent','') <> 'hot';
