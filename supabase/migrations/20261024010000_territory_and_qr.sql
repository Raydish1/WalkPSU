-- Building territory + QR claim codes.
-- Buildings live in web/public/data/buildings.geojson; the database only stores their PSU building number.

alter table drops add column building_num text;

-- Who holds each building. Claiming a drop at a building captures it, replacing the previous owner.
create table building_control (
  building_num text primary key,
  team_id uuid not null references teams(id),
  claim_id uuid not null references claims(id) on delete cascade,
  captured_at timestamptz not null default now()
);

alter table building_control enable row level security;
create policy "authenticated read building control" on building_control for select to authenticated using (true);
alter publication supabase_realtime add table building_control;

-- QR claim codes. Kept out of `drops` so players can't read them; admins render them as QR codes.
create table drop_secrets (
  drop_id uuid primary key references drops(id) on delete cascade,
  claim_code text not null default replace(gen_random_uuid()::text, '-', '')
);

alter table drop_secrets enable row level security;
create policy "admins read claim codes" on drop_secrets for select to authenticated using (is_admin());

create function create_drop_secret() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into drop_secrets (drop_id) values (new.id);
  return new;
end;
$$;

create trigger drops_create_secret after insert on drops for each row execute function create_drop_secret();

-- Claim with GPS (within 60 m) or with the drop's QR code (any distance).
drop function claim_drop(uuid, double precision, double precision);

create function claim_drop(
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
    raise exception 'Join a team before claiming drops';
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
  elsif distance_m(p_lat, p_lng, v_drop.lat, v_drop.lng) > 60 then
    raise exception 'Get closer to claim this drop';
  end if;

  update drops set status = 'claimed' where id = p_drop_id;
  insert into claims (drop_id, player_id, team_id)
  values (p_drop_id, v_player.id, v_player.team_id)
  returning * into v_claim;

  if v_drop.building_num is not null then
    insert into building_control (building_num, team_id, claim_id)
    values (v_drop.building_num, v_player.team_id, v_claim.id)
    on conflict (building_num) do update
      set team_id = excluded.team_id, claim_id = excluded.claim_id, captured_at = now();
  end if;

  return v_claim;
end;
$$;

revoke execute on function claim_drop from public, anon;
grant execute on function claim_drop to authenticated;

create or replace view team_scores with (security_invoker = true) as
select
  t.id as team_id,
  t.name,
  t.color,
  coalesce((select sum(d.points) from claims c join drops d on d.id = c.drop_id where c.team_id = t.id), 0)::integer as points,
  (select count(*) from claims c where c.team_id = t.id)::integer as claims,
  (select count(*) from building_control b where b.team_id = t.id)::integer as buildings
from teams t;
