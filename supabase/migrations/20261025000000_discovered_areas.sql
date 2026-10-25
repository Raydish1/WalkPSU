-- Fog-of-war discovery: which campus areas (hexes) each player has walked into.
-- The hex grid lives in the client (web/src/map/hexgrid.ts): 120 m-edge hexes keyed "q:r" (axial coordinates from
-- Old Main). Deliberately stores no time or coordinates, so it can't be used to reconstruct where someone walked.

create table discovered_areas (
  player_id uuid not null references players (id) on delete cascade,
  hex_id text not null check (hex_id ~ '^-?[0-9]{1,4}:-?[0-9]{1,4}$'),
  primary key (player_id, hex_id)
);

alter table discovered_areas enable row level security;

create policy "players read their own areas" on discovered_areas
  for select to authenticated using (player_id = (select current_player_id()));

create policy "players add their own areas" on discovered_areas
  for insert to authenticated with check (player_id = (select current_player_id()));

-- Rows are permanent once discovered: no update or delete policy, and no grants for them either.
revoke update, delete, truncate on discovered_areas from anon, authenticated;
revoke all on discovered_areas from anon;

-- Records a discovery for the caller. Runs as the caller (security invoker), so the insert policy above applies.
-- Returns true for a new area, false if it was already discovered.
create function discover_area(p_hex_id text) returns boolean
language plpgsql set search_path = public as $$
declare
  v_player uuid := current_player_id();
begin
  if v_player is null then
    raise exception 'Join the game before discovering areas';
  end if;
  insert into discovered_areas (player_id, hex_id) values (v_player, p_hex_id) on conflict do nothing;
  return found;
end;
$$;

revoke execute on function discover_area from public, anon;
grant execute on function discover_area to authenticated;
