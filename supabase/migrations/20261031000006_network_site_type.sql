-- Site Khojo v1.3: site type on network points (Franchise / Private / SPP / IOCL / Metro & Railways)
alter table public.network_points add column if not exists site_type text;
create index if not exists network_points_site_type_idx on public.network_points (site_type);

update public.network_points np set site_type = case
    when lbl in ('franchise') then 'Franchise'
    when lbl in ('private','hub-private','hub private','hub-pvt','private hub','pvt hub','priavte','pinkbull pvt') then 'Private'
    when lbl = 'iocl' then 'IOCL'
    when lbl in ('indian railways','railways','railway','dmrc','bmrcl','mmmocl','dmrc-navnirmaan','ngo dmrc','bypl dmrc') then 'Metro & Railways'
    else 'SPP' end
from (select id, lower(trim(split_part(notes, ' · ', 2))) lbl from public.network_points where point_type = 'own_station') t
where np.id = t.id and np.site_type is null;

update public.sites set site_type = 'Metro & Railways' where site_type in ('Metro', 'Railways');
