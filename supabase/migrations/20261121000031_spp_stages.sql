-- Strategic Partnerships (SPP) get their own flow:
--   Site Scouted → CPT Approved → PESO Applied → PESO Approved → Handover Done (+ Energized, Hold, Dropped)
-- Franchise / Private keep: Scouting → Site Scouted → Deployment Feasibility → LOI Signed → Agreement Signed → Handover Done …
-- Site Scouted, Handover Done, Energized, Hold and Dropped stay shared by every site type.

insert into public.stages (key, name, sort_order, category, color, is_active, admin_only, site_types)
values
  ('cpt_approved',  'CPT Approved',  3, 'active', '#6366f1', true, false, array['SPP']),
  ('peso_applied',  'PESO Applied',  4, 'active', '#a855f7', true, false, array['SPP']),
  ('peso_approved', 'PESO Approved', 5, 'active', '#d946ef', true, false, array['SPP'])
on conflict (key) do update
  set name = excluded.name, sort_order = excluded.sort_order, category = excluded.category,
      color = excluded.color, is_active = true, site_types = excluded.site_types;

update public.stages set site_types = array['Franchise', 'Private']
 where key in ('scouting', 'deployment_feasibility', 'loi_signed', 'agreement_signed');
