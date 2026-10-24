-- WalkPSU initial schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- Identity: auth.jwt()->>'sub' is the Auth0 user id, or the Supabase anonymous user id in fallback mode.

create type drop_type as enum ('minigame', 'photo_hunt', 'checkin');
create type drop_status as enum ('active', 'claimed', 'expired');

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color text not null
);

create table players (
  id uuid primary key default gen_random_uuid(),
  auth_id text not null unique default (auth.jwt()->>'sub'),
  display_name text not null check (char_length(display_name) between 1 and 32),
  team_id uuid not null references teams(id),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table drops (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type drop_type not null,
  lat double precision not null,
  lng double precision not null,
  points integer not null default 10 check (points > 0),
  status drop_status not null default 'active',
  hint_photo_url text,
  created_by uuid references players(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table claims (
  id uuid primary key default gen_random_uuid(),
  drop_id uuid not null unique references drops(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  team_id uuid not null references teams(id),
  created_at timestamptz not null default now()
);

create index claims_team_id_idx on claims(team_id);
create index drops_status_idx on drops(status);

create view team_scores with (security_invoker = true) as
select
  t.id as team_id,
  t.name,
  t.color,
  coalesce(sum(d.points), 0)::integer as points,
  count(c.id)::integer as claims
from teams t
left join claims c on c.team_id = t.id
left join drops d on d.id = c.drop_id
group by t.id;

insert into teams (name, color) values
  ('Nittany Lions', '#1E407C'),
  ('Creamery Crew', '#E8A33D'),
  ('Beaver Blitz', '#C8102E'),
  ('Old Main Owls', '#2E8540');

-- Admin = Auth0 role claim (set by the Auth0 Action) or players.is_admin (fallback mode, set by hand).
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt()->>'app_role', '') = 'admin'
    or exists (select 1 from players where auth_id = auth.jwt()->>'sub' and is_admin);
$$;

create function distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- The only way to create a claim: atomic, first player wins, must be within 60 m of the drop.
create function claim_drop(p_drop_id uuid, p_lat double precision, p_lng double precision)
returns claims language plpgsql security definer set search_path = public as $$
declare
  v_player players;
  v_drop drops;
  v_claim claims;
begin
  select * into v_player from players where auth_id = auth.jwt()->>'sub';
  if not found then
    raise exception 'Join a team before claiming drops';
  end if;

  select * into v_drop from drops where id = p_drop_id for update;
  if not found then
    raise exception 'Drop not found';
  end if;
  if v_drop.status <> 'active' or v_drop.expires_at <= now() then
    raise exception 'This drop is no longer available';
  end if;
  if distance_m(p_lat, p_lng, v_drop.lat, v_drop.lng) > 60 then
    raise exception 'Get closer to claim this drop';
  end if;

  update drops set status = 'claimed' where id = p_drop_id;
  insert into claims (drop_id, player_id, team_id)
  values (p_drop_id, v_player.id, v_player.team_id)
  returning * into v_claim;
  return v_claim;
end;
$$;

revoke execute on function claim_drop from public, anon;
grant execute on function claim_drop to authenticated;

-- Row Level Security
alter table teams enable row level security;
alter table players enable row level security;
alter table drops enable row level security;
alter table claims enable row level security;

create policy "teams are public" on teams for select using (true);

create policy "authenticated read players" on players for select to authenticated using (true);
create policy "create own player" on players for insert to authenticated
  with check (auth_id = auth.jwt()->>'sub');
create policy "update own player" on players for update to authenticated
  using (auth_id = auth.jwt()->>'sub') with check (auth_id = auth.jwt()->>'sub');

-- Players may only write these columns; is_admin is changed by hand in the dashboard.
revoke insert, update on players from anon, authenticated;
grant insert (display_name, team_id) on players to authenticated;
grant update (display_name, team_id) on players to authenticated;

create policy "authenticated read drops" on drops for select to authenticated using (true);
create policy "admins insert drops" on drops for insert to authenticated with check (is_admin());
create policy "admins update drops" on drops for update to authenticated using (is_admin()) with check (is_admin());
create policy "admins delete drops" on drops for delete to authenticated using (is_admin());

create policy "authenticated read claims" on claims for select to authenticated using (true);

-- Realtime
alter publication supabase_realtime add table drops, claims;

-- Storage: public bucket for drop hint photos, admin-only uploads
insert into storage.buckets (id, name, public) values ('drop-hints', 'drop-hints', true);
create policy "admins upload hint photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'drop-hints' and public.is_admin());
