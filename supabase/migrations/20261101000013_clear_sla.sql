-- SLAs are not defined yet: clear them (is_overdue becomes false everywhere).
-- Previous values, for reference: Scouting 3, Deployment Feasibility 7, LOI Signed 10,
-- Agreement Signed 15, Handover Done 15 (plus retired stages).
update public.stages set sla_days = null;
