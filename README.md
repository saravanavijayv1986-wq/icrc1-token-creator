# ICRC-1 Token Deployment on ICP Mainnet

This guide provides a step-by-step process for deploying a production-ready ICRC-1 token on the Internet Computer mainnet using `dfx`.

## 1. Install and Setup dfx

First, install the DFINITY Canister SDK (`dfx`).

```sh
# Install dfx
sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"

# Verify installation
dfx --version
```

Create a new workspace for your project:

```sh
mkdir icrc1-token && cd icrc1-token
dfx new --no-frontend .
```

## 2. Switch to a Mainnet Identity

You need a dedicated identity for mainnet deployments.

```sh
# Create a dedicated identity (if not done before)
dfx identity new mainnet --storage-mode=plaintext

# Use this identity
dfx identity use mainnet

# Show principal (you’ll need this for the minting account)
dfx identity get-principal
```

## 3. Download ICRC-1 Ledger Canister

Create a folder for canister artifacts:

```sh
mkdir -p canisters/icrc1_ledger
```

Download the latest ICRC-1 ledger WASM module and Candid file:

```sh
curl -L -o canisters/icrc1_ledger/icrc1_ledger.wasm \
  https://download.dfinity.systems/ic/crypto/icrc1_ledger/latest/icrc1_ledger.wasm

curl -L -o canisters/icrc1_ledger/icrc1_ledger.did \
  https://download.dfinity.systems/ic/crypto/icrc1_ledger/latest/icrc1_ledger.did
```

## 4. Update dfx.json

Add the ledger canister configuration to your `dfx.json` file. Ensure you also have network configurations for `local` and `ic`.

```json
{
  "canisters": {
    "icrc1_ledger": {
      "type": "custom",
      "wasm": "canisters/icrc1_ledger/icrc1_ledger.wasm",
      "candid": "canisters/icrc1_ledger/icrc1_ledger.did"
    }
  },
  "networks": {
    "local": { "bind": "127.0.0.1:4943", "type": "ephemeral" },
    "ic": { "providers": ["https://ic0.app"] }
  }
}
```

## 5. Create Init Args Template

Create a file named `icrc1_init.args` to specify your token's initial parameters.

```candid
(
  record {
    token_symbol = "<SYMBOL>";
    token_name   = "<NAME>";
    minting_account = record { owner = principal "<OWNER_PRINCIPAL>"; };
    transfer_fee = <FEE> : nat;
    metadata = vec {
      record { "icrc1:symbol";   variant { Text = "<SYMBOL>" } };
      record { "icrc1:name";     variant { Text = "<NAME>" } };
      record { "icrc1:decimals"; variant { Nat = <DECIMALS> } };
      record { "icrc1:fee";      variant { Nat = <FEE> } };
    };
    initial_balances = vec {
      record {
        record { owner = principal "<OWNER_PRINCIPAL>"; };
        <INITIAL_SUPPLY> : nat
      }
    };
    feature_flags = opt record { icrc2 = true };
    archive_options = record {
      num_blocks_to_archive = 2000;
      trigger_threshold = 4000;
      cycles_for_archive_creation = opt 1_000_000_000_000;
      node_max_memory_size_bytes = opt 3_221_225_472;
      controller_id = principal "<OWNER_PRINCIPAL>";
    };
  }
)
```

**Replace placeholders:**

-   `<SYMBOL>`: Your token's ticker (e.g., "SOLF").
-   `<NAME>`: Your token's full name (e.g., "SolForge").
-   `<OWNER_PRINCIPAL>`: The principal of your treasury or minting account.
-   `<FEE>`: The transaction fee in the token's smallest units (e.g., `10000`).
-   `<DECIMALS>`: The number of decimal places (e.g., `8`).
-   `<INITIAL_SUPPLY>`: The starting supply in the token's smallest units.

## 6. Create and Fund Canister

First, create the canister on the IC network. This reserves a canister ID for you.

```sh
dfx canister create icrc1_ledger --network ic
```

Next, add cycles to your canister to pay for computation and storage. You must first convert ICP to cycles in the NNS frontend.

```sh
dfx canister deposit-cycles 3_000_000_000_000 icrc1_ledger --network ic
```

## 7. Deploy Ledger

Deploy the canister with your initialization arguments.

```sh
dfx deploy icrc1_ledger --network ic --argument-file icrc1_init.args
```

Get your new canister ID:

```sh
LEDGER_ID=$(dfx canister id icrc1_ledger --network ic)
echo "Ledger deployed at: $LEDGER_ID"
```

## 8. Verify Metadata & Balance

Check that your token was deployed correctly.

```sh
# Verify metadata
dfx canister call --network ic $LEDGER_ID icrc1_metadata '()'

# Verify balance
ME=$(dfx identity get-principal)
dfx canister call --network ic $LEDGER_ID icrc1_balance_of "(record { owner = principal \"$ME\" })"
```

## 9. Transfer Example

Here's how to transfer tokens to another principal:

```sh
RECIP="aaaaa-aa"   # recipient principal
dfx canister call --network ic $LEDGER_ID icrc1_transfer \
"(record { to = record { owner = principal \"$RECIP\" }; amount = 1000000:nat })"
```

---

## ✅ Summary

1.  Install & configure `dfx`.
2.  Create/use a mainnet identity.
3.  Download ICRC-1 ledger wasm + candid.
4.  Add ledger canister in `dfx.json`.
5.  Create `icrc1_init.args` with your token config.
6.  Create + fund canister with cycles.
7.  Deploy to ICP mainnet.
8.  Verify token metadata & balances.
9.  Use `icrc1_transfer` for transactions.
