-- Point to the Landmark: a third mini-game kind. Each round names a well-known campus landmark at least 200 m from
-- the drop; players point their phone at it (compass heading) and score the angular error from the true bearing,
-- which is measured from the drop's location, not the phone's GPS. Lower average error wins. Like Quick Draw, the
-- schedule (round starts, which landmark) is a pure function of games.started_at and games.seed.

alter table drops drop constraint drops_game_check;
alter table drops add constraint drops_game_check check (game in ('shake_off', 'quick_draw', 'landmark'));

-- The player's locked true heading (degrees clockwise from true north). value = its error from the true bearing.
alter table game_results add column heading double precision check (heading >= 0 and heading < 360);

-- Landmarks players can be asked to point at: famous, spread over campus, keyed like buildings.geojson (num) with
-- the same inside-the-footprint point the app uses for that building.
create table campus_landmarks (
  num text primary key,
  name text not null,
  lat double precision not null,
  lng double precision not null
);
alter table campus_landmarks enable row level security;
create policy "authenticated read landmarks" on campus_landmarks for select to authenticated using (true);

insert into campus_landmarks (num, name, lat, lng) values
  ('0001000', 'Old Main', 40.796443, -77.862804),
  ('0812000', 'Beaver Stadium', 40.812537, -77.855221),
  ('0045000', 'Bryce Jordan Center', 40.808639, -77.855565),
  ('0003000', 'Pattee Library', 40.797799, -77.866229),
  ('0005000', 'the HUB', 40.798261, -77.861197),
  ('0039000', 'Westgate Building', 40.79377, -77.86791),
  ('0829000', 'Pegula Ice Arena', 40.806615, -77.857036),
  ('0011000', 'Eisenhower Auditorium', 40.801533, -77.861707),
  ('0801000', 'Rec Hall', 40.796017, -77.869278),
  ('0091000', 'the Nittany Lion Inn', 40.796948, -77.871064),
  ('0107001', 'the Berkey Creamery', 40.804185, -77.862089),
  ('0758000', 'Palmer Museum of Art', 40.806851, -77.868234),
  ('0827000', 'Medlar Field', 40.812559, -77.852708),
  ('0038001', 'Millennium Science Complex', 40.801991, -77.860143),
  ('0023001', 'the Business Building', 40.80385, -77.865071);

-- Initial great-circle bearing from point 1 to point 2, degrees clockwise from true north in [0, 360).
create function bearing_deg(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select ((degrees(atan2(
    sin(radians(lng2 - lng1)) * cos(radians(lat2)),
    cos(radians(lat1)) * sin(radians(lat2)) - sin(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2 - lng1))
  )) + 360)::numeric % 360)::double precision;
$$;
grant execute on function bearing_deg to anon, authenticated;

-- Smallest angle between two headings, 0..180.
create function angle_diff(a double precision, b double precision) returns double precision
language sql immutable as $$
  select 180 - abs(180 - ((a - b)::numeric % 360 + 360) % 360)::double precision;
$$;

create or replace function minigame_settings(p_game text) returns jsonb
language sql immutable set search_path = public as $$
  select to_jsonb(s) || case p_game
    when 'quick_draw' then jsonb_build_object(
      'game_seconds', 30, 'rounds', 3, 'round_seconds', 10,
      'min_signal_delay_ms', 2000, 'max_signal_delay_ms', 6000,
      'min_reaction_ms', 100, 'max_reaction_ms', 1500,
      -- How far a reported flick may run ahead of the server's clock (phones estimate the offset over the network).
      'clock_tolerance_ms', 1000
    )
    when 'landmark' then jsonb_build_object(
      -- Each round: point_seconds to aim, then a reveal until the next round.
      'game_seconds', 42, 'rounds', 3, 'round_seconds', 14, 'point_seconds', 8,
      -- A heading locks once it stays within steady_degrees for steady_ms (not before lock_after_ms), or at time-out.
      'steady_ms', 1000, 'steady_degrees', 6, 'lock_after_ms', 1500,
      'min_landmark_m', 200,
      -- A round with no heading scores the worst possible error.
      'miss_degrees', 180
    )
    else '{}'::jsonb
  end
  from shake_off_settings() s;
$$;

create or replace function minigame_label(p_game text) returns text
language sql immutable as $$
  select case p_game when 'quick_draw' then 'Quick Draw' when 'landmark' then 'Landmark game' else 'Shake-Off' end;
$$;

-- Round r's landmark: a different seeded pick per round among landmarks at least min_landmark_m from the drop.
-- If a drop is somehow close to everything, the farthest landmarks fill in.
create function landmark_rounds(p_game games) returns table (round integer, num text, name text, lat double precision, lng double precision, bearing double precision)
language sql stable set search_path = public as $$
  with d as (select * from drops where id = p_game.drop_id),
       s as (select minigame_settings('landmark') as s),
       ranked as (
         select l.*, row_number() over (
           order by (distance_m(d.lat, d.lng, l.lat, l.lng) >= (s.s->>'min_landmark_m')::double precision) desc,
             case when distance_m(d.lat, d.lng, l.lat, l.lng) >= (s.s->>'min_landmark_m')::double precision then md5(p_game.seed || ':' || l.num) end,
             distance_m(d.lat, d.lng, l.lat, l.lng) desc
         ) as r
         from campus_landmarks l, d, s
       )
  select ranked.r::integer, ranked.num, ranked.name, ranked.lat, ranked.lng, bearing_deg(d.lat, d.lng, ranked.lat, ranked.lng)
  from ranked, d, s
  where ranked.r <= (s.s->>'rounds')::integer
  order by ranked.r;
$$;
revoke execute on function landmark_rounds from public, anon, authenticated;

-- As before, plus Point to the Landmark rounds (landmark and true bearing) and each result's heading.
create or replace function get_game_state(p_drop_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(game, 'shake_off') as game from drops where id = p_drop_id),
       g as (select * from games where drop_id = p_drop_id)
  select jsonb_build_object(
    'server_now', now(),
    'kind', (select game from d),
    'settings', minigame_settings((select game from d)),
    'game', (select to_jsonb(g) - 'seed' from g),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', p.id, 'display_name', p.display_name, 'color', p.color,
        'side', s.side, 'shakes', gp.shakes, 'joined_at', gp.joined_at
      ) order by gp.joined_at)
      from game_players gp
      join players p on p.id = gp.player_id
      left join game_sides(p_drop_id) s on s.player_id = gp.player_id
      where gp.drop_id = p_drop_id
    ), '[]'::jsonb),
    'rounds', coalesce(
      (
        select jsonb_agg(jsonb_build_object(
          'round', r,
          'starts_at', g.started_at + make_interval(secs => (r - 1) * (minigame_settings(d.game)->>'round_seconds')::integer),
          'signal_at', quick_draw_signal_at(g, r)
        ) order by r)
        from g, d, generate_series(1, (minigame_settings(d.game)->>'rounds')::integer) r
        where d.game = 'quick_draw' and g.started_at is not null
      ),
      (
        select jsonb_agg(jsonb_build_object(
          'round', l.round,
          'starts_at', g.started_at + make_interval(secs => (l.round - 1) * (minigame_settings(d.game)->>'round_seconds')::integer),
          'landmark', jsonb_build_object('num', l.num, 'name', l.name, 'lat', l.lat, 'lng', l.lng),
          'bearing', l.bearing
        ) order by l.round)
        from g, d, landmark_rounds(g) l
        where d.game = 'landmark' and g.started_at is not null
      ),
      '[]'::jsonb
    ),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', r.player_id, 'round', r.round, 'value', r.value, 'false_start', r.false_start, 'heading', r.heading
      ) order by r.round, r.value nulls last)
      from game_results r where r.drop_id = p_drop_id
    ), '[]'::jsonb)
  );
$$;

-- A round's locked heading (true north, degrees). The server scores it against the bearing from the drop to the
-- round's landmark. Refused: a round that doesn't exist or hasn't begun, a heading outside [0, 360), and anything
-- after the pointing window plus grace. The first heading for a round is final.
create function submit_heading(p_drop_id uuid, p_round integer, p_heading double precision) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player_id uuid := current_player_id();
  v_game games;
  v_s jsonb := minigame_settings('landmark');
  v_round_start timestamptz;
  v_bearing double precision;
begin
  select g.* into v_game from games g join drops d on d.id = g.drop_id where g.drop_id = p_drop_id and d.game = 'landmark';
  if not found or v_game.started_at is null or now() < v_game.started_at then
    raise exception 'This Landmark game hasn''t started';
  end if;
  if v_game.finished_at is not null then
    raise exception 'This Landmark game is over';
  end if;
  if v_player_id is null or not exists (select 1 from game_sides(p_drop_id) s where s.player_id = v_player_id) then
    raise exception 'You''re not in this Landmark game';
  end if;
  if p_round is null or p_round < 1 or p_round > (v_s->>'rounds')::integer then
    raise exception 'There''s no round %', p_round;
  end if;
  if p_heading is null or p_heading = 'NaN'::double precision or p_heading < 0 or p_heading >= 360 then
    raise exception 'A heading must be from 0 up to 360 degrees';
  end if;

  v_round_start := v_game.started_at + make_interval(secs => (p_round - 1) * (v_s->>'round_seconds')::integer);
  if now() < v_round_start then
    raise exception 'Round % hasn''t started', p_round;
  end if;
  if now() > v_round_start + make_interval(secs => (v_s->>'point_seconds')::integer + (v_s->>'submit_grace_seconds')::integer) then
    raise exception 'Round % is over', p_round;
  end if;

  select l.bearing into v_bearing from landmark_rounds(v_game) l where l.round = p_round;
  insert into game_results (drop_id, player_id, round, value, heading)
  values (p_drop_id, v_player_id, p_round, angle_diff(p_heading, v_bearing), p_heading)
  on conflict (drop_id, player_id, round) do nothing;

  return (select to_jsonb(r) from game_results r where r.drop_id = p_drop_id and r.player_id = v_player_id and r.round = p_round);
end;
$$;
revoke execute on function submit_heading from public, anon;
grant execute on function submit_heading to authenticated;

-- As before, plus landmark: the average of each player's error over all rounds, a round without a heading counting
-- as miss_degrees (lower wins).
create or replace function side_scores(p_drop_id uuid, p_game text) returns table (side text, score double precision)
language sql stable security definer set search_path = public as $$
  with per_player as (
    select s.side,
      case p_game
        when 'shake_off' then gp.shakes::double precision
        when 'landmark' then (
          select avg(coalesce(r.value, (minigame_settings(p_game)->>'miss_degrees')::double precision))
          from generate_series(1, (minigame_settings(p_game)->>'rounds')::integer) n
          left join game_results r on r.drop_id = p_drop_id and r.player_id = s.player_id and r.round = n
        )
        else coalesce(
          (select min(r.value) from game_results r where r.drop_id = p_drop_id and r.player_id = s.player_id and not r.false_start),
          (minigame_settings(p_game)->>'max_reaction_ms')::double precision
        )
      end as score
    from game_sides(p_drop_id) s
    join game_players gp on gp.drop_id = p_drop_id and gp.player_id = s.player_id
  )
  select side, avg(score) from per_player group by side;
$$;
