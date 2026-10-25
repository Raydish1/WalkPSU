-- Optional theme for campus events (sports, culture, academics, …).
-- Clients also infer a category from the title when this is null.

alter table public.drops
  add column if not exists category text;

comment on column public.drops.category is
  'Event theme: sports | culture | academics | social | campus. Null = infer from title.';
