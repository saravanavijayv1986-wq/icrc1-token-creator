import { createHash } from 'crypto';

export async function fetchAndVerifyLedgerWasm(url: string, expectedSha256: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Failed to fetch ICRC1 WASM: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const hash = createHash('sha256').update(buf).digest('hex');
  if (expectedSha256 && hash !== expectedSha256.toLowerCase()) {
    throw new Error(`ICRC1 WASM checksum mismatch. got=${hash}, expected=${expectedSha256}`);
  }
  return buf;
}
