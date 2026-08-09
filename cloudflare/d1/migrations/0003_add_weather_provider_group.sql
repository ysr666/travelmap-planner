BEGIN TRANSACTION;

CREATE TABLE provider_daily_usage_v2 (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'preview', 'development')),
  usage_date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('account', 'ip', 'global')),
  group_name TEXT NOT NULL CHECK (group_name IN ('ai', 'search', 'place', 'route', 'weather', 'fx')),
  identity_hash TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  limit_value INTEGER NOT NULL CHECK (limit_value > 0),
  updated_at INTEGER NOT NULL
);

INSERT INTO provider_daily_usage_v2
SELECT id, environment, usage_date, scope, group_name, identity_hash, count, limit_value, updated_at
FROM provider_daily_usage;

DROP TABLE provider_daily_usage;
ALTER TABLE provider_daily_usage_v2 RENAME TO provider_daily_usage;

CREATE INDEX provider_daily_usage_date_idx
ON provider_daily_usage (usage_date);

CREATE INDEX provider_daily_usage_group_idx
ON provider_daily_usage (environment, usage_date, group_name, scope);

CREATE TABLE provider_controls_v2 (
  id TEXT PRIMARY KEY CHECK (id IN ('global', 'ai', 'search', 'place', 'route', 'weather', 'fx')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  disabled_until INTEGER,
  reason TEXT,
  updated_at INTEGER NOT NULL
);

INSERT INTO provider_controls_v2
SELECT id, enabled, disabled_until, reason, updated_at
FROM provider_controls;

INSERT INTO provider_controls_v2 (id, enabled, disabled_until, reason, updated_at)
VALUES ('weather', 1, NULL, NULL, 0);

DROP TABLE provider_controls;
ALTER TABLE provider_controls_v2 RENAME TO provider_controls;

CREATE TABLE provider_alerts_v2 (
  id TEXT PRIMARY KEY,
  environment TEXT NOT NULL CHECK (environment IN ('production', 'preview', 'development')),
  usage_date TEXT NOT NULL,
  group_name TEXT NOT NULL CHECK (group_name IN ('ai', 'search', 'place', 'route', 'weather', 'fx')),
  threshold INTEGER NOT NULL CHECK (threshold IN (70, 90)),
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

INSERT INTO provider_alerts_v2
SELECT id, environment, usage_date, group_name, threshold, created_at, sent_at
FROM provider_alerts;

DROP TABLE provider_alerts;
ALTER TABLE provider_alerts_v2 RENAME TO provider_alerts;

CREATE INDEX provider_alerts_sent_at_idx
ON provider_alerts (sent_at);

CREATE INDEX provider_alerts_pending_idx
ON provider_alerts (created_at)
WHERE sent_at IS NULL;

COMMIT;
