-- Photo hunts: an admin posts a photo of a campus spot plus a twist ("with a thumbs up"). Players find the spot and
-- photograph it; Gemini judges the photo in web/api/verify-photo.ts, which then records the claim with the service key.
-- The spot stays hidden until the first find. Then its pin is revealed and the hunt stays open 7 more minutes,
-- each later finder earning half the points of the one before.

alter table drops add column twist text;
alter table drops add column search_radius_m integer;
alter table drops add column first_found_at timestamptz;

-- Where a hunt really is. Until the first find, drops.lat/lng is the center of a search circle around this spot,
-- and drops.building_num is null so the map's building highlight doesn't give it away.
alter table drop_secrets add column hunt_lat double precision;
alter table drop_secrets add column hunt_lng double precision;
alter table drop_secrets add column hunt_building_num text;

-- Each claim records what it earned: a photo hunt's later finders earn less than the drop's points.
alter table claims add column points integer;
update claims c set points = d.points from drops d where d.id = c.drop_id;
alter table claims alter column points set not null;

-- claim_drop and finish_game don't pass points; their claims are worth the drop's points.
create function claims_default_points() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.points is null then
    select points into new.points from drops where id = new.drop_id;
  end if;
  return new;
end;
$$;

create trigger claims_default_points before insert on claims for each row execute function claims_default_points();

create or replace view player_scores with (security_invoker = true) as
select
  p.id as player_id,
  p.display_name,
  p.color,
  coalesce((select sum(c.points) from claims c where c.player_id = p.id), 0)::integer as points,
  (select count(*) from claims c where c.player_id = p.id)::integer as claims
from players p;

-- Lets /api functions resolve the caller's player from their JWT (Auth0 or Supabase anonymous).
create function current_player_id() returns uuid
language sql stable set search_path = public as $$
  select id from players where auth_id = auth.jwt()->>'sub';
$$;

revoke execute on function current_player_id from public, anon;
grant execute on function current_player_id to authenticated;

-- Admin only. Inserts the drop at a random point near the spot, so even the Realtime insert never carries the spot.
create function create_photo_hunt(
  p_title text,
  p_lat double precision,
  p_lng double precision,
  p_hint_photo_url text,
  p_twist text,
  p_points integer default 10,
  p_building_num text default null,
  p_expires_at timestamptz default null
)
returns drops language plpgsql security definer set search_path = public as $$
declare
  v_radius constant integer := 125;
  v_bearing double precision := random() * 2 * pi();
  -- At most 3/4 of the radius, so the spot is always well inside the circle.
  v_offset double precision := random() * v_radius * 0.75;
  v_drop drops;
begin
  if not is_admin() then
    raise exception 'Only admins can create photo hunts';
  end if;
  if coalesce(p_hint_photo_url, '') = '' then
    raise exception 'A photo hunt needs a reference photo';
  end if;
  if coalesce(trim(p_twist), '') = '' then
    raise exception 'A photo hunt needs a twist';
  end if;

  insert into drops (title, type, lat, lng, points, hint_photo_url, twist, search_radius_m, created_by, expires_at)
  values (
    p_title, 'photo_hunt',
    p_lat + v_offset * cos(v_bearing) / 111195,
    p_lng + v_offset * sin(v_bearing) / (111195 * cos(radians(p_lat))),
    p_points, p_hint_photo_url, trim(p_twist), v_radius,
    (select id from players where auth_id = auth.jwt()->>'sub'), p_expires_at
  )
  returning * into v_drop;

  update drop_secrets set hunt_lat = p_lat, hunt_lng = p_lng, hunt_building_num = p_building_num
  where drop_id = v_drop.id;
  return v_drop;
end;
$$;

revoke execute on function create_photo_hunt from public, anon;
grant execute on function create_photo_hunt to authenticated;

-- Raises a user-facing error unless this player may claim this hunt from here. The API runs it before paying for a
-- Gemini call, and claim_photo_hunt runs it again. Never says how far off the player is, so it can't be used to home in.
create function photo_hunt_check(p_drop_id uuid, p_player_id uuid, p_lat double precision, p_lng double precision)
returns drops language plpgsql stable security definer set search_path = public as $$
declare
  v_drop drops;
  v_lat double precision;
  v_lng double precision;
begin
  select * into v_drop from drops where id = p_drop_id and type = 'photo_hunt';
  if not found then
    raise exception 'Photo hunt not found';
  end if;
  if v_drop.status <> 'active' or v_drop.expires_at <= now() then
    raise exception 'This hunt is over';
  end if;
  if exists (select 1 from claims where drop_id = p_drop_id and player_id = p_player_id) then
    raise exception 'You already found this one';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Turn on location to submit a photo';
  end if;

  select hunt_lat, hunt_lng into v_lat, v_lng from drop_secrets where drop_id = p_drop_id;
  if distance_m(p_lat, p_lng, coalesce(v_lat, v_drop.lat), coalesce(v_lng, v_drop.lng)) > claim_radius_m() then
    raise exception 'This isn''t the spot. Keep looking!';
  end if;
  return v_drop;
end;
$$;

-- Service role only: called by /api/verify-photo after Gemini accepts the photo. The first find reveals the spot and
-- its building, and closes the hunt 7 minutes later (or sooner, if it was already due to expire).
create function claim_photo_hunt(p_drop_id uuid, p_player_id uuid, p_lat double precision, p_lng double precision)
returns claims language plpgsql security definer set search_path = public as $$
declare
  v_drop drops;
  v_found integer;
  v_claim claims;
begin
  -- Serializes simultaneous finds so each player's place (and points) is exact.
  perform 1 from drops where id = p_drop_id for update;
  v_drop := photo_hunt_check(p_drop_id, p_player_id, p_lat, p_lng);

  select count(*) into v_found from claims where drop_id = p_drop_id;
  insert into claims (drop_id, player_id, points)
  values (p_drop_id, p_player_id, greatest(1, floor(v_drop.points / 2.0 ^ v_found))::integer)
  returning * into v_claim;

  if v_found = 0 then
    update drops d
    set lat = coalesce(s.hunt_lat, d.lat),
        lng = coalesce(s.hunt_lng, d.lng),
        building_num = s.hunt_building_num,
        first_found_at = now(),
        expires_at = least(d.expires_at, now() + interval '7 minutes')
    from drop_secrets s
    where d.id = p_drop_id and s.drop_id = d.id;
  end if;

  return v_claim;
end;
$$;

revoke execute on function photo_hunt_check from public, anon, authenticated;
revoke execute on function claim_photo_hunt from public, anon, authenticated;
grant execute on function photo_hunt_check to service_role;
grant execute on function claim_photo_hunt to service_role;

-- As in remove_building_capture, plus: photo hunts are claimed only by photo.
create or replace function claim_drop(
  p_drop_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_code text default null
)
returns claims language plpgsql security definer set search_path = public as $$
declare
  v_player players;
  v_drop drops;
  v_claim claims;
begin
  select * into v_player from players where auth_id = auth.jwt()->>'sub';
  if not found then
    raise exception 'Join the game before claiming drops';
  end if;

  select * into v_drop from drops where id = p_drop_id for update;
  if not found then
    raise exception 'Drop not found';
  end if;
  if v_drop.type = 'minigame' then
    raise exception 'This drop is a Shake-Off. Join its lobby to win it';
  end if;
  if v_drop.type = 'photo_hunt' then
    raise exception 'Photo hunts are claimed by taking the photo';
  end if;
  perform assert_drop_proof(v_drop, p_lat, p_lng, p_code);

  update drops set status = 'claimed' where id = p_drop_id;
  insert into claims (drop_id, player_id)
  values (p_drop_id, v_player.id)
  returning * into v_claim;
  return v_claim;
end;
$$;
