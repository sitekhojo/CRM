-- Team logins may also change stage and owner. Only deleting stays admin-only.
drop trigger if exists sites_a_team_guard on public.sites;
drop function if exists public.sites_team_guard();

create or replace function public.sites_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_stage public.stages;
  v_admin boolean := public.is_admin();
begin
  new.id         := old.id;
  new.site_code  := old.site_code;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);

  if new.stage_id is distinct from old.stage_id then
    select * into v_stage from public.stages where id = new.stage_id;
    if auth.uid() is not null and not v_admin and v_stage.admin_only then
      raise exception 'Only admins can move a site to "%"', v_stage.name;
    end if;
    if v_stage.category = 'dropped' then
      if coalesce(trim(new.drop_reason), '') = '' then
        raise exception 'A drop reason is required';
      end if;
    else
      new.drop_reason := null;
      new.drop_notes  := null;
    end if;
    new.stage_entered_at := now();
  else
    new.stage_entered_at := old.stage_entered_at;
    new.stage_note       := old.stage_note;
  end if;

  if (new.stage_id is distinct from old.stage_id or new.site_type is distinct from old.site_type)
     and not public.stage_allowed(new.stage_id, new.site_type) then
    select * into v_stage from public.stages where id = new.stage_id;
    raise exception 'Stage "%" is only for % sites', v_stage.name, array_to_string(v_stage.site_types, ' / ');
  end if;
  return new;
end $$;
