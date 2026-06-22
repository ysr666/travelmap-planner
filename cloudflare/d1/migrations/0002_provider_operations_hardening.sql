CREATE TABLE IF NOT EXISTS provider_daily_usage (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'preview', 'development')),
  usage_date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'ip', 'global')),
  group_name TEXT NOT NULL CHECK (group_name IN ('ai', 'search', 'place', 'route', 'fx')),
  identity_hash TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  limit_value INTEGER NOT NULL CHECK (limit_value > 0),
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_daily_usage_date_idx
ON provider_daily_usage (usage_date);

CREATE INDEX IF NOT EXISTS provider_daily_usage_group_idx
ON provider_daily_usage (environment, usage_date, group_name, scope);

CREATE TABLE IF NOT EXISTS provider_controls (
  id TEXT PRIMARY KEY CHECK (id IN ('global', 'ai', 'search', 'place', 'route', 'fx')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  disabled_until INTEGER,
  reason TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO provider_controls (id, enabled, disabled_until, reason, updated_at)
VALUES
  ('global', 1, NULL, NULL, 0),
  ('ai', 1, NULL, NULL, 0),
  ('search', 1, NULL, NULL, 0),
  ('place', 1, NULL, NULL, 0),
  ('route', 1, NULL, NULL, 0),
  ('fx', 1, NULL, NULL, 0)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS provider_alerts (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'preview', 'development')),
  usage_date TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('ai', 'search', 'place', 'route', 'fx')),
  threshold INTEGER NOT NULL CHECK (threshold IN (70, 90)),
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS provider_alerts_sent_at_idx
ON provider_alerts (sent_at);

CREATE INDEX IF NOT EXISTS provider_alerts_pending_idx
ON provider_alerts (created_at)
WHERE sent_at IS NULL;
