-- =====================================================================
-- Site Khojo CRM — default configuration (safe to re-run)
-- Edit later from the app: Admin → Settings
-- =====================================================================

insert into public.stages (key, name, sort_order, color, sla_days, category, admin_only) values
  ('new_lead',          'New Lead',               1,  '#94a3b8', 3,    'active',   false),
  ('scouted',           'Scouted',                2,  '#3b82f6', 5,    'active',   false),
  ('initial_eval',      'Initial Evaluation',     3,  '#6366f1', 7,    'active',   false),
  ('tech_feasibility',  'Technical Feasibility',  4,  '#8b5cf6', 10,   'active',   false),
  ('commercial',        'Commercial Negotiation', 5,  '#f59e0b', 14,   'active',   false),
  ('documentation',     'Documentation',          6,  '#f97316', 14,   'active',   false),
  ('internal_approval', 'Internal Approval',      7,  '#ec4899', 7,    'active',   false),
  ('approved',          'Approved',               8,  '#14b8a6', null, 'approved', true),
  ('deployment',        'Deployment',             9,  '#0ea5e9', 30,   'active',   false),
  ('live',              'Live',                   10, '#22c55e', null, 'live',     true),
  ('dropped',           'Dropped',                11, '#ef4444', null, 'dropped',  false)
on conflict (key) do nothing;

insert into public.cities (name, state) values
  ('Bengaluru', 'Karnataka'), ('Delhi', 'Delhi'), ('Gurugram', 'Haryana'), ('Noida', 'Uttar Pradesh'),
  ('Ghaziabad', 'Uttar Pradesh'), ('Faridabad', 'Haryana'), ('Hyderabad', 'Telangana'), ('Chennai', 'Tamil Nadu'),
  ('Mumbai', 'Maharashtra'), ('Pune', 'Maharashtra'), ('Kolkata', 'West Bengal'), ('Jaipur', 'Rajasthan'),
  ('Ahmedabad', 'Gujarat'), ('Lucknow', 'Uttar Pradesh'), ('Chandigarh', 'Chandigarh'), ('Indore', 'Madhya Pradesh'),
  ('Patna', 'Bihar'), ('Bhubaneswar', 'Odisha'), ('Kochi', 'Kerala'), ('Coimbatore', 'Tamil Nadu'),
  ('Visakhapatnam', 'Andhra Pradesh'), ('Nagpur', 'Maharashtra'), ('Surat', 'Gujarat')
on conflict (name) do nothing;

insert into public.drop_reasons (label) values
  ('Landlord not interested'), ('Rent too high'), ('Power not feasible'), ('Too close to existing station'),
  ('Low demand / footfall'), ('Space too small'), ('Legal / documentation issue'), ('Access / visibility issue'),
  ('Competitor already present'), ('Duplicate entry'), ('Other')
on conflict (label) do nothing;

-- Feasibility rules used by Network Planning (distances in metres)
insert into public.app_settings (key, value) values
  ('feasibility_rules', '{
     "search_radius_m": 3000,
     "min_distance_own_station_m": 1500,
     "ideal_max_distance_own_station_m": 5000,
     "duplicate_radius_m": 150,
     "competitor_radius_m": 1000,
     "max_competitors_in_radius": 2,
     "demand_radius_m": 2000,
     "min_demand_points": 1,
     "restricted_radius_m": 200
   }'::jsonb)
on conflict (key) do nothing;
