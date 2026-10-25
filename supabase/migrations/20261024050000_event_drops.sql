-- Drops made from real campus events (scripts/seed-event-drops.mjs): who hosts it, when it starts, and where it came from.
alter table drops add column subtitle text;
alter table drops add column starts_at timestamptz;
-- e.g. 'discover:12893409'. Marks imported drops so the seed script can find and clear exactly those; null = made in /admin.
alter table drops add column source_id text unique;
