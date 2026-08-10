-- Real, confirmed gap: player_share_links (00019) had no expiry - a leaked
-- link (screenshot, forwarded text, browser history sync) granted anonymous
-- read access to a player's scouting data forever, until a coach happened to
-- manually revoke it. 90 days is a generous but bounded default - long
-- enough to cover a season's worth of normal sharing, short enough that an
-- old, forgotten link stops working on its own instead of staying a
-- permanent liability.
--
-- `not null default (...)` on an ADD COLUMN backfills every existing row
-- with the default at migration time (standard Postgres ALTER TABLE
-- behavior) - no separate UPDATE needed for already-created links.
alter table player_share_links
  add column expires_at timestamptz not null default (now() + interval '90 days');
