-- Remarks history: who conveyed it (team member), and whether it came from a sync-up call.
alter table public.site_comments add column if not exists said_by text;
alter table public.site_comments add column if not exists kind text not null default 'comment' check (kind in ('comment', 'sync'));
create index if not exists site_comments_site_idx on public.site_comments (site_id, created_at desc);
-- Time is always the server's.
create or replace function public.site_comments_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin new.created_at := now(); return new; end $$;
revoke execute on function public.site_comments_stamp() from public, anon, authenticated;
drop trigger if exists site_comments_stamp on public.site_comments;
create trigger site_comments_stamp before insert on public.site_comments for each row execute function public.site_comments_stamp();
