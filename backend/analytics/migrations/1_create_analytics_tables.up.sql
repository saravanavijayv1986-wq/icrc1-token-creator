CREATE TABLE token_metrics (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT NOT NULL,
  metric_date DATE NOT NULL,
  total_supply BIGINT NOT NULL,
  holder_count INTEGER NOT NULL DEFAULT 0,
  transfer_count INTEGER NOT NULL DEFAULT 0,
  mint_count INTEGER NOT NULL DEFAULT 0,
  burn_count INTEGER NOT NULL DEFAULT 0,
  volume_24h BIGINT NOT NULL DEFAULT 0,
  price_usd DECIMAL(18,8),
  market_cap_usd DECIMAL(18,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE daily_stats (
  id BIGSERIAL PRIMARY KEY,
  stat_date DATE NOT NULL UNIQUE,
  total_tokens_created INTEGER NOT NULL DEFAULT 0,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  total_volume BIGINT NOT NULL DEFAULT 0,
  active_tokens INTEGER NOT NULL DEFAULT 0,
  new_holders INTEGER NOT NULL DEFAULT 0,
  total_holders INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE platform_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  metric_value DECIMAL(18,8) NOT NULL,
  metric_tags JSONB,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for token_metrics
CREATE UNIQUE INDEX idx_token_metrics_token_date ON token_metrics(token_id, metric_date);
CREATE INDEX idx_token_metrics_date ON token_metrics(metric_date);
CREATE INDEX idx_token_metrics_token_id ON token_metrics(token_id);

-- Indexes for daily_stats
CREATE INDEX idx_daily_stats_date ON daily_stats(stat_date);

-- Indexes for platform_metrics
CREATE INDEX idx_platform_metrics_name ON platform_metrics(metric_name);
CREATE INDEX idx_platform_metrics_recorded_at ON platform_metrics(recorded_at);
CREATE INDEX idx_platform_metrics_tags ON platform_metrics USING GIN(metric_tags);

-- Add constraints
ALTER TABLE token_metrics ADD CONSTRAINT chk_token_metrics_positive_counts 
CHECK (
  holder_count >= 0 AND 
  transfer_count >= 0 AND 
  mint_count >= 0 AND 
  burn_count >= 0 AND 
  volume_24h >= 0
);

-- Create function for updating timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_token_metrics_updated_at 
    BEFORE UPDATE ON token_metrics 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_daily_stats_updated_at 
    BEFORE UPDATE ON daily_stats 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create materialized view for performance
CREATE MATERIALIZED VIEW token_metrics_summary AS
SELECT 
  token_id,
  COUNT(*) as days_tracked,
  MAX(metric_date) as last_metric_date,
  AVG(holder_count) as avg_holder_count,
  SUM(transfer_count) as total_transfers,
  SUM(mint_count) as total_mints,
  SUM(burn_count) as total_burns,
  AVG(volume_24h) as avg_daily_volume,
  MAX(total_supply) as current_supply
FROM token_metrics 
GROUP BY token_id;

CREATE UNIQUE INDEX idx_token_metrics_summary_token_id ON token_metrics_summary(token_id);

-- Refresh materialized view daily
CREATE OR REPLACE FUNCTION refresh_token_metrics_summary()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY token_metrics_summary;
END;
$$ LANGUAGE plpgsql;
