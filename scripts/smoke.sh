#!/usr/bin/env bash
set -euo pipefail

LEDGER_ID="$1"
OWNER_PRINCIPAL="$2"

echo "[1] Metadata"
dfx canister call --network ic "$LEDGER_ID" icrc1_metadata '()' | sed -e 's/\s\+/ /g'

echo "[2] Balance of owner"
dfx canister call --network ic "$LEDGER_ID" icrc1_balance_of "(record { owner = principal \"$OWNER_PRINCIPAL\"; subaccount = null })"

