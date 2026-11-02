-- Handover Done (and Energized) sites are always Deals; Handover Done is always Hot.
create or replace function public.sites_ho_hot() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select key into k from public.stages where id = new.stage_id;
  if k in ('ho_done', 'energized') then
    new.record_type := 'deal';
  end if;
  if k = 'ho_done' then
    new.extra := coalesce(new.extra, '{}'::jsonb) || '{"intent":"hot"}'::jsonb;
  end if;
  return new;
end $$;

update public.sites s set record_type = 'deal'
from public.stages st where st.id = s.stage_id and st.key in ('ho_done', 'energized') and s.record_type = 'lead';
