CREATE TABLE IF NOT EXISTS player_chests (
  chest_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  match_id TEXT NOT NULL,
  chest_type TEXT NOT NULL CHECK(chest_type IN ('common','rare','legendary')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','opened')),
  found_at INTEGER NOT NULL,
  opened_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_player_chests_uid_status ON player_chests(uid, status, found_at DESC);
