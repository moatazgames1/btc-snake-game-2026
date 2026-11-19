ALTER TABLE players ADD COLUMN total_top3 INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS seasons (
  season_id TEXT PRIMARY KEY,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS player_season_stats (
  season_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  top3 INTEGER NOT NULL DEFAULT 0,
  total_matches INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, uid),
  FOREIGN KEY (season_id) REFERENCES seasons(season_id)
);

CREATE INDEX IF NOT EXISTS idx_player_season_rank ON player_season_stats(season_id, points DESC, wins DESC);
