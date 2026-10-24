-- Shake-Off: the motion mini-game behind 'minigame' drops.
-- Phases come from timestamps, so no server timer is needed:
--   lobby     started_at is null, or now() < started_at (joining still open; countdown once scheduled)
--   playing   started_at <= now() < started_at + game_duration()
--   tallying  after that, until someone calls finish_game() (allowed once the submit grace period passes)
--   finished  finished_at is set
-- Sides are temporary and exist only inside one game; nothing about them outlives it.

create function shake_off_settings(
  out game_seconds integer, out auto_start_players integer, out auto_start_delay_seconds integer,
  out admin_start_delay_seconds integer, out max_shakes_per_second integer, out submit_grace_seconds integer
) language sql immutable as $$ select 15, 4, 15, 5, 8, 3 $$;
grant execute on function shake_off_settings to anon, authenticated;

create table games (
  drop_id uuid primary key references drops(id) on delete cascade,
  seed text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  winner_side text check (winner_side in ('blue', 'white'))
);

create table game_players (
  drop_id uuid not null references games(drop_id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  joined_at timestamptz not null default now(),
  shakes integer not null default 0 check (shakes >= 0),
  primary key (drop_id, player_id)
);

alter table games enable row level security;
alter table game_players enable row level security;
create policy "authenticated read games" on games for select to authenticated using (true);
create policy "authenticated read game players" on game_players for select to authenticated using (true);
alter publication supabase_realtime add table games, game_players;

-- Several winners can each hold a claim on one mini-game drop. Ordinary drops stay single-claim:
-- claim_drop locks the drop row and flips it to 'claimed' before inserting.
alter table claims drop constraint claims_drop_id_key;
alter table claims add constraint claims_drop_player_key unique (drop_id, player_id);

-- Shared proof check: GPS inside claim_radius_m(), or the drop's QR code from any distance.
create function assert_drop_proof(v_drop drops, p_lat double precision, p_lng double precision, p_code text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if v_drop.status <> 'active' or v_drop.expires_at <= now() then
    raise exception 'This drop is no longer available';
  end if;
  if p_code is not null then
    if not exists (select 1 from drop_secrets where drop_id = v_drop.id and claim_code = p_code) then
      raise exception 'That QR code doesn''t match this drop';
    end if;
  elsif p_lat is null or p_lng is null then
    raise exception 'Location unavailable. Scan the drop''s QR code instead';
  elsif distance_m(p_lat, p_lng, v_drop.lat, v_drop.lng) > claim_radius_m() then
    raise exception 'Get closer to this drop';
  end if;
end;
$$;
revoke execute on function assert_drop_proof from public, anon, authenticated;

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
  perform assert_drop_proof(v_drop, p_lat, p_lng, p_code);

  update drops set status = 'claimed' where id = p_drop_id;
  insert into claims (drop_id, player_id)
  values (p_drop_id, v_player.id)
  returning * into v_claim;

  if v_drop.building_num is not null then
    insert into building_control (building_num, player_id, claim_id)
    values (v_drop.building_num, v_player.id, v_claim.id)
    on conflict (building_num) do update
      set player_id = excluded.player_id, claim_id = excluded.claim_id, captured_at = now();
  end if;

  return v_claim;
end;
$$;

-- Everyone in the game (join_game closes joining at the start), alternating Blue/White in a seed-shuffled
-- order, so sides are balanced, random per game, and identical for every caller. Empty until a start is set.
create function game_sides(p_drop_id uuid)
returns table (player_id uuid, side text) language sql stable security definer set search_path = public as $$
  select gp.player_id, case when row_number() over (order by md5(g.seed || gp.player_id::text)) % 2 = 1 then 'blue' else 'white' end
  from games g
  join game_players gp on gp.drop_id = g.drop_id
  where g.drop_id = p_drop_id and g.started_at is not null;
$$;

-- Everything a game screen needs in one call, including server time so phones with skewed clocks agree.
create function get_game_state(p_drop_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'server_now', now(),
    'settings', (select to_jsonb(s) from shake_off_settings() s),
    'game', (select to_jsonb(g) - 'seed' from games g where g.drop_id = p_drop_id),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', p.id, 'display_name', p.display_name, 'color', p.color,
        'side', s.side, 'shakes', gp.shakes, 'joined_at', gp.joined_at
      ) order by gp.joined_at)
      from game_players gp
      join players p on p.id = gp.player_id
      left join game_sides(p_drop_id) s on s.player_id = gp.player_id
      where gp.drop_id = p_drop_id
    ), '[]'::jsonb)
  );
$$;
revoke execute on function get_game_state from public, anon;
grant execute on function get_game_state to authenticated;

create function join_game(
  p_drop_id uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_code text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_player players;
  v_drop drops;
  v_game games;
  v_count integer;
  v_settings record := shake_off_settings();
begin
  select * into v_player from players where auth_id = auth.jwt()->>'sub';
  if not found then
    raise exception 'Join WalkPSU before joining a Shake-Off';
  end if;

  select * into v_drop from drops where id = p_drop_id;
  if not found or v_drop.type <> 'minigame' then
    raise exception 'This drop isn''t a Shake-Off';
  end if;

  insert into games (drop_id) values (p_drop_id) on conflict (drop_id) do nothing;
  select * into v_game from games where drop_id = p_drop_id for update;

  if exists (select 1 from game_players where drop_id = p_drop_id and player_id = v_player.id) then
    return;
  end if;
  if v_game.started_at is not null and v_game.started_at <= now() then
    raise exception 'This Shake-Off already started';
  end if;
  perform assert_drop_proof(v_drop, p_lat, p_lng, p_code);

  insert into game_players (drop_id, player_id) values (p_drop_id, v_player.id);

  select count(*) into v_count from game_players where drop_id = p_drop_id;
  if v_game.started_at is null and v_count >= v_settings.auto_start_players then
    update games set started_at = now() + make_interval(secs => v_settings.auto_start_delay_seconds)
    where drop_id = p_drop_id;
  end if;
end;
$$;
revoke execute on function join_game from public, anon;
grant execute on function join_game to authenticated;

create function start_game(p_drop_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_start timestamptz := now() + make_interval(secs => (shake_off_settings()).admin_start_delay_seconds);
begin
  if not is_admin() then
    raise exception 'Only admins can start a Shake-Off';
  end if;
  select * into v_game from games where drop_id = p_drop_id for update;
  if not found then
    raise exception 'Nobody has joined this Shake-Off yet';
  end if;
  if (select count(*) from game_players where drop_id = p_drop_id) < 2 then
    raise exception 'A Shake-Off needs at least 2 players';
  end if;
  if v_game.started_at is not null and v_game.started_at <= v_start then
    return;
  end if;
  update games set started_at = v_start where drop_id = p_drop_id;
end;
$$;
revoke execute on function start_game from public, anon;
grant execute on function start_game to authenticated;

-- Players report their running total during and right after the game. The stored value is capped at
-- max_shakes_per_second for the time actually elapsed, so a client can't claim more than a human could do.
create function submit_shakes(p_drop_id uuid, p_count integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_player_id uuid;
  v_game games;
  v_settings record := shake_off_settings();
  v_elapsed double precision;
  v_capped integer;
begin
  select id into v_player_id from players where auth_id = auth.jwt()->>'sub';
  select * into v_game from games where drop_id = p_drop_id;
  if v_player_id is null or not found or v_game.started_at is null or now() < v_game.started_at then
    raise exception 'This Shake-Off hasn''t started';
  end if;
  if v_game.finished_at is not null
     or now() > v_game.started_at + make_interval(secs => v_settings.game_seconds + v_settings.submit_grace_seconds) then
    raise exception 'This Shake-Off is over';
  end if;
  if not exists (select 1 from game_sides(p_drop_id) s where s.player_id = v_player_id) then
    raise exception 'You''re not in this Shake-Off';
  end if;

  v_elapsed := least(extract(epoch from now() - v_game.started_at), v_settings.game_seconds);
  v_capped := least(greatest(p_count, 0), floor(v_elapsed * v_settings.max_shakes_per_second)::integer);
  update game_players set shakes = greatest(shakes, v_capped)
  where drop_id = p_drop_id and player_id = v_player_id
  returning shakes into v_capped;
  return v_capped;
end;
$$;
revoke execute on function submit_shakes from public, anon;
grant execute on function submit_shakes to authenticated;

-- Idempotent: the first caller after the grace period decides the result; everyone else gets the same answer.
-- The side with more shakes per player wins (fair for uneven sides). An exact tie goes to a seeded coin flip.
create function finish_game(p_drop_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_drop drops;
  v_settings record := shake_off_settings();
  v_blue double precision;
  v_white double precision;
  v_winner text;
  v_mvp uuid;
  v_mvp_claim uuid;
begin
  select * into v_game from games where drop_id = p_drop_id for update;
  if not found or v_game.started_at is null then
    raise exception 'This Shake-Off hasn''t started';
  end if;

  if v_game.finished_at is null then
    if now() < v_game.started_at + make_interval(secs => v_settings.game_seconds + v_settings.submit_grace_seconds) then
      raise exception 'This Shake-Off isn''t over yet';
    end if;

    select
      coalesce(avg(gp.shakes) filter (where s.side = 'blue'), 0),
      coalesce(avg(gp.shakes) filter (where s.side = 'white'), 0)
    into v_blue, v_white
    from game_sides(p_drop_id) s
    join game_players gp on gp.drop_id = p_drop_id and gp.player_id = s.player_id;

    v_winner := case
      when v_blue > v_white then 'blue'
      when v_white > v_blue then 'white'
      when get_byte(decode(md5(v_game.seed), 'hex'), 0) % 2 = 0 then 'blue'
      else 'white'
    end;

    select * into v_drop from drops where id = p_drop_id for update;
    update drops set status = 'claimed' where id = p_drop_id;

    insert into claims (drop_id, player_id)
    select p_drop_id, s.player_id from game_sides(p_drop_id) s where s.side = v_winner
    on conflict (drop_id, player_id) do nothing;

    if v_drop.building_num is not null then
      select s.player_id into v_mvp
      from game_sides(p_drop_id) s
      join game_players gp on gp.drop_id = p_drop_id and gp.player_id = s.player_id
      where s.side = v_winner
      order by gp.shakes desc, gp.joined_at
      limit 1;
      if v_mvp is not null then
        select id into v_mvp_claim from claims where drop_id = p_drop_id and player_id = v_mvp;
        insert into building_control (building_num, player_id, claim_id)
        values (v_drop.building_num, v_mvp, v_mvp_claim)
        on conflict (building_num) do update
          set player_id = excluded.player_id, claim_id = excluded.claim_id, captured_at = now();
      end if;
    end if;

    update games set finished_at = now(), winner_side = v_winner where drop_id = p_drop_id;
  end if;

  return get_game_state(p_drop_id);
end;
$$;
revoke execute on function finish_game from public, anon;
grant execute on function finish_game to authenticated;
