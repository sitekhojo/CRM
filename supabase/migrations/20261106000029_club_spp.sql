-- Site types are now Franchise / Private / SPP. IOCL and Metro & Railways are clubbed into SPP.
-- The original label is kept: sites.extra.original_site_type, network_points.notes.
update public.sites
   set extra = coalesce(extra, '{}'::jsonb) || jsonb_build_object('original_site_type', site_type), site_type = 'SPP'
 where site_type in ('IOCL', 'Metro & Railways');
update public.network_points
   set notes = trim(both ' ' from concat_ws(' · ', nullif(notes, ''), 'was ' || site_type)), site_type = 'SPP'
 where site_type in ('IOCL', 'Metro & Railways');
