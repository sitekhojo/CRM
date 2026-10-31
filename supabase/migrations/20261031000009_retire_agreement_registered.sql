-- Site Khojo v1.6: Agreement Registered stage retired (no sites were in it)
update public.stages set is_active = false where key = 'agreement_registered';
