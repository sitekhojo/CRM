-- Network-plan zones (Z0 / Z1 / Z2 / ZN) from the Indofast network map.
-- Every site gets its zone from its lat/long, worked out live in site_overview, so new sites are tagged the
-- moment they're saved and every site is re-tagged when a new map version is uploaded (Settings → Zones).
--   Z0 = build first, Z1 = add capacity, Z2 = add coverage (incl. the map's "covered by planned QIS" variants)
--   ZN = no build: the map's Zx, gated (fails the demand gate) and restricted-land zones.
create extension if not exists postgis with schema extensions;

create table if not exists public.zones (
  id          text primary key,              -- map zone id, e.g. BLR_0076
  name        text not null,
  city        text,
  zone        text not null check (zone in ('Z0', 'Z1', 'Z2', 'ZN')),
  zone_class  text,                          -- map class: Z0, Z0c, Z1, Z1c, Z2, Z2c, Zx, G, R
  label       text,                          -- map description, e.g. "Z0 – build first"
  score       numeric,
  geom        extensions.geometry(MultiPolygon, 4326) not null,
  version     text,
  uploaded_at timestamptz not null default now()
);
create index if not exists zones_geom_idx on public.zones using gist (geom);
alter table public.zones enable row level security;
drop policy if exists zones_read on public.zones;
create policy zones_read on public.zones for select to authenticated using (public.is_active_user());

create or replace function public.zone_class_to_zone(c text) returns text language sql immutable as $$
  select case when c like 'Z0%' then 'Z0' when c like 'Z1%' then 'Z1' when c in ('Z2', 'Z2c') then 'Z2' else 'ZN' end
$$;

-- Admin upload, in batches. rows: [{id, name, city, cls, label, score, geojson}] with geojson a (Multi)Polygon in lon/lat.
create or replace function public.zones_upload(rows jsonb, replace_all boolean default false, map_version text default null)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare n integer;
begin
  if not public.is_admin() then raise exception 'Only admins can upload zones'; end if;
  if replace_all then delete from public.zones where true; end if;
  insert into public.zones (id, name, city, zone, zone_class, label, score, geom, version)
  select r->>'id', coalesce(r->>'name', r->>'id'), r->>'city', public.zone_class_to_zone(r->>'cls'), r->>'cls', r->>'label',
         nullif(r->>'score', '')::numeric,
         st_multi(st_collectionextract(st_makevalid(st_setsrid(st_geomfromgeojson(r->>'geojson'), 4326)), 3)),
         map_version
    from jsonb_array_elements(rows) r
  on conflict (id) do update set name = excluded.name, city = excluded.city, zone = excluded.zone, zone_class = excluded.zone_class,
    label = excluded.label, score = excluded.score, geom = excluded.geom, version = excluded.version, uploaded_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.zones_upload(jsonb, boolean, text) from public, anon;
grant execute on function public.zones_upload(jsonb, boolean, text) to authenticated;

-- Zone at a point (used by the create-site form). Smallest zone wins if two overlap.
create or replace function public.zone_at(lat double precision, lng double precision)
returns table (id text, name text, city text, zone text, zone_class text, label text)
language sql stable security invoker set search_path = public, extensions as $$
  select z.id, z.name, z.city, z.zone, z.zone_class, z.label
    from public.zones z
   where lat is not null and lng is not null and st_intersects(z.geom, st_setsrid(st_point(lng, lat), 4326))
   order by st_area(z.geom) limit 1
$$;
grant execute on function public.zone_at(double precision, double precision) to authenticated;

-- site_overview: + zone, zone_id, zone_name, zone_class (new columns appended at the end)
create or replace view public.site_overview with (security_invoker = true) as
 SELECT s.id, s.site_code, s.name, s.address, s.city, s.pincode, s.latitude, s.longitude, s.location_source, s.location_accuracy_m,
    s.site_type, s.area_sqft, s.landlord_name, s.landlord_phone, s.landlord_email, s.landlord_notes, s.rent_expectation,
    s.deposit_expectation, s.rent_negotiable, s.observations, s.power_available, s.power_phase, s.sanctioned_load_kw,
    s.power_feasibility, s.power_notes, s.remarks, s.stage_id, s.stage_entered_at, s.stage_note, s.drop_reason, s.drop_notes,
    s.assigned_to, s.created_by, s.created_at, s.updated_by, s.updated_at, s.extra, s.record_type,
    st.name AS stage_name, st.color AS stage_color, st.category AS stage_category, st.sort_order AS stage_order, st.sla_days AS stage_sla_days,
    cb.full_name AS created_by_name, ab.full_name AS assigned_to_name,
    round(EXTRACT(epoch FROM now() - s.stage_entered_at) / 86400.0, 1) AS days_in_stage,
    (st.category = ANY (ARRAY['active'::text, 'approved'::text])) AND st.sla_days IS NOT NULL AND (now() - s.stage_entered_at) > make_interval(days => st.sla_days) AS is_overdue,
    (( SELECT count(*) AS count FROM site_comments c WHERE c.site_id = s.id))::integer AS comment_count,
    s.owner, ci.region,
    zn.zone, zn.id AS zone_id, zn.name AS zone_name, zn.zone_class
   FROM sites s
     JOIN stages st ON st.id = s.stage_id
     LEFT JOIN profiles cb ON cb.id = s.created_by
     LEFT JOIN profiles ab ON ab.id = s.assigned_to
     LEFT JOIN LATERAL ( SELECT c.region FROM cities c WHERE lower(c.name) = lower(s.city) LIMIT 1) ci ON true
     LEFT JOIN LATERAL ( SELECT z.zone, z.id, z.name, z.zone_class FROM zones z
          WHERE s.latitude IS NOT NULL AND s.longitude IS NOT NULL
            AND extensions.st_intersects(z.geom, extensions.st_setsrid(extensions.st_point(s.longitude, s.latitude), 4326))
          ORDER BY extensions.st_area(z.geom) LIMIT 1) zn ON true;
