import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config';
import { fetchAndVerifyLedgerWasm } from './ledgerWasm';
import { buildIcrcInitArgs, IcrcInitInput } from './icrcInit';

const pexec = promisify(execFile);

async function dfx(args: string[], env = process.env) {
  const { stdout, stderr } = await pexec('dfx', args, { env });
  if (stderr && stderr.trim()) console.error('[dfx]', stderr);
  return stdout.trim();
}

export async function createIcrc1Token(input: IcrcInitInput) {
  // 1) fetch + verify wasm
  const wasm = await fetchAndVerifyLedgerWasm(config.icrcWasmUrl, config.icrcWasmSha256);

  // 2) write wasm to a temp file
  const tmp = await import('node:fs/promises');
  const path = `/tmp/icrc1-ledger-${Date.now()}.wasm.gz`;
  await tmp.writeFile(path, wasm);

  // 3) create canister on mainnet
  const canisterName = `icrc1_ledger_${Date.now()}`;
  await dfx(['canister', 'create', canisterName, '--network', 'ic']);

  // 4) deposit cycles
  await dfx(['canister', 'deposit-cycles', canisterName, '--network', 'ic', '--amount', String(config.deployCyclesAmount)]);

  // 5) resolve canister id
  const canisterId = (await dfx(['canister', 'id', canisterName, '--network', 'ic'])).trim();

  // 6) build init args file
  const argsPath = `/tmp/${canisterName}.args`;
  const args = buildIcrcInitArgs(input);
  await tmp.writeFile(argsPath, args, 'utf8');

  // 7) install code
  await dfx([
    'canister', 'install', canisterName,
    '--network', 'ic',
    '--wasm', path,
    '--argument-file', argsPath,
    '--mode', 'install'
  ]);

  return { canisterId, name: input.name, symbol: input.symbol, decimals: input.decimals };
}
