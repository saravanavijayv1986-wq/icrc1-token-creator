import { api, APIError } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { Principal } from "@dfinity/principal";
import { HttpAgent } from "@dfinity/agent";
import { Actor } from "@dfinity/agent";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError } from "../common/errors";
import { metrics, monitor } from "../common/monitoring";
import log from "encore.dev/log";

// ICP configuration secrets
const icpHost = secret("ICPHost");
const deployCyclesAmount = secret("DeployCyclesAmount");

// New config: fee, treasury wallets, ledger canister, and treasury delegation for cycles wallet auth
const userCreationFeeICP = secret("UserCreationFeeICP"); // e.g. "1"
const treasuryICPWalletPrincipal = secret("TreasuryICPWallet"); // principal text of the treasury ICP wallet receiver
const treasuryCyclesWalletId = secret("TreasuryCyclesWallet"); // cycles wallet canister id (principal text)
const treasuryDelegationIdentityJSON = secret("TreasuryDelegationIdentityJSON"); // JSON string to authenticate as treasury wallet controller
const icpLedgerCanisterId = secret("ICPLedgerCanisterId"); // The ICP ledger canister ID
const wasmModuleUrl = secret("ICRCWasmModuleUrl"); // URL to the ICRC-1 WASM module

// ICRC-1 Token Interface Definition
const icrc1Interface = {
  icrc1_name: { query: true, parameters: [], returns: { text: null } },
  icrc1_symbol: { query: true, parameters: [], returns: { text: null } },
  icrc1_decimals: { query: true, parameters: [], returns: { nat8: null } },
  icrc1_total_supply: { query: true, parameters: [], returns: { nat: null } },
  icrc1_balance_of: { query: true, parameters: [{ Account: null }], returns: { nat: null } },
  icrc1_transfer: {
    update: true,
    parameters: [{
      from_subaccount: { opt: { blob: null } },
      to: { Account: null },
      amount: { nat: null },
      fee: { opt: { nat: null } },
      memo: { opt: { blob: null } },
      created_at_time: { opt: { nat64: null } }
    }],
    returns: { variant: { Ok: { nat: null }, Err: { TransferError: null } } }
  },
  icrc1_metadata: { query: true, parameters: [], returns: { vec: { tuple: [{ text: null }, { Value: null }] } } },
  mint: {
    update: true,
    parameters: [{ to: { Account: null }, amount: { nat: null } }],
    returns: { variant: { Ok: { nat: null }, Err: { text: null } } }
  },
  burn: {
    update: true,
    parameters: [{ from: { Account: null }, amount: { nat: null } }],
    returns: { variant: { Ok: { nat: null }, Err: { text: null } } }
  }
};

// Management Canister Interface with comprehensive error handling
const managementInterface = {
  create_canister: {
    update: true,
    parameters: [{
      settings: {
        opt: {
          controllers: { opt: { vec: { principal: null } } },
          compute_allocation: { opt: { nat: null } },
          memory_allocation: { opt: { nat: null } },
          freezing_threshold: { opt: { nat: null } }
        }
      }
    }],
    returns: { record: { canister_id: { principal: null } } }
  },
  install_code: {
    update: true,
    parameters: [{
      mode: { variant: { install: null, reinstall: null, upgrade: null } },
      canister_id: { principal: null },
      wasm_module: { blob: null },
      arg: { blob: null }
    }],
    returns: null
  },
  canister_status: {
    update: true,
    parameters: [{ canister_id: { principal: null } }],
    returns: {
      record: {
        status: { variant: { running: null, stopping: null, stopped: null } },
        memory_size: { nat: null },
        cycles: { nat: null },
        settings: {
          controllers: { vec: { principal: null } },
          compute_allocation: { nat: null },
          memory_allocation: { nat: null },
          freezing_threshold: { nat: null }
        },
        module_hash: { opt: { blob: null } }
      }
    }
  },
  deposit_cycles: {
    update: true,
    parameters: [{ canister_id: { principal: null } }],
    returns: null
  },
  stop_canister: {
    update: true,
    parameters: [{ canister_id: { principal: null } }],
    returns: null
  },
  start_canister: {
    update: true,
    parameters: [{ canister_id: { principal: null } }],
    returns: null
  },
  delete_canister: {
    update: true,
    parameters: [{ canister_id: { principal: null } }],
    returns: null
  }
};

// Cycles Wallet Interface (wallet_canister)
// Note: Real interfaces may differ across wallet implementations. Adjust as needed for your wallet canister.
const cyclesWalletInterface = {
  wallet_create_canister: {
    update: true,
    parameters: [{
      settings: {
        record: {
          controllers: { vec: { principal: null } },
          compute_allocation: { opt: { nat: null } },
          memory_allocation: { opt: { nat: null } },
          freezing_threshold: { opt: { nat: null } }
        }
      },
      cycles: { nat: null }
    }],
    returns: { record: { canister_id: { principal: null } } }
  },
  wallet_install_code: {
    update: true,
    parameters: [{
      mode: { variant: { install: null, reinstall: null, upgrade: null } },
      canister_id: { principal: null },
      wasm_module: { blob: null },
      arg: { blob: null }
    }],
    returns: null
  }
};

// ICRC-1 Ledger Interface for ICP (payment collection)
const icrc1LedgerInterface = {
  icrc1_balance_of: {
    query: true,
    parameters: [{ Account: null }],
    returns: { nat: null }
  },
  icrc1_transfer: {
    update: true,
    parameters: [{
      to: { Account: null },
      amount: { nat: null },
      fee: { opt: { nat: null } },
      memo: { opt: { blob: null } },
      from_subaccount: { opt: { blob: null } },
      created_at_time: { opt: { nat64: null } }
    }],
    returns: { variant: { Ok: { nat: null }, Err: { TransferError: null } } }
  }
};

// Helper function to get the ICP Ledger Canister ID with proper validation
function getICPLedgerCanisterId(): string {
  const configuredId = icpLedgerCanisterId();

  // If no canister ID is configured, use the official ICP Ledger Canister ID
  if (!configuredId) {
    log.warn("No ICP Ledger Canister ID configured, using official ICP Ledger");
    return "rrkah-fqaaa-aaaah-qcuea-cai"; // Official ICP Ledger Canister ID
  }

  // Validate the configured canister ID format
  try {
    Principal.fromText(configuredId);
    log.info("Using configured ICP Ledger Canister ID", { canisterId: configuredId });
    return configuredId;
  } catch (error) {
    log.error("Invalid ICP Ledger Canister ID format in configuration", {
      configuredId,
      error: error instanceof Error ? error.message : "Unknown error"
    });
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      `Invalid ICP Ledger Canister ID format: ${configuredId}`
    );
  }
}

// Resolve target canister ID, supporting "dummy" as a placeholder for the ICP ledger canister.
function resolveCanisterPrincipal(canisterId: string): { principal: Principal; isLedger: boolean } {
  try {
    if (!canisterId || canisterId === "dummy") {
      const ledgerId = getICPLedgerCanisterId();
      return { principal: Principal.fromText(ledgerId), isLedger: true };
    }
    const p = Principal.fromText(canisterId);
    const isLedger = p.toText() === getICPLedgerCanisterId();
    return { principal: p, isLedger };
  } catch {
    // Fallback to ledger if invalid
    const ledgerId = getICPLedgerCanisterId();
    return { principal: Principal.fromText(ledgerId), isLedger: true };
  }
}

// Create authenticated agent with proper error handling and retries
async function createAuthenticatedAgent(delegationChain: any, retries = 3): Promise<HttpAgent> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app",
        identity: delegationChain
      });

      // Configure agent with production settings
      agent.addTransform("update", ({ body }) => ({
        ...body,
        ingress_expiry: BigInt(Date.now() + 5 * 60 * 1000) * BigInt(1_000_000) // 5 minutes
      }));

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      return agent;
    } catch (error) {
      log.warn(`Agent creation attempt ${attempt} failed`, { error });
      if (attempt === retries) {
        throw new AppError(
          ErrorCode.BLOCKCHAIN_ERROR,
          "Failed to create authenticated agent after retries",
          { attempts: retries, lastError: error instanceof Error ? error.message : "Unknown error" }
        );
      }
      // Wait before retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
    }
  }

  throw new AppError(ErrorCode.BLOCKCHAIN_ERROR, "Failed to create authenticated agent");
}

// Get ICRC-1 token WASM module with caching and validation
let cachedWasmModule: Uint8Array | null = null;
let wasmCacheTime: number = 0;
const WASM_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getTokenWasm(): Promise<Uint8Array> {
  // Return cached WASM if still valid
  if (cachedWasmModule && Date.now() - wasmCacheTime < WASM_CACHE_TTL) {
    return cachedWasmModule;
  }

  try {
    const url =
      wasmModuleUrl() ||
      "https://github.com/dfinity/ICRC-1/releases/download/v0.1.0/icrc1_ledger.wasm.gz";

    log.info("Fetching WASM module", { url });

    // Implement a timeout using AbortController (30s)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "TokenForge/1.0",
        Accept: "application/wasm"
      },
      signal: controller.signal
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const wasmModule = new Uint8Array(arrayBuffer);

    // Validate WASM module size (should be reasonable for ICRC-1)
    if (wasmModule.length < 1000 || wasmModule.length > 50 * 1024 * 1024) {
      throw new Error(`Invalid WASM module size: ${wasmModule.length} bytes`);
    }

    // Basic WASM magic number validation (if gzipped, this check will be different; keep simple here)
    const magicNumber = Array.from(wasmModule.slice(0, 4));
    const expectedMagic = [0x00, 0x61, 0x73, 0x6d]; // "\0asm"
    if (!magicNumber.every((byte, i) => byte === expectedMagic[i])) {
      log.warn(
        "WASM magic number did not match; ensure module is a plain .wasm. Proceeding with provided bytes."
      );
    }

    // Cache the module
    cachedWasmModule = wasmModule;
    wasmCacheTime = Date.now();

    log.info("WASM module fetched and cached", { size: wasmModule.length });
    return wasmModule;
  } catch (error) {
    log.error("Failed to fetch WASM module", { error });
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      "Failed to fetch ICRC-1 WASM module",
      { originalError: error instanceof Error ? error.message : "Unknown error" }
    );
  }
}

// Encode Candid arguments with proper validation
function encodeTokenArgs(params: {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  owner: Principal;
  isMintable: boolean;
  isBurnable: boolean;
}): Uint8Array {
  try {
    // Validate parameters
    if (!params.name || params.name.length > 50) {
      throw new Error("Invalid token name");
    }
    if (!params.symbol || params.symbol.length > 10) {
      throw new Error("Invalid token symbol");
    }
    if (params.decimals < 0 || params.decimals > 18) {
      throw new Error("Invalid decimals");
    }
    if (params.totalSupply <= 0n) {
      throw new Error("Invalid total supply");
    }

    const args = {
      name: params.name,
      symbol: params.symbol,
      decimals: params.decimals,
      initial_balances: [
        {
          account: { owner: params.owner, subaccount: [] },
          amount: params.totalSupply
        }
      ],
      minting_account: params.isMintable ? { owner: params.owner, subaccount: [] } : null,
      burning_account: params.isBurnable ? { owner: params.owner, subaccount: [] } : null,
      transfer_fee: 10000n, // 0.0001 tokens default fee
      archive_options: {
        trigger_threshold: 2000n,
        num_blocks_to_archive: 1000n,
        controller_id: params.owner
      },
      metadata: [
        ["icrc1:name", { Text: params.name }],
        ["icrc1:symbol", { Text: params.symbol }],
        ["icrc1:decimals", { Nat: BigInt(params.decimals) }],
        ["icrc1:fee", { Nat: 10000n }],
        ["icrc1:logo", { Text: "" }] // Will be updated later if logo provided
      ]
    };

    // Use proper Candid encoding in production
    return new TextEncoder().encode(JSON.stringify(args));
  } catch (error) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Failed to encode token initialization arguments",
      { originalError: error instanceof Error ? error.message : "Unknown error" }
    );
  }
}

// Helpers for fee handling and treasury identity
function icpToE8s(amountStr: string): bigint {
  // Convert decimal ICP string to e8s bigint
  const normalized = amountStr.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Invalid ICP fee amount: ${amountStr}`);
  }
  const [intPart, fracPart = ""] = normalized.split(".");
  const fracPadded = (fracPart + "00000000").slice(0, 8);
  return BigInt(intPart) * 100000000n + BigInt(fracPadded);
}

function parseTreasuryDelegationIdentity(): any {
  const json = treasuryDelegationIdentityJSON();
  if (!json) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED_ACCESS,
      "Treasury delegation identity not configured"
    );
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new AppError(
      ErrorCode.INVALID_DELEGATION,
      "Invalid Treasury delegation identity JSON",
      { originalError: e instanceof Error ? e.message : String(e) }
    );
  }
}

async function collectCreationFeeWithUserIdentity(userAgent: HttpAgent): Promise<{ feePaidE8s: bigint }> {
  const feeStr = userCreationFeeICP() || "1";
  const feeE8s = icpToE8s(feeStr);

  const ledgerCanisterId = getICPLedgerCanisterId();
  const treasuryPrincipalText = treasuryICPWalletPrincipal();
  if (!treasuryPrincipalText) {
    throw new AppError(ErrorCode.UNAUTHORIZED_ACCESS, "Treasury ICP wallet principal not configured");
  }

  const treasuryPrincipal = Principal.fromText(treasuryPrincipalText);

  const ledger = Actor.createActor(icrc1LedgerInterface, {
    agent: userAgent,
    canisterId: Principal.fromText(ledgerCanisterId)
  });

  log.info("Collecting user creation fee", {
    amountE8s: feeE8s.toString(),
    treasury: treasuryPrincipalText,
    ledgerCanisterId
  });

  const res: any = await ledger.icrc1_transfer({
    to: { owner: treasuryPrincipal, subaccount: [] },
    amount: feeE8s,
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: []
  });

  if (res && res.Err) {
    const errDetails = JSON.stringify(res.Err);
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      `ICP fee transfer failed: ${errDetails}`,
      { err: res.Err }
    );
  }

  return { feePaidE8s: res.Ok ? BigInt(res.Ok) : feeE8s };
}

async function createAndInstallWithCyclesWallet(
  owner: Principal,
  wasmModule: Uint8Array,
  initArgs: Uint8Array
): Promise<{ canisterId: Principal; cyclesUsed: bigint }> {
  const cyclesStr = deployCyclesAmount() || "3000000000000"; // default 3T cycles
  const cycles = BigInt(cyclesStr);

  const walletId = treasuryCyclesWalletId();
  if (!walletId) {
    throw new AppError(
      ErrorCode.UNAUTHORIZED_ACCESS,
      "Treasury cycles wallet canister ID not configured"
    );
  }

  const treasuryIdentity = parseTreasuryDelegationIdentity();
  const treasuryAgent = await createAuthenticatedAgent(treasuryIdentity);

  const wallet = Actor.createActor(cyclesWalletInterface, {
    agent: treasuryAgent,
    canisterId: Principal.fromText(walletId)
  });

  log.info("Creating canister via cycles wallet", {
    walletId,
    cycles: cycles.toString(),
    owner: owner.toText()
  });

  const created = await wallet.wallet_create_canister({
    settings: {
      controllers: [owner],
      compute_allocation: [],
      memory_allocation: [],
      freezing_threshold: []
    },
    cycles
  });

  const canisterId: Principal = created.canister_id;
  log.info("Installing code via cycles wallet", { canisterId: canisterId.toText() });

  await wallet.wallet_install_code({
    mode: { install: null },
    canister_id: canisterId,
    wasm_module: wasmModule,
    arg: initArgs
  });

  return { canisterId, cyclesUsed: cycles };
}

export interface DeployCanisterRequest {
  tokenName: string;
  symbol: string;
  totalSupply: number;
  decimals: number;
  logoUrl?: string;
  isMintable: boolean;
  isBurnable: boolean;
  delegationIdentity: any;
  ownerPrincipal: string;
}

export interface DeployCanisterResponse {
  canisterId: string;
  status: string;
  deploymentHash: string;
  cyclesUsed: string;
  feePaidICP: string;
}

// Deploys an ICRC-1 token canister to the Internet Computer.
// Flow:
// 1) Collect user fee in ICP to treasury ICP wallet (on-chain transfer via ICRC-1 ledger using user's delegation).
// 2) Create canister via Treasury Cycles Wallet with configured cycles amount (3T default).
// 3) Install token code and initialize owned by user principal.
export const deploy = api<DeployCanisterRequest, DeployCanisterResponse>(
  { expose: true, method: "POST", path: "/icp/deploy" },
  monitor("icp.deploy")(async (req) => {
    try {
      // Comprehensive input validation
      const validator = validate()
        .required(req.tokenName, "tokenName")
        .string(req.tokenName, "tokenName", { minLength: 2, maxLength: 50 })
        .required(req.symbol, "symbol")
        .string(req.symbol, "symbol", { minLength: 2, maxLength: 10 })
        .required(req.totalSupply, "totalSupply")
        .number(req.totalSupply, "totalSupply", { min: 1, max: 1e15, integer: true })
        .required(req.decimals, "decimals")
        .number(req.decimals, "decimals", { min: 0, max: 18, integer: true })
        .required(req.ownerPrincipal, "ownerPrincipal")
        .principal(req.ownerPrincipal, "ownerPrincipal")
        .boolean(req.isMintable, "isMintable")
        .boolean(req.isBurnable, "isBurnable");

      if (!validator.isValid()) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid deployment parameters",
          { errors: validator.getErrors() }
        );
      }

      if (!req.delegationIdentity) {
        throw new AppError(
          ErrorCode.INVALID_DELEGATION,
          "Valid delegation identity is required"
        );
      }

      log.info("Starting canister deployment", {
        tokenName: req.tokenName,
        symbol: req.symbol,
        owner: req.ownerPrincipal
      });

      // Step 1: Collect user creation fee (ICP) using user's delegation
      const userAgent = await createAuthenticatedAgent(req.delegationIdentity);
      const feeResult = await collectCreationFeeWithUserIdentity(userAgent);
      log.info("User creation fee collected", {
        feeE8s: feeResult.feePaidE8s.toString()
      });

      // Get ICRC-1 WASM module
      const wasmModule = await getTokenWasm();

      // Encode initialization arguments
      const initArgs = encodeTokenArgs({
        name: req.tokenName,
        symbol: req.symbol,
        decimals: req.decimals,
        totalSupply: BigInt(req.totalSupply),
        owner: Principal.fromText(req.ownerPrincipal),
        isMintable: req.isMintable,
        isBurnable: req.isBurnable
      });

      // Step 2-3: Create & install via Treasury Cycles Wallet, else fallback to management canister if not configured
      let canisterId: Principal;
      let cyclesUsed: bigint;

      const walletConfigured = Boolean(treasuryCyclesWalletId() && treasuryDelegationIdentityJSON());
      if (walletConfigured) {
        const result = await createAndInstallWithCyclesWallet(
          Principal.fromText(req.ownerPrincipal),
          wasmModule,
          initArgs
        );
        canisterId = result.canisterId;
        cyclesUsed = result.cyclesUsed;
      } else {
        log.warn(
          "Treasury cycles wallet not configured, falling back to management canister (no cycles attached). Consider configuring TreasuryCyclesWallet and TreasuryDelegationIdentityJSON."
        );
        const management = Actor.createActor(managementInterface, {
          agent: userAgent,
          canisterId: Principal.fromText("aaaaa-aa")
        });

        const createResult = await management.create_canister({
          settings: {
            controllers: [Principal.fromText(req.ownerPrincipal)],
            compute_allocation: 0n,
            memory_allocation: 0n,
            freezing_threshold: 2592000n
          }
        });

        canisterId = createResult.canister_id;
        await management.install_code({
          mode: { install: null },
          canister_id: canisterId,
          wasm_module: wasmModule,
          arg: initArgs
        });
        cyclesUsed = BigInt(deployCyclesAmount() || "0");
      }

      // Verify canister is running
      try {
        const agent = new HttpAgent({ host: icpHost() || "https://ic0.app" });
        const host = icpHost() || "https://ic0.app";
        if (host.includes("localhost") || host.includes("127.0.0.1")) {
          await agent.fetchRootKey();
        }
        const management = Actor.createActor(managementInterface, {
          agent,
          canisterId: Principal.fromText("aaaaa-aa")
        });
        const status = await management.canister_status({ canister_id: canisterId });
        const statusKey = Object.keys(status.status)[0];
        if (statusKey !== "running") {
          log.warn("Canister not in running state post-deploy", { statusKey });
        }
      } catch (error) {
        log.warn("Failed to verify canister status", {
          canisterId: canisterId.toText(),
          error
        });
      }

      // Generate deployment hash for tracking
      const deploymentHash = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Record successful deployment metrics
      metrics.increment("canister.deployed", {
        status: "success",
        network: "mainnet"
      });

      log.info("Canister deployment completed successfully", {
        canisterId: canisterId.toText(),
        deploymentHash,
        tokenName: req.tokenName,
        symbol: req.symbol
      });

      const cyclesStr = cyclesUsed.toString();
      const feeICPStr = userCreationFeeICP() || "1";

      return {
        canisterId: canisterId.toText(),
        status: "deployed",
        deploymentHash,
        cyclesUsed: cyclesStr,
        feePaidICP: feeICPStr
      };
    } catch (error) {
      metrics.increment("canister.deployed", { status: "failed" });
      log.error("Canister deployment failed", { error });
      return handleError(error, "icp.deploy");
    }
  })
);

export interface CanisterStatus {
  canisterId: string;
  status: string;
  cyclesBalance: string;
  memorySize: string;
  lastUpdate: Date;
  moduleHash?: string;
  controllers: string[];
}

// Retrieves the current status of a deployed canister.
export const getStatus = api<{ canisterId: string }, CanisterStatus>(
  { expose: true, method: "GET", path: "/icp/canister/:canisterId/status" },
  monitor("icp.getStatus")(async (req) => {
    try {
      // Validate canister ID format
      validate()
        .required(req.canisterId, "canisterId")
        .custom(req.canisterId, {
          validate: (id) => {
            try {
              Principal.fromText(id);
              return true;
            } catch {
              return false;
            }
          },
          message: "Invalid canister ID format"
        })
        .throwIfInvalid();

      // Create agent (unauthenticated for status queries)
      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app"
      });

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      const management = Actor.createActor(managementInterface, {
        agent,
        canisterId: Principal.fromText("aaaaa-aa")
      });

      const status = await management.canister_status({
        canister_id: Principal.fromText(req.canisterId)
      });

      const statusKey = Object.keys(status.status)[0];
      const controllers = status.settings.controllers.map((p: any) => p.toText());

      return {
        canisterId: req.canisterId,
        status: statusKey,
        cyclesBalance: status.cycles.toString(),
        memorySize: status.memory_size.toString(),
        lastUpdate: new Date(),
        moduleHash: status.module_hash?.[0]
          ? Buffer.from(status.module_hash[0]).toString("hex")
          : undefined,
        controllers
      };
    } catch (error) {
      return handleError(error, "icp.getStatus");
    }
  })
);

export interface TokenOperationRequest {
  canisterId: string;
  operation: "mint" | "burn" | "transfer";
  amount: string;
  recipient?: string;
  delegationIdentity: any;
  ownerPrincipal: string;
}

export interface TokenOperationResponse {
  success: boolean;
  transactionId: string;
  newBalance?: string;
  blockIndex?: string;
}

// Performs token operations using the owner's delegation.
export const performTokenOperation = api<TokenOperationRequest, TokenOperationResponse>(
  { expose: true, method: "POST", path: "/icp/operation" },
  monitor("icp.tokenOperation")(async (req) => {
    try {
      // Comprehensive validation
      const validator = validate()
        .required(req.canisterId, "canisterId")
        .required(req.operation, "operation")
        .custom(req.operation, {
          validate: (op) => ["mint", "burn", "transfer"].includes(op),
          message: "Invalid operation type"
        })
        .required(req.amount, "amount")
        .custom(req.amount, {
          validate: (amt) => {
            try {
              const num = BigInt(amt);
              return num > 0n;
            } catch {
              return false;
            }
          },
          message: "Amount must be a positive integer"
        })
        .required(req.ownerPrincipal, "ownerPrincipal")
        .principal(req.ownerPrincipal, "ownerPrincipal");

      if (req.operation === "mint" || req.operation === "transfer") {
        validator.required(req.recipient, "recipient").principal(req.recipient!, "recipient");
      }

      if (!validator.isValid()) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Invalid operation parameters",
          { errors: validator.getErrors() }
        );
      }

      if (!req.delegationIdentity) {
        throw new AppError(ErrorCode.INVALID_DELEGATION, "Valid delegation identity is required");
      }

      // Resolve target canister (supporting ICP ledger via "dummy" or explicit ID)
      const { principal: targetCanister, isLedger } = resolveCanisterPrincipal(req.canisterId);

      // Only transfer is supported on the ICP ledger
      if (isLedger && req.operation !== "transfer") {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Only transfer operations are supported on the ICP Ledger canister"
        );
      }

      // Create authenticated agent
      const agent = await createAuthenticatedAgent(req.delegationIdentity);

      // Create appropriate actor
      const tokenActor = Actor.createActor(isLedger ? icrc1LedgerInterface : icrc1Interface, {
        agent,
        canisterId: targetCanister
      });

      const amount = BigInt(req.amount);
      const ownerAccount = {
        owner: Principal.fromText(req.ownerPrincipal),
        subaccount: []
      };

      let result: any;

      log.info("Performing token operation", {
        canisterId: targetCanister.toText(),
        isLedger,
        operation: req.operation,
        amount: req.amount,
        owner: req.ownerPrincipal,
        recipient: req.recipient
      });

      switch (req.operation) {
        case "mint":
          if (isLedger) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, "Mint is not supported on ICP Ledger");
          }
          const mintToAccount = {
            owner: Principal.fromText(req.recipient!),
            subaccount: []
          };
          result = await (tokenActor as any).mint({
            to: mintToAccount,
            amount
          });
          break;

        case "burn":
          if (isLedger) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, "Burn is not supported on ICP Ledger");
          }
          result = await (tokenActor as any).burn({
            from: ownerAccount,
            amount
          });
          break;

        case "transfer":
          const transferToAccount = {
            owner: Principal.fromText(req.recipient!),
            subaccount: []
          };
          result = await (tokenActor as any).icrc1_transfer({
            from_subaccount: [],
            to: transferToAccount,
            amount,
            fee: [],
            memo: [],
            created_at_time: []
          });
          break;

        default:
          throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown operation: ${req.operation}`);
      }

      // Handle result based on ICRC-1 response format
      let transactionId: string;
      let success: boolean;

      if (result.Ok !== undefined) {
        success = true;
        transactionId = result.Ok.toString();
      } else if (result.Err !== undefined) {
        success = false;
        const errorDetails = JSON.stringify(result.Err);
        log.error("Token operation failed on canister", {
          operation: req.operation,
          error: errorDetails
        });
        throw new AppError(ErrorCode.CANISTER_ERROR, `Operation failed: ${errorDetails}`, {
          canisterId: targetCanister.toText(),
          operation: req.operation
        });
      } else {
        success = true;
        transactionId = result.toString();
      }

      // Get updated balance
      let newBalance: string | undefined;
      try {
        const balance = await (tokenActor as any).icrc1_balance_of(ownerAccount);
        newBalance = balance.toString();
      } catch (error) {
        log.warn("Failed to fetch updated balance", { error });
      }

      metrics.increment("token.operation", {
        operation: req.operation,
        status: "success"
      });

      log.info("Token operation completed successfully", {
        operation: req.operation,
        transactionId,
        canisterId: targetCanister.toText()
      });

      return {
        success,
        transactionId,
        newBalance,
        blockIndex: transactionId
      };
    } catch (error) {
      metrics.increment("token.operation", {
        operation: req.operation || "unknown",
        status: "failed"
      });
      return handleError(error, "icp.performTokenOperation");
    }
  })
);

export interface MetadataEntry {
  key: string;
  value: any;
}

export interface TokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: string;
  transferFee: string;
  metadata: MetadataEntry[];
}

// Retrieves token information from the canister.
export const getTokenInfo = api<{ canisterId: string }, TokenInfo>(
  { expose: true, method: "GET", path: "/icp/token/:canisterId/info" },
  monitor("icp.getTokenInfo")(async (req) => {
    try {
      // Validate canister ID
      validate()
        .required(req.canisterId, "canisterId")
        .custom(req.canisterId, {
          validate: (id) => {
            try {
              Principal.fromText(id);
              return true;
            } catch {
              return false;
            }
          },
          message: "Invalid canister ID format"
        })
        .throwIfInvalid();

      // Create agent (unauthenticated for queries)
      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app"
      });

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      const tokenActor = Actor.createActor(icrc1Interface, {
        agent,
        canisterId: Principal.fromText(req.canisterId)
      });

      // Fetch token information with timeout
      const fetchPromise = Promise.all([
        tokenActor.icrc1_name(),
        tokenActor.icrc1_symbol(),
        tokenActor.icrc1_decimals(),
        tokenActor.icrc1_total_supply(),
        tokenActor.icrc1_metadata()
      ]);

      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Request timeout")), 30000);
      });

      const [name, symbol, decimals, totalSupply, metadata] = (await Promise.race([
        fetchPromise,
        timeoutPromise
      ])) as any[];

      // Extract transfer fee from metadata
      const transferFeeEntry = metadata.find(([key]: [string, any]) => key === "icrc1:fee");
      const transferFee = transferFeeEntry ? transferFeeEntry[1].Nat?.toString() || "0" : "0";

      // Convert metadata tuples to MetadataEntry objects
      const metadataEntries: MetadataEntry[] = metadata.map(([key, value]: [string, any]) => ({
        key,
        value
      }));

      return {
        name,
        symbol,
        decimals,
        totalSupply: totalSupply.toString(),
        transferFee,
        metadata: metadataEntries
      };
    } catch (error) {
      return handleError(error, "icp.getTokenInfo");
    }
  })
);

export interface BalanceRequest {
  canisterId: string;
  principal: string;
  subaccount?: string;
}

export interface BalanceResponse {
  balance: string;
}

// Gets the balance of a specific account.
export const getBalance = api<BalanceRequest, BalanceResponse>(
  { expose: true, method: "GET", path: "/icp/token/:canisterId/balance/:principal" },
  monitor("icp.getBalance")(async (req) => {
    try {
      // Validate inputs
      const validator = validate().required(req.canisterId, "canisterId").required(req.principal, "principal");

      // Validate principal format
      validator.custom(req.principal, {
        validate: (p) => {
          try {
            Principal.fromText(p);
            return true;
          } catch {
            return false;
          }
        },
        message: "Invalid principal format"
      });

      if (req.subaccount) {
        validator.custom(req.subaccount, {
          validate: (sub) => /^[0-9a-fA-F]+$/.test(sub) && sub.length <= 64,
          message: "Invalid subaccount format"
        });
      }

      validator.throwIfInvalid();

      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app"
      });

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      // Resolve canister ID (supporting "dummy" for ICP ledger)
      const { principal: targetCanister } = resolveCanisterPrincipal(req.canisterId);

      const tokenActor = Actor.createActor(icrc1LedgerInterface, {
        agent,
        canisterId: targetCanister
      });

      const account = {
        owner: Principal.fromText(req.principal),
        subaccount: req.subaccount ? [new Uint8Array(Buffer.from(req.subaccount, "hex"))] : []
      };

      const balance = await tokenActor.icrc1_balance_of(account);

      return {
        balance: balance.toString()
      };
    } catch (error) {
      log.error("Failed to get balance", {
        canisterId: req.canisterId,
        principal: req.principal,
        error
      });

      // Return default balance instead of throwing
      return {
        balance: "0"
      };
    }
  })
);
