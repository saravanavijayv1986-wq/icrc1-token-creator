import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);

// If ENABLE_INDEX_CANISTER=true, deploy index for a ledger
export async function maybeDeployIndexFor(ledgerCanisterId: string) {
  if (process.env.ENABLE_INDEX_CANISTER?.toLowerCase() !== 'true') return null;

  // NOTE: fetch & pin correct index WASM that matches your ledger-suite version.
  // Example placeholder – implement similarly to ledgerWasm.ts
  // const wasm = await fetchAndVerifyIndexWasm(url, sha256);

  // For brevity, using an already-present wasm path:
  const indexName = `icrc1_index_${Date.now()}`;
  await pexec('dfx', ['canister', 'create', indexName, '--network', 'ic']);
  await pexec('dfx', ['canister', 'deposit-cycles', indexName, '--network', 'ic', '--amount', '1000000000000']);

  // Build argument to link to ledger
  // Many index canisters take: (record { ledger_id = principal "<id>" })
  const args = `(record { ledger_id = principal "${ledgerCanisterId}" })`;
  const argsPath = `/tmp/${indexName}.args`;
  await (await import('node:fs/promises')).writeFile(argsPath, args, 'utf8');

  // Install (replace --wasm with the pinned index wasm file path)
  await pexec('dfx', ['canister', 'install', indexName, '--network', 'ic', '--wasm', './canisters/icrc1_index/icrc1_index.wasm.gz', '--argument-file', argsPath, '--mode', 'install']);

  const id = (await pexec('dfx', ['canister', 'id', indexName, '--network', 'ic'])).stdout.trim();
  return id;
}
