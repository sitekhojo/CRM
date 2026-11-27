-- Zonal heads split across the city teams they cover (CEO View productivity: 1 head = 1/n person in each city).
alter table public.team_members add column if not exists covers text[];
update public.team_members set covers = array['Bengaluru','Hyderabad','Chennai'] where name = 'Avinash Shaw';
update public.team_members set covers = array['Delhi NCR','Jaipur'] where name = 'Swarnim Singhal';
update public.team_members set covers = array['Mumbai','Pune'] where name = 'Abdul Azim Moloo';
