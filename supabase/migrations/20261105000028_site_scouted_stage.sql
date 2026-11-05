-- New stage "Site Scouted" right after Scouting: the site is identified/scouted but property papers are not in yet.
-- Re-uses the old inactive "scouted" stage row.
update public.stages set name = 'Site Scouted', is_active = true, category = 'active', sort_order = 2, color = '#0ea5e9', admin_only = false where key = 'scouted';
update public.stages set sort_order = 3 where key = 'deployment_feasibility';
update public.stages set sort_order = 4 where key = 'loi_signed';
update public.stages set sort_order = 5 where key = 'agreement_signed';
