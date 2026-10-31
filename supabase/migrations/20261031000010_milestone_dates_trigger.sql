-- Site Khojo v1.7: auto-stamp handover / energization dates (sites.extra.ho_date / energized_on)
-- and keep "days in stage" aligned when those dates are edited.
create or replace function public.sites_milestones()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text;
  today text := to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD');
begin
  select key into k from public.stages where id = new.stage_id;
  new.extra := coalesce(new.extra, '{}'::jsonb);
  if tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id then
    if k = 'ho_done' and coalesce(new.extra->>'ho_date', '') = '' then
      new.extra := new.extra || jsonb_build_object('ho_date', today);
    end if;
    if k = 'energized' and coalesce(new.extra->>'energized_on', '') = '' then
      new.extra := new.extra || jsonb_build_object('energized_on', today);
    end if;
  end if;
  if tg_op = 'UPDATE' and new.stage_id = old.stage_id then
    if k = 'ho_done' and coalesce(new.extra->>'ho_date', '') <> ''
       and new.extra->>'ho_date' is distinct from old.extra->>'ho_date' then
      new.stage_entered_at := (new.extra->>'ho_date')::date + interval '6 hours';
    end if;
    if k = 'energized' and coalesce(new.extra->>'energized_on', '') <> ''
       and new.extra->>'energized_on' is distinct from old.extra->>'energized_on' then
      new.stage_entered_at := (new.extra->>'energized_on')::date + interval '6 hours';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists sites_milestones on public.sites;
create trigger sites_milestones before insert or update on public.sites
  for each row execute function public.sites_milestones();
