CREATE TABLE tokens (
  id BIGSERIAL PRIMARY KEY,
  token_name TEXT NOT NULL,
  symbol TEXT NOT NULL UNIQUE,
  total_supply BIGINT NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 8,
  logo_url TEXT,
  canister_id TEXT,
  creator_principal TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB,
  is_mintable BOOLEAN NOT NULL DEFAULT FALSE,
  is_burnable BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,
  deploy_attempts INTEGER NOT NULL DEFAULT 0,
  last_deploy_attempt TIMESTAMP
);

CREATE INDEX idx_tokens_creator ON tokens(creator_principal);
CREATE INDEX idx_tokens_symbol ON tokens(UPPER(symbol));
CREATE INDEX idx_tokens_status ON tokens(status);
CREATE INDEX idx_tokens_created_at ON tokens(created_at);
CREATE INDEX idx_tokens_canister_id ON tokens(canister_id) WHERE canister_id IS NOT NULL;

-- Add constraint for valid status values
ALTER TABLE tokens ADD CONSTRAINT chk_token_status 
CHECK (status IN ('pending', 'deploying', 'deployed', 'failed'));

-- Add constraint for valid decimals
ALTER TABLE tokens ADD CONSTRAINT chk_token_decimals 
CHECK (decimals >= 0 AND decimals <= 18);

-- Add constraint for valid supply
ALTER TABLE tokens ADD CONSTRAINT chk_token_supply 
CHECK (total_supply > 0);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tokens_updated_at 
    BEFORE UPDATE ON tokens 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
