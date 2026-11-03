-- Login activity: every sign-in, and the first time the app is opened on a device each day.
create table if not exists public.login_events (
  id          bigserial primary key,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  email       text,
  event       text not null check (event in ('sign_in', 'open')),
  device_id   text,          -- random id kept in the browser, so devices on a shared login can be told apart
  device      text,          -- Phone / Tablet / Computer
  browser     text,          -- e.g. Chrome on Android
  member_hint text,          -- name last picked on Log visit on this device
  at          timestamptz not null default now(),
  day         date not null default ((now() at time zone 'Asia/Kolkata')::date)
);
create index if not exists login_events_day_idx on public.login_events (day, user_id);

alter table public.login_events enable row level security;
drop policy if exists login_events_insert on public.login_events;
create policy login_events_insert on public.login_events for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());
drop policy if exists login_events_admin on public.login_events;
create policy login_events_admin on public.login_events for select to authenticated using (public.is_admin());
grant select, insert on public.login_events to authenticated;
grant usage, select on sequence public.login_events_id_seq to authenticated;

create or replace function public.login_events_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.at := now();
  new.day := (now() at time zone 'Asia/Kolkata')::date;
  new.user_id := auth.uid();
  select email into new.email from public.profiles where id = auth.uid();
  return new;
end $$;
revoke execute on function public.login_events_stamp() from public, anon, authenticated;
drop trigger if exists login_events_stamp on public.login_events;
create trigger login_events_stamp before insert on public.login_events
  for each row execute function public.login_events_stamp();
