PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  uid TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Player',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  best_score INTEGER NOT NULL DEFAULT 0,
  total_matches INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_top3 INTEGER NOT NULL DEFAULT 0,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  virtual_points INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  duration_seconds INTEGER NOT NULL,
  winner_uid TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS match_results (
  match_id TEXT NOT NULL,
  uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  rank INTEGER NOT NULL,
  is_bot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, uid),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE INDEX IF NOT EXISTS idx_match_results_uid ON match_results(uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_match_results_rank ON match_results(rank, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('match_reward','quest_reward','skin_unlock','admin_adjustment')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reference_id TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wallet_uid_created ON wallet_ledger(uid, created_at DESC);

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

CREATE TABLE IF NOT EXISTS cosmetic_unlocks (
  uid TEXT NOT NULL,
  cosmetic_id TEXT NOT NULL,
  unlock_method TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (uid, cosmetic_id)
);

CREATE TABLE IF NOT EXISTS ad_reward_claims (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL UNIQUE,
  reward_type TEXT NOT NULL,
  reward_value INTEGER NOT NULL DEFAULT 0,
  verified_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('lightning','onchain')),
  destination_hash TEXT NOT NULL,
  amount_sats INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER,
  admin_note TEXT
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id TEXT PRIMARY KEY,
  admin_uid TEXT NOT NULL,
  action TEXT NOT NULL,
  target_uid TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ws_tickets (
  ticket TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  display_name TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

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
