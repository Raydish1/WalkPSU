-- Buildings are no longer captured. A drop can still sit at a building (drops.building_num); the map just
-- highlights buildings that host an active drop, which needs no table.

-- Rebuilt without the buildings column (a column can't be removed with create or replace).
drop view player_scores;
create view player_scores with (security_invoker = true) as
select
  p.id as player_id,
  p.display_name,
  p.color,
  coalesce((select sum(d.points) from claims c join drops d on d.id = c.drop_id where c.player_id = p.id), 0)::integer as points,
  (select count(*) from claims c where c.player_id = p.id)::integer as claims
from players p;

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
  return v_claim;
end;
$$;

create or replace function finish_game(p_drop_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_game games;
  v_settings record := shake_off_settings();
  v_blue double precision;
  v_white double precision;
  v_winner text;
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

    update drops set status = 'claimed' where id = p_drop_id;
    insert into claims (drop_id, player_id)
    select p_drop_id, s.player_id from game_sides(p_drop_id) s where s.side = v_winner
    on conflict (drop_id, player_id) do nothing;

    update games set finished_at = now(), winner_side = v_winner where drop_id = p_drop_id;
  end if;

  return get_game_state(p_drop_id);
end;
$$;

-- Dropping the table also removes it from the supabase_realtime publication.
drop table building_control;
