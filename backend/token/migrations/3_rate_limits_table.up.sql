CREATE TABLE IF NOT EXISTS rate_limits (
  limiter_name TEXT NOT NULL,
  key TEXT NOT NULL,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (limiter_name, key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end ON rate_limits(window_end);
