CREATE TABLE token_transactions (
  id BIGSERIAL PRIMARY KEY,
  token_id BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL,
  from_principal TEXT,
  to_principal TEXT,
  amount BIGINT,
  fee_paid DOUBLE PRECISION,
  tx_hash TEXT,
  block_index BIGINT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB,
  status TEXT NOT NULL DEFAULT 'confirmed'
);

CREATE INDEX idx_transactions_token ON token_transactions(token_id);
CREATE INDEX idx_transactions_type ON token_transactions(transaction_type);
CREATE INDEX idx_transactions_created_at ON token_transactions(created_at);
CREATE INDEX idx_transactions_from_principal ON token_transactions(from_principal) WHERE from_principal IS NOT NULL;
CREATE INDEX idx_transactions_to_principal ON token_transactions(to_principal) WHERE to_principal IS NOT NULL;
CREATE INDEX idx_transactions_tx_hash ON token_transactions(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX idx_transactions_block_index ON token_transactions(block_index) WHERE block_index IS NOT NULL;

-- Add constraint for valid transaction types
ALTER TABLE token_transactions ADD CONSTRAINT chk_transaction_type 
CHECK (transaction_type IN ('creation', 'mint', 'burn', 'transfer', 'approve'));

-- Add constraint for valid status values
ALTER TABLE token_transactions ADD CONSTRAINT chk_transaction_status 
CHECK (status IN ('pending', 'confirmed', 'failed'));

-- Add constraint to ensure amount is positive for relevant transaction types
ALTER TABLE token_transactions ADD CONSTRAINT chk_transaction_amount 
CHECK (
  (transaction_type IN ('mint', 'burn', 'transfer') AND amount > 0) OR
  (transaction_type NOT IN ('mint', 'burn', 'transfer'))
);
