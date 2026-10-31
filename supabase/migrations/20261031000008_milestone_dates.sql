-- Site Khojo v1.5: per-day energization counts on network points (from QIS tracker).
-- Pipeline milestone dates live in sites.extra: ho_date, energized_on.
alter table public.network_points add column if not exists energized_dates jsonb;  -- {"YYYY-MM-DD": no. of QIS}
