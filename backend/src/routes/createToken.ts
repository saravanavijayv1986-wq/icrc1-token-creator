import { createIcrc1Token } from '../icp/createIcrc1Token';

export async function handleCreateToken(req, res) {
  // Get from validated body
  const { name, symbol, decimals, fee, initialSupply, mintOwner } = req.body;

  const result = await createIcrc1Token({
    name,
    symbol,
    decimals: Number(decimals),
    fee: BigInt(fee),
    initialSupply: BigInt(initialSupply),
    minting: { owner: mintOwner, subaccount: null },
    enableICRC2: true, // or false
  });

  res.json({ ok: true, ...result });
}
