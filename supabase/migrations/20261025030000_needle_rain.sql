-- Needle Rain, a third mini-game on drops.game. Shake-Off and Quick Draw are unchanged: same sides, same
-- payout to every winner, same caps. Needle Rain is one shared storm. games.round_seed is public once the
-- round is scheduled; games.seed stays hidden and still breaks ties. A solo practice run records a capped
-- dodge count and pays nothing.

alter table drops drop constraint drops_game_check;
alter table drops add constraint drops_game_check check (game in ('shake_off', 'quick_draw', 'needle_rain'));

alter table games add column round_seed text;
alter table games add column ghost_seed text not null default replace(gen_random_uuid()::text, '-', '');
alter table games add column ghost_dodges integer check (ghost_dodges is null or ghost_dodges >= 0);
alter table games add column ghost_player_id uuid references players(id);
alter table games add column winner_id uuid references players(id);

alter table game_players add column dodges integer not null default 0 check (dodges >= 0);
alter table game_players add column eliminated boolean not null default false;

-- The client reads these through minigame_settings('needle_rain') / get_game_state(). Don't copy them.
create function needle_rain_settings(
  out game_seconds integer, out auto_start_players integer, out auto_start_delay_seconds integer,
  out admin_start_delay_seconds integer, out max_dodges_per_second integer, out submit_grace_seconds integer
) language sql immutable as $$ select 40, 2, 3, 3, 4, 3 $$;
grant execute on function needle_rain_settings to anon, authenticated;

create or replace function minigame_settings(p_game text) returns jsonb
language sql immutable set search_path = public as $$
  select to_jsonb(s) || case p_game
    when 'quick_draw' then jsonb_build_object(
      'game_seconds', 30, 'rounds', 3, 'round_seconds', 10,
      'min_signal_delay_ms', 2000, 'max_signal_delay_ms', 6000,
      'min_reaction_ms', 100, 'max_reaction_ms', 1500,
      'clock_tolerance_ms', 1000
    )
    when 'needle_rain' then (select to_jsonb(n) from needle_rain_settings() n)
    else '{}'::jsonb
  end
  from shake_off_settings() s;
$$;

create or replace function minigame_label(p_game text) returns text
language sql immutable as $$
  select case p_game when 'quick_draw' then 'Quick Draw' when 'needle_rain' then 'Needle Rain' else 'Shake-Off' end;
$$;

-- As Quick Draw's state, plus dodge columns, the public round seed (only after a start is set), and the ghost record.
create or replace function get_game_state(p_drop_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(game, 'shake_off') as game from drops where id = p_drop_id),
       g as (select * from games where drop_id = p_drop_id)
  select jsonb_build_object(
    'server_now', now(),
    'kind', (select game from d),
    'settings', minigame_settings((select game from d)),
    'game', (
      select (to_jsonb(g) - 'seed') || jsonb_build_object(
        'round_seed', case when g.started_at is not null then g.round_seed else null end,
        'ghost_name', (select p.display_name from players p where p.id = g.ghost_player_id)
      )
      from g
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', p.id, 'display_name', p.display_name, 'color', p.color,
        'side', s.side, 'shakes', gp.shakes, 'dodges', gp.dodges, 'eliminated', gp.eliminated,
        'joined_at', gp.joined_at
      ) order by gp.joined_at)
      from game_players gp
      join players p on p.id = gp.player_id
      left join game_sides(p_drop_id) s on s.player_id = gp.player_id
      where gp.drop_id = p_drop_id
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round', r,
        'starts_at', g.started_at + make_interval(secs => (r - 1) * (minigame_settings(d.game)->>'round_seconds')::integer),
        'signal_at', quick_draw_signal_at(g, r)
      ) order by r)
      from g, d, generate_series(1, (minigame_settings(d.game)->>'rounds')::integer) r
      where d.game = 'quick_draw' and g.started_at is not null
    ), '[]'::jsonb),
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', r.player_id, 'round', r.round, 'value', r.value, 'false_start', r.false_start
      ) order by r.round, r.value nulls last)
      from game_results r where r.drop_id = p_drop_id
    ), '[]'::jsonb)
  );
$$;

-- Names a Needle Rain in the refusal. Every minigame, including this one, stays unclaimable.
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
  if v_drop.type = 'minigame' and v_drop.game = 'needle_rain' then
    raise exception 'This drop is a Needle Rain. Join its lobby to win it';
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

-- Same join proof. Needle Rain's auto-start count and countdown come from its own settings, not Shake-Off's.
create or replace function join_game(
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
  v_settings jsonb;
  v_label text;
begin
  select * into v_drop from drops where id = p_drop_id;
  if not found or v_drop.type <> 'minigame' then
    raise exception 'This drop isn''t a Shake-Off';
  end if;
  v_label := minigame_label(v_drop.game);
  v_settings := minigame_settings(coalesce(v_drop.game, 'shake_off'));

  select * into v_player from players where auth_id = auth.jwt()->>'sub';
  if not found then
    raise exception 'Join WalkPSU before joining a %', v_label;
  end if;

  insert into games (drop_id) values (p_drop_id) on conflict (drop_id) do nothing;
  select * into v_game from games where drop_id = p_drop_id for update;

  if exists (select 1 from game_players where drop_id = p_drop_id and player_id = v_player.id) then
    return;
  end if;
  if v_game.started_at is not null and v_game.started_at <= now() then
    raise exception 'This % already started', v_label;
  end if;
  perform assert_drop_proof(v_drop, p_lat, p_lng, p_code);

  insert into game_players (drop_id, player_id) values (p_drop_id, v_player.id);

  select count(*) into v_count from game_players where drop_id = p_drop_id;
  if v_game.started_at is null and v_count >= (v_settings->>'auto_start_players')::integer then
    update games set
      started_at = now() + make_interval(secs => (v_settings->>'auto_start_delay_seconds')::integer),
      round_seed = case
        when v_drop.game = 'needle_rain' then coalesce(round_seed, replace(gen_random_uuid()::text, '-', ''))
        else round_seed
      end
    where drop_id = p_drop_id;
  end if;
end;
$$;

create or replace function start_game(p_drop_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_kind text;
  v_settings jsonb;
  v_start timestamptz;
begin
  select coalesce(game, 'shake_off') into v_kind from drops where id = p_drop_id;
  if not is_admin() then
    raise exception 'Only admins can start a %', minigame_label(v_kind);
  end if;

  select * into v_game from games where drop_id = p_drop_id for update;
  if not found then
    raise exception 'Nobody has joined this % yet', minigame_label(v_kind);
  end if;
  if (select count(*) from game_players where drop_id = p_drop_id) < 2 then
    raise exception 'A % needs at least 2 players', minigame_label(v_kind);
  end if;

  v_settings := minigame_settings(v_kind);
  v_start := now() + make_interval(secs => (v_settings->>'admin_start_delay_seconds')::integer);
  if v_game.started_at is not null and v_game.started_at <= v_start then
    return;
  end if;
  update games set
    started_at = v_start,
    round_seed = case
      when v_kind = 'needle_rain' then coalesce(round_seed, replace(gen_random_uuid()::text, '-', ''))
      else round_seed
    end
  where drop_id = p_drop_id;
end;
$$;

-- Running dodge total. Stored as greatest(previous, min(reported, floor(elapsed * max_dodges_per_second))).
-- A hit freezes the count. Live broadcasts are not read here.
create function submit_dodges(p_drop_id uuid, p_count integer, p_eliminated boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_player_id uuid;
  v_game games;
  v_row game_players;
  v_settings record := needle_rain_settings();
  v_elapsed double precision;
  v_capped integer;
begin
  if (select game from drops where id = p_drop_id) is distinct from 'needle_rain' then
    raise exception 'This drop isn''t a Needle Rain';
  end if;

  select id into v_player_id from players where auth_id = auth.jwt()->>'sub';
  select * into v_game from games where drop_id = p_drop_id;
  if v_player_id is null or not found or v_game.started_at is null or now() < v_game.started_at then
    raise exception 'This Needle Rain hasn''t started';
  end if;
  if v_game.finished_at is not null
     or now() > v_game.started_at + make_interval(secs => v_settings.game_seconds + v_settings.submit_grace_seconds) then
    raise exception 'This Needle Rain is over';
  end if;

  select * into v_row from game_players where drop_id = p_drop_id and player_id = v_player_id;
  if not found then
    raise exception 'You''re not in this Needle Rain';
  end if;
  if v_row.eliminated then
    return v_row.dodges;
  end if;

  v_elapsed := least(extract(epoch from now() - v_game.started_at), v_settings.game_seconds);
  v_capped := least(greatest(coalesce(p_count, 0), 0), floor(v_elapsed * v_settings.max_dodges_per_second)::integer);
  update game_players
  set dodges = greatest(dodges, v_capped),
      eliminated = eliminated or coalesce(p_eliminated, false)
  where drop_id = p_drop_id and player_id = v_player_id
  returning dodges into v_capped;
  return v_capped;
end;
$$;
revoke execute on function submit_dodges(uuid, integer, boolean) from public, anon;
grant execute on function submit_dodges(uuid, integer, boolean) to authenticated;

-- Practice run. Pays nothing, does not finish the drop, and replaces the lobby record only when the capped
-- count is higher. The cap is one full round: a ghost has no server clock.
create function submit_ghost(p_drop_id uuid, p_count integer)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_player_id uuid;
  v_game games;
  v_settings record := needle_rain_settings();
  v_capped integer;
begin
  if (select game from drops where id = p_drop_id) is distinct from 'needle_rain' then
    raise exception 'This drop isn''t a Needle Rain';
  end if;

  select id into v_player_id from players where auth_id = auth.jwt()->>'sub';
  select * into v_game from games where drop_id = p_drop_id for update;
  if v_player_id is null or not found then
    raise exception 'Join the Needle Rain before practicing';
  end if;
  if not exists (select 1 from game_players where drop_id = p_drop_id and player_id = v_player_id) then
    raise exception 'Join the Needle Rain before practicing';
  end if;
  if v_game.finished_at is not null or (v_game.started_at is not null and v_game.started_at <= now()) then
    raise exception 'The real round already started';
  end if;

  v_capped := least(greatest(coalesce(p_count, 0), 0), v_settings.game_seconds * v_settings.max_dodges_per_second);
  if v_game.ghost_dodges is null or v_capped > v_game.ghost_dodges then
    update games set ghost_dodges = v_capped, ghost_player_id = v_player_id where drop_id = p_drop_id;
  end if;
  return v_capped;
end;
$$;
revoke execute on function submit_ghost(uuid, integer) from public, anon;
grant execute on function submit_ghost(uuid, integer) to authenticated;

-- Shake-Off and Quick Draw judging is unchanged. Needle Rain pays the drop's points once: last player
-- standing, otherwise the higher capped dodge count, with the seeded coin flip on an exact tie.
create or replace function finish_game(p_drop_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_kind text;
  v_s jsonb;
  v_blue double precision;
  v_white double precision;
  v_winner text;
  v_winner_id uuid;
  v_alive integer;
begin
  select coalesce(game, 'shake_off') into v_kind from drops where id = p_drop_id;
  select * into v_game from games where drop_id = p_drop_id for update;
  if not found or v_game.started_at is null then
    raise exception 'This % hasn''t started', minigame_label(v_kind);
  end if;
  v_s := minigame_settings(v_kind);

  if v_game.finished_at is null then
    if now() < v_game.started_at + make_interval(secs => (v_s->>'game_seconds')::integer + (v_s->>'submit_grace_seconds')::integer) then
      raise exception 'This % isn''t over yet', minigame_label(v_kind);
    end if;

    if v_kind = 'needle_rain' then
      select count(*) into v_alive from game_players where drop_id = p_drop_id and not eliminated;
      select gp.player_id into v_winner_id
      from game_players gp
      where gp.drop_id = p_drop_id
        and (v_alive = 0 or not gp.eliminated)
        and gp.dodges = (
          select max(gp2.dodges) from game_players gp2
          where gp2.drop_id = p_drop_id and (v_alive = 0 or not gp2.eliminated)
        )
      order by get_byte(decode(md5(v_game.seed || gp.player_id::text), 'hex'), 0), gp.joined_at
      limit 1;

      if v_winner_id is null then
        raise exception 'Nobody is in this Needle Rain';
      end if;

      update drops set status = 'claimed' where id = p_drop_id;
      insert into claims (drop_id, player_id) values (p_drop_id, v_winner_id)
      on conflict (drop_id, player_id) do nothing;
      update games set finished_at = now(), winner_id = v_winner_id where drop_id = p_drop_id;
    else
      select coalesce(max(score) filter (where side = 'blue'), 0), coalesce(max(score) filter (where side = 'white'), 0)
      into v_blue, v_white
      from side_scores(p_drop_id, v_kind);

      v_winner := case
        when v_blue = v_white then case when get_byte(decode(md5(v_game.seed), 'hex'), 0) % 2 = 0 then 'blue' else 'white' end
        when (v_blue > v_white) = (v_kind = 'shake_off') then 'blue'
        else 'white'
      end;

      update drops set status = 'claimed' where id = p_drop_id;
      insert into claims (drop_id, player_id)
      select p_drop_id, s.player_id from game_sides(p_drop_id) s where s.side = v_winner
      on conflict (drop_id, player_id) do nothing;

      update games set finished_at = now(), winner_side = v_winner where drop_id = p_drop_id;
    end if;
  end if;

  return get_game_state(p_drop_id);
end;
$$;
