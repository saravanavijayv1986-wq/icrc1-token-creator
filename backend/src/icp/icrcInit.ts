type Account = { owner: string; subaccount?: Uint8Array | null };

export type IcrcInitInput = {
  name: string;
  symbol: string;
  decimals: number;      // usually 8
  fee: bigint;           // smallest units
  minting: Account;      // often a canister principal controlled by the app
  initialSupply: bigint; // smallest units, minted to `minting`
  enableICRC2?: boolean;
};

export function validateIcrcInit(i: IcrcInitInput) {
  if (!/^[A-Z0-9]{2,10}$/.test(i.symbol)) throw new Error('Bad symbol (2-10 A-Z0-9)');
  if (i.name.length < 2 || i.name.length > 64) throw new Error('Bad name length (2-64)');
  if (i.decimals < 0 || i.decimals > 18) throw new Error('Bad decimals (0-18)');
  if (i.fee < 0n) throw new Error('Bad fee');
  if (i.initialSupply < 0n) throw new Error('Bad initial supply');
  if (!i.minting?.owner) throw new Error('Missing minting account owner');
}

export function buildIcrcInitArgs(i: IcrcInitInput): string {
  validateIcrcInit(i);
  const sub = i.minting.subaccount ? `; subaccount = opt vec { ${[...i.minting.subaccount].join('; ')} }` : '; subaccount = null';
  const feature = i.enableICRC2 ? 'opt record { icrc2 = true }' : 'null';
  // candid arg string
  return `(
    record {
      token_symbol = "${i.symbol}";
      token_name   = "${i.name}";
      minting_account = record { owner = principal "${i.minting.owner}"${sub} };
      transfer_fee = ${i.fee} : nat;
      metadata = vec {
        record { "icrc1:symbol";   variant { Text = "${i.symbol}" } };
        record { "icrc1:name";     variant { Text = "${i.name}" } };
        record { "icrc1:decimals"; variant { Nat = ${i.decimals} } };
        record { "icrc1:fee";      variant { Nat = ${i.fee} } };
      };
      initial_balances = vec {
        record { record { owner = principal "${i.minting.owner}"${sub} }; ${i.initialSupply} : nat }
      };
      feature_flags = ${feature};
      archive_options = null;
    }
  )`;
}
