-- Replace DECIMAL/NUMERIC columns with DOUBLE PRECISION to comply with Encore.ts restrictions.

ALTER TABLE token_metrics
  ALTER COLUMN price_usd TYPE DOUBLE PRECISION USING price_usd::DOUBLE PRECISION,
  ALTER COLUMN market_cap_usd TYPE DOUBLE PRECISION USING market_cap_usd::DOUBLE PRECISION;

ALTER TABLE platform_metrics
  ALTER COLUMN metric_value TYPE DOUBLE PRECISION USING metric_value::DOUBLE PRECISION;
