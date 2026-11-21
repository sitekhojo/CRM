-- Base city of each acquisition team member, used for per-person productivity on the CEO View.
-- 'Delhi NCR' covers Delhi, Gurugram, Noida, Ghaziabad and Faridabad. SPP team members have no base city (not counted).
alter table public.team_members add column if not exists base_city text;

update public.team_members t set base_city = v.city
from (values
  ('Abdul Azim Moloo', 'Mumbai'), ('Amar', 'Mumbai'), ('Kabir', 'Mumbai'),
  ('Pratik', 'Pune'),
  ('Swarnim Singhal', 'Delhi NCR'), ('Shashank', 'Delhi NCR'), ('Sachin', 'Delhi NCR'), ('Ankit', 'Delhi NCR'),
  ('Rakesh', 'Jaipur'), ('Alok', 'Jaipur'),
  ('Naresh', 'Hyderabad'),
  ('Avinash Shaw', 'Bengaluru'), ('Neeman', 'Bengaluru'), ('Yunus', 'Bengaluru'), ('Ilyas', 'Bengaluru'),
  ('Sneh', 'Kolkata')
) as v(name, city)
where t.name = v.name and t.base_city is null;
