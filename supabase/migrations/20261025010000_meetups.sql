-- Player meetups: any player can pin "volleyball here right now" at their location for a while. A meetup is a
-- social pin, not a game: it awards no points (claim_drop refuses it), so nobody can farm points by posting one.
-- Also: close_drop(), so admins can clear any drop and players can end their own meetup.
--
-- The new enum value is only referenced inside plpgsql bodies, which Postgres checks when they run. That matters
-- because a value added by ALTER TYPE can't be used in the same transaction, and the SQL Editor runs a script as one.

alter type drop_type add value if not exists 'meetup';

-- Posts a meetup at the caller's position. One live meetup per player: posting again replaces the last one.
create function create_meetup(
  p_text text,
  p_lat double precision,
  p_lng double precision,
  p_minutes integer default 60,
  p_building_num text default null
)
returns drops language plpgsql security definer set search_path = public as $$
declare
  v_player players;
  v_text text := trim(coalesce(p_text, ''));
  v_drop drops;
begin
  select * into v_player from players where id = current_player_id();
  if not found then
    raise exception 'Join the game before posting a meetup';
  end if;
  if char_length(v_text) < 3 or char_length(v_text) > 80 then
    raise exception 'Say what''s happening in 3 to 80 characters';
  end if;
  if p_lat is null or p_lng is null then
    raise exception 'Turn on location to post a meetup';
  end if;
  -- Within 5 km of Old Main: University Park, not anywhere on Earth.
  if distance_m(p_lat, p_lng, 40.7982, -77.8599) > 5000 then
    raise exception 'Meetups have to be on campus';
  end if;
  if p_building_num is not null and p_building_num !~ '^[0-9A-Za-z]{1,12}$' then
    raise exception 'Unknown building';
  end if;
  if (select count(*) from drops where created_by = v_player.id and type = 'meetup' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'That''s a lot of meetups. Try again in a bit';
  end if;

  update drops set status = 'expired'
  where created_by = v_player.id and type = 'meetup' and status = 'active';

  insert into drops (title, subtitle, type, lat, lng, points, building_num, created_by, starts_at, expires_at)
  values (
    v_text, 'Started by ' || v_player.display_name, 'meetup', p_lat, p_lng, 1, p_building_num, v_player.id, now(),
    now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 15), 180))
  )
  returning * into v_drop;
  return v_drop;
end;
$$;

revoke execute on function create_meetup from public, anon;
grant execute on function create_meetup to authenticated;

-- Clears a drop from the map. Admins can clear any drop; a player can end a meetup they started.
-- The drop is marked expired, not deleted, so points already earned from it stay on the leaderboard.
create function close_drop(p_drop_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_drop drops;
begin
  select * into v_drop from drops where id = p_drop_id for update;
  if not found then
    raise exception 'Drop not found';
  end if;
  if not (is_admin() or (v_drop.type = 'meetup' and v_drop.created_by = current_player_id())) then
    raise exception 'Only admins can clear drops';
  end if;
  update drops set status = 'expired', expires_at = least(coalesce(expires_at, now()), now()) where id = p_drop_id;
end;
$$;

revoke execute on function close_drop from public, anon;
grant execute on function close_drop to authenticated;

-- As in photo_hunt, plus: meetups aren't claimable.
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
  if v_drop.type = 'meetup' then
    raise exception 'Meetups are for showing up, not for points';
  end if;
  perform assert_drop_proof(v_drop, p_lat, p_lng, p_code);

  update drops set status = 'claimed' where id = p_drop_id;
  insert into claims (drop_id, player_id)
  values (p_drop_id, v_player.id)
  returning * into v_claim;
  return v_claim;
end;
$$;
