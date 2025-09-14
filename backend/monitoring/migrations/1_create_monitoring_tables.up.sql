-- Canister health metrics
CREATE TABLE canister_health (
  id BIGSERIAL PRIMARY KEY,
  canister_id TEXT NOT NULL,
  token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  cycle_balance BIGINT NOT NULL,
  memory_size BIGINT NOT NULL,
  controllers TEXT[] NOT NULL DEFAULT '{}',
  module_hash TEXT,
  last_check TIMESTAMP NOT NULL DEFAULT NOW(),
  response_time_ms INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  uptime_percentage DOUBLE PRECISION NOT NULL DEFAULT 100.0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Transaction success metrics
CREATE TABLE transaction_metrics (
  id BIGSERIAL PRIMARY KEY,
  canister_id TEXT NOT NULL,
  token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE,
  date_recorded DATE NOT NULL DEFAULT CURRENT_DATE,
  total_transactions INTEGER NOT NULL DEFAULT 0,
  successful_transactions INTEGER NOT NULL DEFAULT 0,
  failed_transactions INTEGER NOT NULL DEFAULT 0,
  average_response_time_ms DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(canister_id, date_recorded)
);

-- Cycle balance alerts
CREATE TABLE cycle_alerts (
  id BIGSERIAL PRIMARY KEY,
  canister_id TEXT NOT NULL,
  token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- 'low_cycles', 'critical_cycles', 'cycles_depleted'
  threshold_value BIGINT NOT NULL,
  current_value BIGINT NOT NULL,
  alert_sent BOOLEAN NOT NULL DEFAULT FALSE,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Performance metrics
CREATE TABLE performance_metrics (
  id BIGSERIAL PRIMARY KEY,
  canister_id TEXT NOT NULL,
  token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL, -- 'response_time', 'throughput', 'error_rate'
  metric_value DOUBLE PRECISION NOT NULL,
  measurement_time TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB
);

-- Health check configurations
CREATE TABLE health_check_config (
  id BIGSERIAL PRIMARY KEY,
  canister_id TEXT NOT NULL UNIQUE,
  token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE,
  check_interval_minutes INTEGER NOT NULL DEFAULT 15,
  cycle_warning_threshold BIGINT NOT NULL DEFAULT 1000000000000, -- 1T cycles
  cycle_critical_threshold BIGINT NOT NULL DEFAULT 100000000000, -- 100B cycles
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Monitoring alerts log
CREATE TABLE monitoring_alerts (
  id BIGSERIAL PRIMARY KEY,
  canister_id TEXT NOT NULL,
  token_id BIGINT REFERENCES tokens(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL, -- 'info', 'warning', 'critical'
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_canister_health_canister_id ON canister_health(canister_id);
CREATE INDEX idx_canister_health_token_id ON canister_health(token_id);
CREATE INDEX idx_canister_health_last_check ON canister_health(last_check);
CREATE INDEX idx_canister_health_cycle_balance ON canister_health(cycle_balance);

CREATE INDEX idx_transaction_metrics_canister_id ON transaction_metrics(canister_id);
CREATE INDEX idx_transaction_metrics_date ON transaction_metrics(date_recorded);

CREATE INDEX idx_cycle_alerts_canister_id ON cycle_alerts(canister_id);
CREATE INDEX idx_cycle_alerts_resolved ON cycle_alerts(resolved);
CREATE INDEX idx_cycle_alerts_created_at ON cycle_alerts(created_at);

CREATE INDEX idx_performance_metrics_canister_id ON performance_metrics(canister_id);
CREATE INDEX idx_performance_metrics_type ON performance_metrics(metric_type);
CREATE INDEX idx_performance_metrics_time ON performance_metrics(measurement_time);

CREATE INDEX idx_monitoring_alerts_canister_id ON monitoring_alerts(canister_id);
CREATE INDEX idx_monitoring_alerts_severity ON monitoring_alerts(severity);
CREATE INDEX idx_monitoring_alerts_acknowledged ON monitoring_alerts(acknowledged);
CREATE INDEX idx_monitoring_alerts_created_at ON monitoring_alerts(created_at);

-- Constraints
ALTER TABLE canister_health ADD CONSTRAINT chk_health_status 
CHECK (status IN ('running', 'stopping', 'stopped'));

ALTER TABLE canister_health ADD CONSTRAINT chk_health_positive_values 
CHECK (cycle_balance >= 0 AND memory_size >= 0 AND error_count >= 0 AND uptime_percentage >= 0 AND uptime_percentage <= 100);

ALTER TABLE transaction_metrics ADD CONSTRAINT chk_transaction_positive_values 
CHECK (total_transactions >= 0 AND successful_transactions >= 0 AND failed_transactions >= 0 AND average_response_time_ms >= 0);

ALTER TABLE cycle_alerts ADD CONSTRAINT chk_alert_type 
CHECK (alert_type IN ('low_cycles', 'critical_cycles', 'cycles_depleted', 'high_error_rate', 'canister_stopped'));

ALTER TABLE performance_metrics ADD CONSTRAINT chk_metric_type 
CHECK (metric_type IN ('response_time', 'throughput', 'error_rate', 'memory_usage', 'instruction_count'));

ALTER TABLE monitoring_alerts ADD CONSTRAINT chk_alert_severity 
CHECK (severity IN ('info', 'warning', 'critical'));

-- Function to update health check config timestamp
CREATE OR REPLACE FUNCTION update_health_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_health_config_timestamp
    BEFORE UPDATE ON health_check_config
    FOR EACH ROW
    EXECUTE FUNCTION update_health_config_updated_at();
