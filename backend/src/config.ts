import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Missing required env: ${name}`);
  return v.trim();
}

function optional(name: string, def?: string) {
  const v = process.env[name];
  return (v === undefined || v === null || v === '') ? def : v;
}

export const config = {
  icpHost: required('ICP_HOST'),
  icpLedgerCanisterId: required('ICP_LEDGER_CANISTER_ID'),

  deployCyclesAmount: BigInt(required('DEPLOY_CYCLES_AMOUNT')),

  treasuryIcpWalletPrincipal: required('TREASURY_ICP_WALLET_PRINCIPAL'),
  treasuryCyclesWalletCanisterId: required('TREASURY_CYCLES_WALLET_CANISTER_ID'),
  treasuryDelegationIdentityJSON: required('TREASURY_DELEGATION_IDENTITY_JSON'),

  icrcWasmUrl: required('ICRC_WASM_URL'),
  icrcWasmSha256: required('ICRC_WASM_SHA256'),

  enableIndexCanister: (optional('ENABLE_INDEX_CANISTER', 'false')!.toLowerCase() === 'true'),
};
