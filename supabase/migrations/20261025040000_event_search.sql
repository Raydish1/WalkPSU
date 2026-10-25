-- AI event search (web/api/search-events.ts) rate limit. Each search costs a Gemini call, so a player gets a few per
-- window. Stores only a counter per player: never the query, never a log of searches.

create table search_quota (
  player_id uuid primary key references players (id) on delete cascade,
  window_start timestamptz not null,
  used integer not null
);

-- No policies: only use_search_quota() (security definer) touches it.
alter table search_quota enable row level security;
revoke all on search_quota from anon, authenticated;

-- Takes one search from the caller's allowance: 10 per 10 minutes. True if allowed.
create function use_search_quota() returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_player uuid := current_player_id();
  v_used integer;
begin
  if v_player is null then
    raise exception 'Join the game before searching';
  end if;
  insert into search_quota as q (player_id, window_start, used) values (v_player, now(), 1)
  on conflict (player_id) do update set
    window_start = case when q.window_start <= now() - interval '10 minutes' then now() else q.window_start end,
    used = case when q.window_start <= now() - interval '10 minutes' then 1 else q.used + 1 end
  returning used into v_used;
  return v_used <= 10;
end;
$$;

revoke execute on function use_search_quota from public, anon;
grant execute on function use_search_quota to authenticated;
