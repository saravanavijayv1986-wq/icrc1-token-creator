import { IDL } from "@dfinity/candid";

// Management canister (aaaaa-aa)
export const managementIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const CanisterId = IDL.Principal;
  const DefiniteCanisterSettings = IDL.Record({
    controllers: IDL.Vec(IDL.Principal),
    compute_allocation: IDL.Nat,
    memory_allocation: IDL.Nat,
    freezing_threshold: IDL.Nat,
  });
  const canister_status = IDL.Record({
    status: IDL.Variant({ running: IDL.Null, stopping: IDL.Null, stopped: IDL.Null }),
    memory_size: IDL.Nat,
    cycles: IDL.Nat,
    settings: DefiniteCanisterSettings,
    module_hash: IDL.Opt(IDL.Vec(IDL.Nat8)),
  });

  const CanisterSettings = IDL.Record({
    controllers: IDL.Opt(IDL.Vec(IDL.Principal)),
    compute_allocation: IDL.Opt(IDL.Nat),
    memory_allocation: IDL.Opt(IDL.Nat),
    freezing_threshold: IDL.Opt(IDL.Nat),
  });

  return IDL.Service({
    create_canister: IDL.Func(
      [IDL.Record({ settings: IDL.Opt(CanisterSettings) })],
      [IDL.Record({ canister_id: IDL.Principal })],
      []
    ),
    install_code: IDL.Func(
      [IDL.Record({
        mode: IDL.Variant({ install: IDL.Null, reinstall: IDL.Null, upgrade: IDL.Null }),
        canister_id: CanisterId,
        wasm_module: IDL.Vec(IDL.Nat8),
        arg: IDL.Vec(IDL.Nat8)
      })],
      [],
      []
    ),
    canister_status: IDL.Func(
      [IDL.Record({ canister_id: CanisterId })],
      [canister_status],
      []
    ),
    update_settings: IDL.Func(
      [IDL.Record({
        canister_id: CanisterId,
        settings: CanisterSettings,
      })],
      [],
      []
    ),
    stop_canister: IDL.Func([IDL.Record({ canister_id: CanisterId })], [], []),
    start_canister: IDL.Func([IDL.Record({ canister_id: CanisterId })], [], []),
    delete_canister: IDL.Func([IDL.Record({ canister_id: CanisterId })], [], []),
    deposit_cycles: IDL.Func([IDL.Record({ canister_id: CanisterId })], [], []),
  });
};

// Cycles wallet interface (wallet_canister)
export const cyclesWalletIdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  return IDL.Service({
    wallet_create_canister: IDL.Func(
      [IDL.Record({
        settings: IDL.Record({
          controllers: IDL.Vec(IDL.Principal),
          compute_allocation: IDL.Opt(IDL.Nat),
          memory_allocation: IDL.Opt(IDL.Nat),
          freezing_threshold: IDL.Opt(IDL.Nat),
        }),
        cycles: IDL.Nat,
      })],
      [IDL.Record({ canister_id: IDL.Principal })],
      []
    ),
    wallet_install_code: IDL.Func(
      [IDL.Record({
        mode: IDL.Variant({ install: IDL.Null, reinstall: IDL.Null, upgrade: IDL.Null }),
        canister_id: IDL.Principal,
        wasm_module: IDL.Vec(IDL.Nat8),
        arg: IDL.Vec(IDL.Nat8),
      })],
      [],
      []
    ),
  });
};

// ICRC-1 token canister (generic)
export const icrc1IdlFactory: IDL.InterfaceFactory = ({ IDL }) => {
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const Value = IDL.Variant({
    Nat: IDL.Nat,
    Int: IDL.Int,
    Text: IDL.Text,
    Blob: IDL.Vec(IDL.Nat8),
  });
  const TransferError = IDL.Variant({
    BadFee: IDL.Record({ expected_fee: IDL.Nat }),
    InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
    TxTooOld: IDL.Record({ allowed_window_nanos: IDL.Nat64 }),
    TxCreatedInFuture: IDL.Null,
    TxDuplicate: IDL.Record({ duplicate_of: IDL.Nat }),
    BadBurn: IDL.Record({ min_burn_amount: IDL.Nat }),
    GenericError: IDL.Record({ error_code: IDL.Nat, message: IDL.Text }),
  });

  return IDL.Service({
    icrc1_name: IDL.Func([], [IDL.Text], ["query"]),
    icrc1_symbol: IDL.Func([], [IDL.Text], ["query"]),
    icrc1_decimals: IDL.Func([], [IDL.Nat8], ["query"]),
    icrc1_total_supply: IDL.Func([], [IDL.Nat], ["query"]),
    icrc1_metadata: IDL.Func([], [IDL.Vec(IDL.Tuple(IDL.Text, Value))], ["query"]),
    icrc1_balance_of: IDL.Func([Account], [IDL.Nat], ["query"]),
    icrc1_transfer: IDL.Func(
      [IDL.Record({
        from_subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)),
        to: Account,
        amount: IDL.Nat,
        fee: IDL.Opt(IDL.Nat),
        memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
        created_at_time: IDL.Opt(IDL.Nat64),
      })],
      [IDL.Variant({ Ok: IDL.Nat, Err: TransferError })],
      []
    ),
    // Non-standard extensions we expect our deployed token to provide:
    mint: IDL.Func([IDL.Record({ to: Account, amount: IDL.Nat })], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
    burn: IDL.Func([IDL.Record({ from: Account, amount: IDL.Nat })], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
  });
};

// ICRC-1 ledger-like interface (ICP)
export const icrc1LedgerIdlFactory = icrc1IdlFactory;

// Candid encoder for init args for our token
export function encodeIcrc1InitArgs(params: {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  owner: string;
  isMintable: boolean;
  isBurnable: boolean;
}): Uint8Array {
  const { IDL } = require("@dfinity/candid") as typeof import("@dfinity/candid");
  const Account = IDL.Record({ owner: IDL.Principal, subaccount: IDL.Opt(IDL.Vec(IDL.Nat8)) });
  const MetadataValue = IDL.Variant({
    Nat: IDL.Nat,
    Int: IDL.Int,
    Text: IDL.Text,
    Blob: IDL.Vec(IDL.Nat8),
  });

  const InitArgs = IDL.Record({
    name: IDL.Text,
    symbol: IDL.Text,
    decimals: IDL.Nat8,
    initial_balances: IDL.Vec(IDL.Record({ account: Account, amount: IDL.Nat })),
    minting_account: IDL.Opt(Account),
    burning_account: IDL.Opt(Account),
    transfer_fee: IDL.Nat,
    archive_options: IDL.Record({
      trigger_threshold: IDL.Nat,
      num_blocks_to_archive: IDL.Nat,
      controller_id: IDL.Principal,
    }),
    metadata: IDL.Vec(IDL.Tuple(IDL.Text, MetadataValue)),
  });

  const ownerP = require("@dfinity/principal").Principal.fromText(params.owner);
  const mintAcc = params.isMintable ? [{ owner: ownerP, subaccount: [] }] : [];
  const burnAcc = params.isBurnable ? [{ owner: ownerP, subaccount: [] }] : [];

  const arg = {
    name: params.name,
    symbol: params.symbol,
    decimals: params.decimals,
    initial_balances: [{ account: { owner: ownerP, subaccount: [] }, amount: params.totalSupply }],
    minting_account: mintAcc[0] ? mintAcc[0] : [],
    burning_account: burnAcc[0] ? burnAcc[0] : [],
    transfer_fee: BigInt(10_000),
    archive_options: {
      trigger_threshold: BigInt(2_000),
      num_blocks_to_archive: BigInt(1_000),
      controller_id: ownerP,
    },
    metadata: [
      ["icrc1:name", { Text: params.name }],
      ["icrc1:symbol", { Text: params.symbol }],
      ["icrc1:decimals", { Nat: BigInt(params.decimals) }],
      ["icrc1:fee", { Nat: BigInt(10_000) }],
      ["icrc1:logo", { Text: "" }],
    ],
  };

  return IDL.encode([InitArgs], [arg]);
}
