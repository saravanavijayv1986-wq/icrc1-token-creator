import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { Principal } from "@dfinity/principal";
import { HttpAgent, Actor, type ActorSubclass } from "@dfinity/agent";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError } from "../common/errors";
import { metrics, monitor } from "../common/monitoring";
import { storage as icpStorage } from "./storage";
import log from "encore.dev/log";
import crypto from "node:crypto";
import { IDL } from "@dfinity/candid";
import {
  icrc1IdlFactory,
  icrc1LedgerIdlFactory,
  cyclesWalletIdlFactory,
  managementIdlFactory,
  encodeIcrc1InitArgs,
} from "./idl";
import {
  DelegationIdentity,
  DelegationChain,
  Ed25519KeyIdentity,
  AnonymousIdentity,
  type SignIdentity,
} from "@dfinity/identity";

// ICP configuration secrets
const icpHost = secret("ICPHost");
const deployCyclesAmount = secret("DeployCyclesAmount");

// New config: fee, treasury wallets, ledger canister, and treasury delegation for cycles wallet auth
const userCreationFeeICP = secret("UserCreationFeeICP"); // e.g. "1"
const treasuryICPWalletPrincipal = secret("TreasuryICPWallet"); // principal text of the treasury ICP wallet receiver
const treasuryCyclesWalletId = secret("TreasuryCyclesWallet"); // cycles wallet canister id (principal text)
const treasuryDelegationIdentityJSON = secret("TreasuryDelegationIdentityJSON"); // JSON string to authenticate as treasury wallet controller
const icpLedgerCanisterId = secret("ICPLedgerCanisterId"); // The ICP ledger canister ID (override)
const wasmModuleUrl = secret("ICRCWasmModuleUrl"); // URL to the ICRC-1 WASM module
const wasmModuleSha256 = secret("ICRCWasmSHA256"); // Optional checksum to verify integrity (hex)

// Validate default ICP Ledger Canister ID at boot
const DEFAULT_ICP_LEDGER_CANISTER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";
try {
  Principal.fromText(DEFAULT_ICP_LEDGER_CANISTER_ID);
  log.info("Default ICP Ledger Canister ID validated");
} catch (e) {
  log.error("Default ICP Ledger Canister ID invalid, this should never happen", { error: e instanceof Error ? e.message : String(e) });
}

// Helper function to get the ICP Ledger Canister ID with proper validation
function getICPLedgerCanisterId(): string {
  const configuredId = icpLedgerCanisterId();

  // If no canister ID is configured, use the official ICP Ledger Canister ID
  if (!configuredId) {
    return DEFAULT_ICP_LEDGER_CANISTER_ID;
  }

  // Validate the configured canister ID format
  try {
    Principal.fromText(configuredId);
    return configuredId;
  } catch (error) {
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

// Try to reconstruct a SignIdentity from provided JSON.
// Supports DelegationIdentity JSON (chain + inner key) and Ed25519KeyIdentity JSON.
// Never logs sensitive data.
function toSignIdentity(identityData: unknown): SignIdentity {
  try {
    const data: any = typeof identityData === "string" ? JSON.parse(identityData) : identityData;

    // 1) DelegationIdentity-like JSON
    if (data && (data.type === "DelegationIdentity" || data.delegation || data.delegations)) {
      const chainJson = data.delegation ?? data.delegations;
      const chain = DelegationChain.fromJSON(chainJson);

      // Attempt to reconstruct inner identity from common fields
      let inner: SignIdentity | null = null;

      // a) Nested identity JSON (most robust)
      if (data.identity) {
        try {
          inner = Ed25519KeyIdentity.fromJSON(data.identity);
        } catch {
          // fallthrough
        }
      }

      // b) Ed25519KeyIdentity-style JSON on root
      if (!inner) {
        try {
          inner = Ed25519KeyIdentity.fromJSON(data);
        } catch {
          // fallthrough
        }
      }

      // c) Hex/base64 private key
      if (!inner) {
        const priv = data.privateKey ?? data.secretKey ?? data.sk ?? null;
        if (typeof priv === "string") {
          const isHex = /^[0-9a-fA-F]+$/.test(priv.replace(/^0x/, ""));
          const buf = isHex ? Buffer.from(priv.replace(/^0x/, ""), "hex") : Buffer.from(priv, "base64");
          inner = Ed25519KeyIdentity.fromSecretKey(new Uint8Array(buf));
        }
      }

      if (!inner) {
        throw new Error("Missing inner identity in delegation chain");
      }

      return DelegationIdentity.fromDelegation(inner, chain);
    }

    // 2) Plain Ed25519 identity JSON
    try {
      return Ed25519KeyIdentity.fromJSON(data);
    } catch {
      // fallthrough
    }

    // 3) Hex/base64 private key shortcut
    if (data && typeof (data as any).secretKey === "string") {
      const priv = (data as any).secretKey as string;
      const isHex = /^[0-9a-fA-F]+$/.test(priv.replace(/^0x/, ""));
      const buf = isHex ? Buffer.from(priv.replace(/^0x/, ""), "hex") : Buffer.from(priv, "base64");
      return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(buf));
    }

    // 4) Allow explicit anonymous identity for testing
    if (data === "anonymous") {
      return new AnonymousIdentity();
    }

    throw new Error("Unsupported identity JSON format");
  } catch (e) {
    throw new AppError(
      ErrorCode.INVALID_DELEGATION,
      "Invalid or unsupported delegation identity",
      { reason: e instanceof Error ? e.message : String(e) }
    );
  }
}

// Retry helper with exponential backoff
async function withBackoff<T>(fn: () => Promise<T>, retries = 3, baseDelayMs = 500): Promise<T> {
  let error: any;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      error = e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw error;
}

// Create authenticated agent with proper error handling and retries
async function createAuthenticatedAgent(identityInput: any, retries = 3): Promise<HttpAgent> {
  return await withBackoff(async () => {
    const identity = toSignIdentity(identityInput);
    const agent = new HttpAgent({
      host: icpHost() || "https://ic0.app",
      identity,
    });

    // Configure agent with production settings
    agent.addTransform("update", ({ body }) => ({
      ...body,
      ingress_expiry: BigInt(Date.now() + 5 * 60 * 1000) * BigInt(1_000_000), // 5 minutes
    }));

    const host = icpHost() || "https://ic0.app";
    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      await agent.fetchRootKey();
    }

    return agent;
  }, retries, 500);
}

// Get ICRC-1 token WASM module using Object Storage for persistence and auditability
async function getTokenWasm(): Promise<Uint8Array> {
  const objName = "wasm/icrc1_ledger.wasm";
  const expectedSha = (wasmModuleSha256() || "").trim().toLowerCase().replace(/^0x/, "");
  try {
    // If present in object storage, download and return
    const exists = await icpStorage.exists(objName);
    if (exists) {
      const buf = await icpStorage.download(objName);
      if (expectedSha && !matchesSha256(buf, expectedSha)) {
        // Ignore cached if checksum mismatch
        log.warn("Cached WASM checksum mismatch, refetching", { objName });
      } else {
        log.info("Loaded WASM module from object storage", { name: objName, size: buf.length });
        return new Uint8Array(buf);
      }
    }

    const url =
      wasmModuleUrl() ||
      "https://github.com/dfinity/ICRC-1/releases/download/v0.1.0/icrc1_ledger.wasm";

    log.info("Fetching WASM module", { url });

    // Retry download with backoff and timeout
    const wasmArrayBuffer = await withBackoff(async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "TokenForge/1.0",
            Accept: "application/wasm",
          },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return await response.arrayBuffer();
      } finally {
        clearTimeout(timeout);
      }
    }, 3, 1000);

    const wasmModule = new Uint8Array(wasmArrayBuffer);

    // Validate WASM module size bounds
    if (wasmModule.length < 1000 || wasmModule.length > 50 * 1024 * 1024) {
      throw new Error(`Invalid WASM module size: ${wasmModule.length} bytes`);
    }

    // Verify checksum if provided
    if (expectedSha && !matchesSha256(Buffer.from(wasmModule), expectedSha)) {
      throw new Error("WASM checksum mismatch");
    }

    // Upload to object storage for future use
    await icpStorage
      .upload(objName, Buffer.from(wasmModule), {
        contentType: "application/wasm",
        preconditions: { notExists: true },
      })
      .catch(() => {
        // Ignore conflict if already uploaded concurrently
      });

    log.info("WASM module fetched and stored", { name: objName, size: wasmModule.length });
    return wasmModule;
  } catch (error) {
    log.error("Failed to fetch or load WASM module", { error: error instanceof Error ? error.message : "Unknown error" });
    throw new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, "Failed to fetch ICRC-1 WASM module", {});
  }
}

function matchesSha256(buf: Buffer, expectedHex: string): boolean {
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  return actual === expectedHex;
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

function parseTreasuryDelegationIdentity(): SignIdentity {
  const json = treasuryDelegationIdentityJSON();
  if (!json) {
    throw new AppError(ErrorCode.UNAUTHORIZED_ACCESS, "Treasury delegation identity not configured");
  }
  try {
    return toSignIdentity(JSON.parse(json));
  } catch (e) {
    throw new AppError(
      ErrorCode.INVALID_DELEGATION,
      "Invalid Treasury delegation identity JSON",
      { reason: e instanceof Error ? e.message : String(e) }
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

  const ledger = Actor.createActor(icrc1LedgerIdlFactory, {
    agent: userAgent,
    canisterId: Principal.fromText(ledgerCanisterId),
  }) as ActorSubclass<any>;

  log.info("Collecting user creation fee", {
    amountE8s: feeE8s.toString(),
    treasury: "[REDACTED]",
  });

  const res: any = await ledger.icrc1_transfer({
    to: { owner: treasuryPrincipal, subaccount: [] },
    amount: feeE8s,
    fee: [],
    memo: [],
    from_subaccount: [],
    created_at_time: [],
  });

  if (res && res.Err) {
    const errDetails = JSON.stringify(res.Err);
    throw new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, `ICP fee transfer failed: ${errDetails}`, {});
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
    throw new AppError(ErrorCode.UNAUTHORIZED_ACCESS, "Treasury cycles wallet canister ID not configured");
  }

  const treasuryIdentity = parseTreasuryDelegationIdentity();
  const treasuryAgent = await createAuthenticatedAgent(treasuryIdentity);

  const wallet = Actor.createActor(cyclesWalletIdlFactory, {
    agent: treasuryAgent,
    canisterId: Principal.fromText(walletId),
  }) as ActorSubclass<any>;

  log.info("Creating canister via cycles wallet", {
    walletId,
    cycles: cycles.toString(),
    owner: owner.toText(),
  });

  const created = await wallet.wallet_create_canister({
    settings: {
      controllers: [owner],
      compute_allocation: [],
      memory_allocation: [],
      freezing_threshold: [],
    },
    cycles,
  });

  const canisterId: Principal = created.canister_id;
  log.info("Installing code via cycles wallet", { canisterId: canisterId.toText() });

  await wallet.wallet_install_code({
    mode: { install: null },
    canister_id: canisterId,
    wasm_module: wasmModule,
    arg: initArgs,
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
// 1) Collect user fee in ICP to treasury ICP wallet.
// 2) Create canister via Treasury Cycles Wallet.
// 3) Install token code and initialize owned by user principal.
export const deploy = api<DeployCanisterRequest, DeployCanisterResponse>(
  { expose: true, method: "POST", path: "/icp/deploy" },
  monitor("icp.deploy", async (req) => {
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
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid deployment parameters", {
          errors: validator.getErrors(),
        });
      }

      if (!req.delegationIdentity) {
        throw new AppError(ErrorCode.INVALID_DELEGATION, "Valid delegation identity is required");
      }

      // Step 1: Collect user creation fee (ICP) using user's delegation
      const userAgent = await createAuthenticatedAgent(req.delegationIdentity);
      const feeResult = await collectCreationFeeWithUserIdentity(userAgent);

      // Get ICRC-1 WASM module (persisted in object storage)
      const wasmModule = await getTokenWasm();

      // Encode initialization arguments via candid
      const initArgs = encodeIcrc1InitArgs({
        name: req.tokenName,
        symbol: req.symbol,
        decimals: req.decimals,
        totalSupply: BigInt(req.totalSupply),
        owner: req.ownerPrincipal,
        isMintable: req.isMintable,
        isBurnable: req.isBurnable,
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
        // Fallback path (no cycles attached) — not recommended for production
        const management = Actor.createActor(managementIdlFactory, {
          agent: userAgent,
          canisterId: Principal.fromText("aaaaa-aa"),
        }) as ActorSubclass<any>;

        const createResult = await management.create_canister({
          settings: {
            controllers: [Principal.fromText(req.ownerPrincipal)],
            compute_allocation: [],
            memory_allocation: [],
            freezing_threshold: [],
          },
        });

        canisterId = createResult.canister_id;
        await management.install_code({
          mode: { install: null },
          canister_id: canisterId,
          wasm_module: wasmModule,
          arg: initArgs,
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
        const management = Actor.createActor(managementIdlFactory, {
          agent,
          canisterId: Principal.fromText("aaaaa-aa"),
        }) as ActorSubclass<any>;
        const status = await management.canister_status({ canister_id: canisterId });
        const statusKey = Object.keys(status.status)[0];
        if (statusKey !== "running") {
          log.warn("Canister not in running state post-deploy", { statusKey });
        }
      } catch (error) {
        log.warn("Failed to verify canister status", {
          canisterId: canisterId.toText(),
          error: error instanceof Error ? error.message : "Unknown",
        });
      }

      // Generate deployment hash for tracking
      const deploymentHash = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Record successful deployment metrics
      metrics.increment("canister.deployed");

      const cyclesStr = cyclesUsed.toString();
      const feeICPStr = userCreationFeeICP() || "1";

      return {
        canisterId: canisterId.toText(),
        status: "deployed",
        deploymentHash,
        cyclesUsed: cyclesStr,
        feePaidICP: feeICPStr,
      };
    } catch (error) {
      metrics.increment("canister.deploy_failed");
      return handleError(error as Error, "icp.deploy");
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
  monitor("icp.getStatus", async (req) => {
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
          message: "Invalid canister ID format",
        })
        .throwIfInvalid();

      // Create agent (unauthenticated for status queries)
      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app",
      });

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      const management = Actor.createActor(managementIdlFactory, {
        agent,
        canisterId: Principal.fromText("aaaaa-aa"),
      }) as ActorSubclass<any>;

      const status = await withBackoff(
        () => management.canister_status({ canister_id: Principal.fromText(req.canisterId) }),
        3,
        500
      );

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
        controllers,
      };
    } catch (error) {
      return handleError(error as Error, "icp.getStatus");
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
  monitor("icp.tokenOperation", async (req) => {
    try {
      // Comprehensive validation
      const validator = validate()
        .required(req.canisterId, "canisterId")
        .required(req.operation, "operation")
        .custom(req.operation, {
          validate: (op) => ["mint", "burn", "transfer"].includes(op),
          message: "Invalid operation type",
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
          message: "Amount must be a positive integer",
        })
        .required(req.ownerPrincipal, "ownerPrincipal")
        .principal(req.ownerPrincipal, "ownerPrincipal");

      if (req.operation === "mint" || req.operation === "transfer") {
        validator.required(req.recipient, "recipient").principal(req.recipient!, "recipient");
      }

      if (!validator.isValid()) {
        throw new AppError(ErrorCode.VALIDATION_ERROR, "Invalid operation parameters", {
          errors: validator.getErrors(),
        });
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

      // Create appropriate actor using proper IDL factories
      const tokenActor = Actor.createActor(isLedger ? icrc1LedgerIdlFactory : icrc1IdlFactory, {
        agent,
        canisterId: targetCanister,
      }) as ActorSubclass<any>;

      // Validate methods are available on the WASM (runtime safety)
      if (!isLedger) {
        const required = new Set(["icrc1_transfer", "icrc1_balance_of"]);
        if (req.operation === "mint") required.add("mint");
        if (req.operation === "burn") required.add("burn");
        for (const m of required) {
          if (typeof (tokenActor as any)[m] !== "function") {
            throw new AppError(ErrorCode.CANISTER_ERROR, `Canister does not expose required method: ${m}`);
          }
        }
      }

      const amount = BigInt(req.amount);
      const ownerAccount = {
        owner: Principal.fromText(req.ownerPrincipal),
        subaccount: [],
      };

      let result: any;

      switch (req.operation) {
        case "mint":
          if (isLedger) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, "Mint is not supported on ICP Ledger");
          }
          const mintToAccount = {
            owner: Principal.fromText(req.recipient!),
            subaccount: [],
          };
          result = await (tokenActor as any).mint({
            to: mintToAccount,
            amount,
          });
          break;

        case "burn":
          if (isLedger) {
            throw new AppError(ErrorCode.VALIDATION_ERROR, "Burn is not supported on ICP Ledger");
          }
          result = await (tokenActor as any).burn({
            from: ownerAccount,
            amount,
          });
          break;

        case "transfer":
          const transferToAccount = {
            owner: Principal.fromText(req.recipient!),
            subaccount: [],
          };
          result = await (tokenActor as any).icrc1_transfer({
            from_subaccount: [],
            to: transferToAccount,
            amount,
            fee: [],
            memo: [],
            created_at_time: [],
          });
          break;

        default:
          throw new AppError(ErrorCode.VALIDATION_ERROR, `Unknown operation: ${req.operation}`);
      }

      // Handle result based on ICRC-1 response format
      let transactionId: string;
      let success: boolean;

      if (result && result.Ok !== undefined) {
        success = true;
        transactionId = result.Ok.toString();
      } else if (result && result.Err !== undefined) {
        success = false;
        const errorDetails = JSON.stringify(result.Err);
        throw new AppError(ErrorCode.CANISTER_ERROR, `Operation failed: ${errorDetails}`, {});
      } else {
        success = true;
        transactionId = String(result ?? "");
      }

      // Get updated balance
      let newBalance: string | undefined;
      try {
        const balance = await (tokenActor as any).icrc1_balance_of(ownerAccount);
        newBalance = balance.toString();
      } catch (error) {
        log.warn("Failed to fetch updated balance", { error: error instanceof Error ? error.message : "Unknown" });
      }

      metrics.increment("token.operation_success");

      return {
        success,
        transactionId,
        newBalance,
        blockIndex: transactionId,
      };
    } catch (error) {
      metrics.increment("token.operation_failed");
      return handleError(error as Error, "icp.performTokenOperation");
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
  monitor("icp.getTokenInfo", async (req) => {
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
          message: "Invalid canister ID format",
        })
        .throwIfInvalid();

      // Create agent (unauthenticated for queries)
      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app",
      });

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      const tokenActor = Actor.createActor(icrc1IdlFactory, {
        agent,
        canisterId: Principal.fromText(req.canisterId),
      }) as ActorSubclass<any>;

      // Fetch token information with timeout and retry
      const fetchPromise = async () => {
        return Promise.all([
          tokenActor.icrc1_name(),
          tokenActor.icrc1_symbol(),
          tokenActor.icrc1_decimals(),
          tokenActor.icrc1_total_supply(),
          tokenActor.icrc1_metadata(),
        ]);
      };

      const withTimeout = <T>(p: Promise<T>, ms: number) =>
        new Promise<T>((resolve, reject) => {
          const to = setTimeout(() => reject(new Error("Request timeout")), ms);
          p.then(
            (v) => {
              clearTimeout(to);
              resolve(v);
            },
            (e) => {
              clearTimeout(to);
              reject(e);
            }
          );
        });

      const [name, symbol, decimals, totalSupply, metadata] = (await withBackoff(
        () => withTimeout(fetchPromise(), 30000),
        3,
        500
      )) as any[];

      // Extract transfer fee from metadata
      const transferFeeEntry = metadata.find(([key]: [string, any]) => key === "icrc1:fee");
      const transferFee = transferFeeEntry ? transferFeeEntry[1].Nat?.toString?.() || "0" : "0";

      // Convert metadata tuples to MetadataEntry objects
      const metadataEntries: MetadataEntry[] = metadata.map(([key, value]: [string, any]) => ({
        key,
        value,
      }));

      return {
        name,
        symbol,
        decimals,
        totalSupply: totalSupply.toString(),
        transferFee,
        metadata: metadataEntries,
      };
    } catch (error) {
      return handleError(error as Error, "icp.getTokenInfo");
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
  monitor("icp.getBalance", async (req) => {
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
        message: "Invalid principal format",
      });

      if (req.subaccount) {
        validator.custom(req.subaccount, {
          validate: (sub) => /^[0-9a-fA-F]+$/.test(sub) && sub.length <= 64,
          message: "Invalid subaccount format",
        });
      }

      validator.throwIfInvalid();

      const agent = new HttpAgent({
        host: icpHost() || "https://ic0.app",
      });

      const host = icpHost() || "https://ic0.app";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }

      // Resolve canister ID (supporting "dummy" for ICP ledger)
      const { principal: targetCanister } = resolveCanisterPrincipal(req.canisterId);

      const tokenActor = Actor.createActor(icrc1LedgerIdlFactory, {
        agent,
        canisterId: targetCanister,
      }) as ActorSubclass<any>;

      const account = {
        owner: Principal.fromText(req.principal),
        subaccount: req.subaccount ? [new Uint8Array(Buffer.from(req.subaccount, "hex"))] : [],
      };

      const balance = await withBackoff(() => tokenActor.icrc1_balance_of(account), 3, 500);

      return {
        balance: balance.toString(),
      };
    } catch (error) {
      log.error("Failed to get balance", {
        canisterId: req.canisterId,
        principal: req.principal,
        error: error instanceof Error ? error.message : "Unknown",
      });

      // Return default balance instead of throwing
      return {
        balance: "0",
      };
    }
  })
);
