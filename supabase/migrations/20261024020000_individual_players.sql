-- Players compete as individuals: no permanent teams. Buildings belong to players, each with a map color.

-- The single source of truth for the GPS claim radius. The client reads it via RPC to draw radius circles.
create function claim_radius_m() returns double precision language sql immutable as $$ select 60::double precision $$;
grant execute on function claim_radius_m to anon, authenticated;

alter table players add column color text;

-- Player colors: new players get whichever palette color is least used, so early players are all distinct.
create function next_player_color() returns text
language sql volatile security definer set search_path = public as $$
  select c.color
  from unnest(array[
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4',
    '#f032e6', '#9a6324', '#469990', '#800000', '#808000', '#000075'
  ]) with ordinality as c(color, ord)
  left join players p on p.color = c.color
  group by c.color, c.ord
  order by count(p.id), c.ord
  limit 1;
$$;

-- One row at a time so each call sees the colors already handed out.
do $$
declare r record;
begin
  for r in select id from players order by created_at loop
    update players set color = next_player_color() where id = r.id;
  end loop;
end;
$$;

alter table players alter column color set default next_player_color();
alter table players alter column color set not null;

-- Building control moves from teams to the player whose claim captured it.
drop view team_scores;

alter table building_control add column player_id uuid references players(id) on delete cascade;
update building_control b set player_id = c.player_id from claims c where c.id = b.claim_id;
alter table building_control alter column player_id set not null;
alter table building_control drop column team_id;
create index building_control_player_id_idx on building_control(player_id);

alter table claims drop column team_id;
create index claims_player_id_idx on claims(player_id);

alter table players drop column team_id;
drop table teams;

-- Players may only write their display name (color and is_admin are server-assigned).
revoke insert, update on players from anon, authenticated;
grant insert (display_name) on players to authenticated;
grant update (display_name) on players to authenticated;

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
  if v_drop.status <> 'active' or v_drop.expires_at <= now() then
    raise exception 'This drop is no longer available';
  end if;

  if p_code is not null then
    if not exists (select 1 from drop_secrets where drop_id = p_drop_id and claim_code = p_code) then
      raise exception 'That QR code doesn''t match this drop';
    end if;
  elsif p_lat is null or p_lng is null then
    raise exception 'Location unavailable. Scan the drop''s QR code instead';
  elsif distance_m(p_lat, p_lng, v_drop.lat, v_drop.lng) > claim_radius_m() then
    raise exception 'Get closer to claim this drop';
  end if;

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

create view player_scores with (security_invoker = true) as
select
  p.id as player_id,
  p.display_name,
  p.color,
  coalesce((select sum(d.points) from claims c join drops d on d.id = c.drop_id where c.player_id = p.id), 0)::integer as points,
  (select count(*) from claims c where c.player_id = p.id)::integer as claims,
  (select count(*) from building_control b where b.player_id = p.id)::integer as buildings
from players p;
