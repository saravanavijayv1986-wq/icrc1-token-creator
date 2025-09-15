type Account = { owner: string; subaccount?: Uint8Array | null };

// shell to dfx for simplicity; you can use ic-agent instead
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const pexec = promisify(execFile);

export async function icrc1BalanceOf(ledgerCanisterId: string, acct: Account, network = 'ic') {
  const sub = acct.subaccount ? `; subaccount = opt vec { ${[...acct.subaccount].join('; ')} }` : '; subaccount = null';
  const arg = `(record { owner = principal "${acct.owner}"${sub} })`;
  const { stdout } = await pexec('dfx', ['canister', 'call', '--network', network, ledgerCanisterId, 'icrc1_balance_of', arg]);
  return stdout.trim(); // parse candid if needed
}
