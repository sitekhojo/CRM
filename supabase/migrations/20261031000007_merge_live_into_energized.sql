-- Site Khojo v1.4: Energized (commercialized or not) is the final stage; Live retired.
update public.stages set name = 'Energized', category = 'live', sla_days = null, sort_order = 7, is_active = true where key = 'energized';
update public.sites set stage_id = (select id from public.stages where key = 'energized'), stage_note = 'Live merged into Energized'
 where stage_id = (select id from public.stages where key = 'live');
update public.stages set is_active = false where key = 'live';
update public.stages set sort_order = 8 where key = 'hold';
update public.stages set sort_order = 9 where key = 'dropped';
