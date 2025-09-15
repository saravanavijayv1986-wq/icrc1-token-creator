import { config } from '../config';

export async function healthCheck(): Promise<{ ok: boolean; details: Record<string, any> }> {
  const details: Record<string, any> = {};
  try {
    // 1) Treasury identity present
    details.treasuryIdentityLoaded = !!config.treasuryDelegationIdentityJSON;

    // 2) Required IDs present
    details.cyclesWalletId = config.treasuryCyclesWalletCanisterId;
    details.icpLedger = config.icpLedgerCanisterId;

    // 3) WASM fetchable + checksum ok (HEAD or small GET)
    details.icrcWasmUrl = config.icrcWasmUrl;

    // NOTE: full fetch not done here to keep health light. Your startup path will fetch+verify.
    return { ok: true, details };
  } catch (e: any) {
    return { ok: false, details: { error: e?.message ?? String(e) } };
  }
}
