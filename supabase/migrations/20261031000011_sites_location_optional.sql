-- Location is optional: sites can be added without coordinates and located later.
alter table public.sites alter column latitude drop not null;
alter table public.sites alter column longitude drop not null;
alter table public.sites drop constraint if exists sites_location_source_check;
alter table public.sites add constraint sites_location_source_check
  check (location_source in ('gps','manual','map','import','none'));
