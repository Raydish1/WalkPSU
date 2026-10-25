-- Mini-game kinds. A 'minigame' drop now names its game in drops.game; every kind shares the Shake-Off lobby,
-- join rules, random two-side split (game_sides), server timing, and finish_game.
--   shake_off   the original: most shakes per player wins (unchanged)
--   quick_draw  3 rounds; each round flashes "DRAW!" at a seeded 2-6 s moment, phones time the flick themselves,
--               and the side with the lower average best time wins
--
-- Timed games keep Shake-Off's rule of no server timer: round starts and signal moments are pure functions of
-- games.started_at and the hidden games.seed, so every caller derives the same schedule.

alter table drops add column game text constraint drops_game_check check (game in ('shake_off', 'quick_draw'));
update drops set game = 'shake_off' where type = 'minigame';

-- Older clients (and the admin form before this change) insert minigame drops without a game: they get a Shake-Off.
-- Other drop types never carry a game.
create function drops_default_game() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.type::text = 'minigame' then
    new.game := coalesce(new.game, 'shake_off');
  else
    new.game := null;
  end if;
  return new;
end;
$$;
create trigger drops_default_game before insert or update of type, game on drops for each row execute function drops_default_game();

-- One row per player per round in a timed game. `value` is the round's score, lower is better
-- (Quick Draw: reaction time in ms). Null with false_start = flicked too early, so the round doesn't count.
-- The first submission for a round is final.
create table game_results (
  drop_id uuid not null references games(drop_id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  round smallint not null check (round >= 1),
  value double precision check (value >= 0),
  false_start boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (drop_id, player_id, round),
  check (false_start = (value is null))
);
alter table game_results enable row level security;
create policy "authenticated read game results" on game_results for select to authenticated using (true);
alter publication supabase_realtime add table game_results;

-- The lobby settings every kind shares, plus each kind's own timing. game_seconds is the whole playing phase.
create function minigame_settings(p_game text) returns jsonb
language sql immutable set search_path = public as $$
  select to_jsonb(s) || case p_game
    when 'quick_draw' then jsonb_build_object(
      'game_seconds', 30, 'rounds', 3, 'round_seconds', 10,
      'min_signal_delay_ms', 2000, 'max_signal_delay_ms', 6000,
      'min_reaction_ms', 100, 'max_reaction_ms', 1500,
      -- How far a reported flick may run ahead of the server's clock (phones estimate the offset over the network).
      'clock_tolerance_ms', 1000
    )
    else '{}'::jsonb
  end
  from shake_off_settings() s;
$$;
grant execute on function minigame_settings to anon, authenticated;

create function minigame_label(p_game text) returns text
language sql immutable as $$
  select case p_game when 'quick_draw' then 'Quick Draw' else 'Shake-Off' end;
$$;

-- When round p_round's "DRAW!" appears: its round start plus a seeded delay in [min, max] signal delay.
create function quick_draw_signal_at(p_game games, p_round integer) returns timestamptz
language sql immutable set search_path = public as $$
  select p_game.started_at
    + make_interval(secs => (p_round - 1) * (s->>'round_seconds')::integer)
    + make_interval(secs => (
        (s->>'min_signal_delay_ms')::integer
        + (get_byte(h, 0) * 256 + get_byte(h, 1)) % ((s->>'max_signal_delay_ms')::integer - (s->>'min_signal_delay_ms')::integer + 1)
      ) / 1000.0)
  from (select minigame_settings('quick_draw') as s, decode(md5(p_game.seed || ':' || p_round), 'hex') as h) x;
$$;
revoke execute on function quick_draw_signal_at from public, anon, authenticated;

-- As before, plus the drop's game, its settings, the round schedule once a start is set, and every round result.
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

-- Unchanged rules; the messages name the drop's game.
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
  v_settings record := shake_off_settings();
  v_label text;
begin
  select * into v_drop from drops where id = p_drop_id;
  if not found or v_drop.type <> 'minigame' then
    raise exception 'This drop isn''t a Shake-Off';
  end if;
  v_label := minigame_label(v_drop.game);

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
  if v_game.started_at is null and v_count >= v_settings.auto_start_players then
    update games set started_at = now() + make_interval(secs => v_settings.auto_start_delay_seconds)
    where drop_id = p_drop_id;
  end if;
end;
$$;

-- Shake counts only mean something in a Shake-Off.
create or replace function submit_shakes(p_drop_id uuid, p_count integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_player_id uuid;
  v_game games;
  v_settings record := shake_off_settings();
  v_elapsed double precision;
  v_capped integer;
begin
  select id into v_player_id from players where auth_id = auth.jwt()->>'sub';
  select g.* into v_game from games g join drops d on d.id = g.drop_id where g.drop_id = p_drop_id and d.game = 'shake_off';
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

-- A Quick Draw round result, timed on the phone from the moment it showed "DRAW!" to the flick, so network lag
-- doesn't count. p_reaction_ms null = the phone saw a flick before the signal. Under min_reaction_ms is a false
-- start too (nobody reacts that fast). The server refuses rounds that haven't begun, times no human could produce,
-- flicks reported before the signal could have happened by its own clock, and anything after the round's window.
create function submit_reaction(p_drop_id uuid, p_round integer, p_reaction_ms integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_player_id uuid := current_player_id();
  v_game games;
  v_s jsonb := minigame_settings('quick_draw');
  v_round_start timestamptz;
  v_signal timestamptz;
  v_false boolean;
begin
  select g.* into v_game from games g join drops d on d.id = g.drop_id where g.drop_id = p_drop_id and d.game = 'quick_draw';
  if not found or v_game.started_at is null or now() < v_game.started_at then
    raise exception 'This Quick Draw hasn''t started';
  end if;
  if v_game.finished_at is not null then
    raise exception 'This Quick Draw is over';
  end if;
  if v_player_id is null or not exists (select 1 from game_sides(p_drop_id) s where s.player_id = v_player_id) then
    raise exception 'You''re not in this Quick Draw';
  end if;
  if p_round is null or p_round < 1 or p_round > (v_s->>'rounds')::integer then
    raise exception 'There''s no round %', p_round;
  end if;

  v_round_start := v_game.started_at + make_interval(secs => (p_round - 1) * (v_s->>'round_seconds')::integer);
  v_signal := quick_draw_signal_at(v_game, p_round);
  if now() < v_round_start then
    raise exception 'Round % hasn''t started', p_round;
  end if;
  if now() > v_signal + make_interval(secs => ((v_s->>'max_reaction_ms')::integer / 1000.0) + (v_s->>'submit_grace_seconds')::integer) then
    raise exception 'Round % is over', p_round;
  end if;

  if p_reaction_ms is null then
    v_false := true;
  else
    if p_reaction_ms < 0 or p_reaction_ms > (v_s->>'max_reaction_ms')::integer then
      raise exception 'A reaction time of % ms isn''t possible', p_reaction_ms;
    end if;
    if now() < v_signal + make_interval(secs => (p_reaction_ms - (v_s->>'clock_tolerance_ms')::integer) / 1000.0) then
      raise exception 'No signal was shown yet in round %', p_round;
    end if;
    v_false := p_reaction_ms < (v_s->>'min_reaction_ms')::integer;
  end if;

  insert into game_results (drop_id, player_id, round, value, false_start)
  values (p_drop_id, v_player_id, p_round, case when v_false then null else p_reaction_ms end, v_false)
  on conflict (drop_id, player_id, round) do nothing;

  return (select to_jsonb(r) from game_results r where r.drop_id = p_drop_id and r.player_id = v_player_id and r.round = p_round);
end;
$$;
revoke execute on function submit_reaction from public, anon;
grant execute on function submit_reaction to authenticated;

-- Each side's score for the winner decision, per kind:
--   shake_off   shakes per player (higher wins)
--   quick_draw  average of each player's best valid time; a player with none counts as max_reaction_ms (lower wins)
create function side_scores(p_drop_id uuid, p_game text) returns table (side text, score double precision)
language sql stable security definer set search_path = public as $$
  with per_player as (
    select s.side,
      case p_game
        when 'shake_off' then gp.shakes::double precision
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
revoke execute on function side_scores from public, anon, authenticated;

-- Idempotent, as before. Shake-Off: more shakes per player wins. Timed games: the lower side score wins.
-- An exact tie goes to a seeded coin flip.
create or replace function finish_game(p_drop_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_kind text;
  v_s jsonb;
  v_blue double precision;
  v_white double precision;
  v_winner text;
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

  return get_game_state(p_drop_id);
end;
$$;
