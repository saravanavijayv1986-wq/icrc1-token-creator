import { api } from "encore.dev/api";
import { secret } from "encore.dev/config";
import { Principal } from "@dfinity/principal";
import { HttpAgent, Actor, type ActorSubclass, AnonymousIdentity } from "@dfinity/agent";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError, createAppError } from "../common/errors";
import { metrics, monitor } from "../common/monitoring";
import { storage as icpStorage } from "./storage";
import { logger, OperationType, withOperationLogging } from "../common/logger";
import { addBreadcrumb, setTag } from "../common/sentry";
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
  type SignIdentity,
} from "@dfinity/identity";

const icpHost = secret("ICPHost");
const deployCyclesAmount = secret("DeployCyclesAmount");
const userCreationFeeICP = secret("UserCreationFeeICP");
const treasuryICPWalletPrincipal = secret("TreasuryICPWallet");
const treasuryCyclesWalletId = secret("TreasuryCyclesWallet");
const treasuryDelegationIdentityJSON = secret("TreasuryDelegationIdentityJSON");
const icpLedgerCanisterId = secret("ICPLedgerCanisterId");
const wasmModuleUrl = secret("ICRCWasmModuleUrl");
const wasmModuleSha256 = secret("ICRCWasmSHA256");
const skipUserFeeDuringDev = secret("SkipUserFeeDuringDev");

const DEFAULT_ICP_LEDGER_CANISTER_ID = "ryjl3-tyaaa-aaaaa-aaaba-cai";

function getICPLedgerCanisterId(): string {
  const configuredId = icpLedgerCanisterId();

  if (!configuredId) {
    return DEFAULT_ICP_LEDGER_CANISTER_ID;
  }

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
    const ledgerId = getICPLedgerCanisterId();
    return { principal: Principal.fromText(ledgerId), isLedger: true };
  }
}

export function toSignIdentity(identityData: unknown): SignIdentity {
  try {
    if (typeof identityData === "string") {
      const s = identityData.trim();

      try {
        const parsed = JSON.parse(s);
        return toSignIdentity(parsed);
      } catch {
        // Not JSON
      }

      if (s.toLowerCase() === "anonymous") {
        return new AnonymousIdentity();
      }

      const cleaned = s.replace(/^0x/, "");
      const isHex = /^[0-9a-fA-F]+$/.test(cleaned);
      const isB64 = /^[A-Za-z0-9+/=]+$/.test(s) && s.length % 4 === 0;
      if (isHex || isB64) {
        const buf = isHex ? Buffer.from(cleaned, "hex") : Buffer.from(s, "base64");
        if (buf.length === 32 || buf.length === 64) {
          return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(buf));
        }
      }

      throw new AppError(ErrorCode.INVALID_DELEGATION, "Unsupported identity string format");
    }

    const data: any = identityData;

    try {
      return Ed25519KeyIdentity.fromJSON(data);
    } catch {
      // fallthrough
    }

    const keyStr: string | undefined = data?.secretKey ?? data?.privateKey ?? data?.sk;
    if (keyStr && typeof keyStr === "string") {
      const cleaned = keyStr.replace(/^0x/, "");
      const isHex = /^[0-9a-fA-F]+$/.test(cleaned);
      const buf = isHex ? Buffer.from(cleaned, "hex") : Buffer.from(keyStr, "base64");
      return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(buf));
    }

    if (data && (data.delegations || data.delegation || data.publicKey)) {
      let chainObj: any = null;
      if (data.delegations && data.publicKey) {
        chainObj = { delegations: data.delegations, publicKey: data.publicKey };
      } else if (data.delegation && data.publicKey) {
        chainObj = { delegations: data.delegation, publicKey: data.publicKey };
      } else {
        chainObj = data;
      }

      let chain: DelegationChain;
      try {
        chain = DelegationChain.fromJSON(chainObj);
      } catch (error) {
        throw new AppError(
          ErrorCode.INVALID_DELEGATION,
          "Failed to reconstruct delegation chain",
          { reason: error instanceof Error ? error.message : String(error) }
        );
      }

      let inner: SignIdentity | null = null;

      if (data.identity) {
        try {
          inner = Ed25519KeyIdentity.fromJSON(data.identity);
        } catch {
          const nestedKey = data.identity.secretKey ?? data.identity.privateKey;
          if (nestedKey && typeof nestedKey === 'string') {
            try {
              const cleaned = String(nestedKey).replace(/^0x/, "");
              const isHex = /^[0-9a-fA-F]+$/.test(cleaned);
              const buf = isHex ? Buffer.from(cleaned, "hex") : Buffer.from(String(nestedKey), "base64");
              inner = Ed25519KeyIdentity.fromSecretKey(new Uint8Array(buf));
            } catch (keyError) {
              log.warn("Failed to reconstruct nested identity from key", {
                error: keyError instanceof Error ? keyError.message : String(keyError)
              });
            }
          }
        }
      }

      if (!inner && (data.secretKey || data.privateKey || data.sk)) {
        try {
          const k = String(data.secretKey ?? data.privateKey ?? data.sk);
          const cleaned = k.replace(/^0x/, "");
          const isHex = /^[0-9a-fA-F]+$/.test(cleaned);
          const buf = isHex ? Buffer.from(cleaned, "hex") : Buffer.from(k, "base64");
          inner = Ed25519KeyIdentity.fromSecretKey(new Uint8Array(buf));
        } catch (keyError) {
          log.warn("Failed to reconstruct identity from root-level key", {
            error: keyError instanceof Error ? keyError.message : String(keyError)
          });
        }
      }

      if (!inner) {
        throw new AppError(
          ErrorCode.INVALID_DELEGATION,
          "Delegation chain provided without valid inner identity"
        );
      }

      return DelegationIdentity.fromDelegation(inner, chain);
    }

    if (data === null) {
      return new AnonymousIdentity();
    }

    throw new AppError(
      ErrorCode.INVALID_DELEGATION,
      "Invalid or unsupported delegation identity",
      { reason: "Unrecognized identity structure" }
    );
  } catch (e) {
    if (e instanceof AppError) {
      throw e;
    }
    throw new AppError(
      ErrorCode.INVALID_DELEGATION,
      "Invalid or unsupported delegation identity",
      { reason: e instanceof Error ? e.message : String(e) }
    );
  }
}

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

export async function createAuthenticatedAgent(identityInput: any, retries = 3, operationId?: string): Promise<HttpAgent> {
  return await withBackoff(async () => {
    let identity: SignIdentity;
    
    try {
      identity = toSignIdentity(identityInput);
      
      logger.debug("Identity reconstructed successfully", {
        operationType: OperationType.AUTHENTICATION,
        operationId,
        metadata: { hasIdentity: true }
      });
    } catch (error) {
      if (error instanceof AppError && error.code === ErrorCode.INVALID_DELEGATION) {
        logger.error("Failed to reconstruct delegation identity", error, {
          operationType: OperationType.AUTHENTICATION,
          operationId,
        });
        
        throw new AppError(
          ErrorCode.INVALID_DELEGATION,
          "Authentication failed: Invalid delegation identity",
          {
            originalError: error.message,
            hint: "Please reconnect your wallet and try again. Your session may have expired.",
          }
        );
      }
      throw error;
    }

    const host = icpHost() || "https://ic0.app";
    
    let agent: HttpAgent;
    try {
      agent = new HttpAgent({
        host,
        identity,
      });
      
      logger.debug("HTTP agent created", {
        operationType: OperationType.AUTHENTICATION,
        operationId,
        metadata: { host }
      });
    } catch (error) {
      throw new AppError(
        ErrorCode.INVALID_DELEGATION,
        "Failed to create authenticated agent",
        {
          reason: error instanceof Error ? error.message : String(error),
          hint: "Please check your network connection and try again.",
        }
      );
    }

    agent.addTransform("update", ({ body }) => ({
      ...body,
      ingress_expiry: BigInt(Date.now() + 5 * 60 * 1000) * BigInt(1_000_000),
    }));

    if (host.includes("localhost") || host.includes("127.0.0.1")) {
      try {
        await agent.fetchRootKey();
        
        logger.debug("Root key fetched for local development", {
          operationType: OperationType.AUTHENTICATION,
          operationId
        });
      } catch (error) {
        throw new AppError(
          ErrorCode.EXTERNAL_SERVICE_ERROR,
          "Failed to fetch root key for local development",
          {
            reason: error instanceof Error ? error.message : String(error),
          }
        );
      }
    }

    try {
      const principal = identity.getPrincipal();
      
      logger.info("Authenticated agent created successfully", {
        operationType: OperationType.AUTHENTICATION,
        operationId,
        metadata: {
          host,
          principalLength: principal.toText().length
        }
      });
    } catch (error) {
      throw new AppError(
        ErrorCode.INVALID_DELEGATION,
        "Agent authentication test failed",
        {
          reason: error instanceof Error ? error.message : String(error),
          hint: "The identity cannot provide a valid principal.",
        }
      );
    }

    return agent;
  }, retries, 500);
}

export async function createQueryAgentWithFallback(): Promise<HttpAgent> {
  const hosts = [
    icpHost() || "https://ic0.app",
    "https://icp-api.io",
    "https://boundary.ic0.app",
  ];
  let lastErr: unknown = null;
  for (const host of hosts) {
    try {
      const agent = new HttpAgent({ host });
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }
      return agent;
    } catch (e) {
      lastErr = e;
      log.warn("Failed creating query agent, trying next host", {
        host,
        error: e instanceof Error ? e.message : "Unknown",
      });
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Failed to create query agent");
}

async function getTokenWasm(operationId?: string): Promise<Uint8Array> {
  const objName = "wasm/icrc1_ledger.wasm";
  const expectedSha = (wasmModuleSha256() || "").trim().toLowerCase().replace(/^0x/, "");
  
  try {
    logger.info("Checking for cached WASM module", {
      operationType: OperationType.CANISTER_DEPLOY,
      operationId,
      metadata: { objectName: objName }
    });

    const exists = await icpStorage.exists(objName);
    if (exists) {
      const buf = await icpStorage.download(objName);
      if (expectedSha && !matchesSha256(buf, expectedSha)) {
        logger.warn("Cached WASM checksum mismatch, refetching", {
          operationType: OperationType.CANISTER_DEPLOY,
          operationId,
          metadata: { objName }
        });
      } else {
        logger.info("Loaded WASM module from object storage", {
          operationType: OperationType.CANISTER_DEPLOY,
          operationId,
          metadata: { name: objName, size: buf.length }
        });
        return new Uint8Array(buf);
      }
    }

    const url =
      wasmModuleUrl() ||
      "https://github.com/dfinity/ICRC-1/releases/download/v0.1.0/icrc1_ledger.wasm";

    logger.info("Fetching WASM module from URL", {
      operationType: OperationType.CANISTER_DEPLOY,
      operationId,
      metadata: { url }
    });

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

    if (wasmModule.length < 1000 || wasmModule.length > 50 * 1024 * 1024) {
      throw new Error(`Invalid WASM module size: ${wasmModule.length} bytes`);
    }

    if (expectedSha && !matchesSha256(Buffer.from(wasmModule), expectedSha)) {
      throw new Error("WASM checksum mismatch");
    }

    await icpStorage
      .upload(objName, Buffer.from(wasmModule), {
        contentType: "application/wasm",
        preconditions: { notExists: true },
      })
      .catch(() => {
        // Ignore conflict if already uploaded concurrently
      });

    logger.info("WASM module fetched and stored", {
      operationType: OperationType.CANISTER_DEPLOY,
      operationId,
      metadata: { name: objName, size: wasmModule.length }
    });

    return wasmModule;
  } catch (error) {
    logger.error("Failed to fetch or load WASM module", error instanceof Error ? error : new Error(String(error)), {
      operationType: OperationType.CANISTER_DEPLOY,
      operationId
    });

    throw new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, "Failed to fetch ICRC-1 WASM module", {});
  }
}

function matchesSha256(buf: Buffer, expectedHex: string): boolean {
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  return actual === expectedHex;
}

function icpToE8s(amountStr: string): bigint {
  const normalized = amountStr.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, `Invalid ICP fee amount: ${amountStr}`);
  }
  const [intPart, fracPart = ""] = normalized.split(".");
  const fracPadded = (fracPart + "00000000").slice(0, 8);
  return BigInt(intPart) * 100000000n + BigInt(fracPadded);
}

export function parseTreasuryDelegationIdentity(): SignIdentity {
  const raw = treasuryDelegationIdentityJSON();
  if (!raw) {
    throw new AppError(ErrorCode.UNAUTHORIZED_ACCESS, "Treasury delegation identity not configured");
  }
  try {
    return toSignIdentity(raw);
  } catch (e) {
    throw new AppError(
      ErrorCode.INVALID_DELEGATION,
      "Invalid Treasury delegation identity secret",
      { reason: e instanceof Error ? e.message : String(e) }
    );
  }
}

async function collectCreationFeeWithUserIdentity(userAgent: HttpAgent, operationId?: string): Promise<{ feePaidE8s: bigint }> {
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

  logger.info("Collecting user creation fee", {
    operationType: OperationType.ICP_TRANSFER,
    operationId,
    metadata: {
      amountE8s: feeE8s.toString(),
      ledgerCanisterId
    }
  });

  addBreadcrumb(
    "ICP fee transfer started",
    "blockchain",
    "info",
    {
      amountE8s: feeE8s.toString(),
      operationId
    }
  );

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
    
    logger.error("ICP fee transfer failed", new Error(errDetails), {
      operationType: OperationType.ICP_TRANSFER,
      operationId,
      metadata: { errorDetails }
    });

    throw new AppError(ErrorCode.EXTERNAL_SERVICE_ERROR, `ICP fee transfer failed: ${errDetails}`, {});
  }

  logger.info("ICP fee transfer successful", {
    operationType: OperationType.ICP_TRANSFER,
    operationId,
    metadata: {
      transactionId: res.Ok ? res.Ok.toString() : "unknown",
      amountE8s: feeE8s.toString()
    }
  });

  return { feePaidE8s: res.Ok ? BigInt(res.Ok) : feeE8s };
}

async function createAndInstallWithCyclesWallet(
  owner: Principal,
  wasmModule: Uint8Array,
  initArgs: Uint8Array,
  operationId?: string
): Promise<{ canisterId: Principal; cyclesUsed: bigint }> {
  const cyclesStr = deployCyclesAmount() || "3000000000000";
  const cycles = BigInt(cyclesStr);

  const walletId = treasuryCyclesWalletId();
  if (!walletId) {
    throw new AppError(ErrorCode.UNAUTHORIZED_ACCESS, "Treasury cycles wallet canister ID not configured");
  }

  const treasuryIdentity = parseTreasuryDelegationIdentity();
  const treasuryAgent = await createAuthenticatedAgent(treasuryIdentity, 3, operationId);

  const wallet = Actor.createActor(cyclesWalletIdlFactory, {
    agent: treasuryAgent,
    canisterId: Principal.fromText(walletId),
  }) as ActorSubclass<any>;

  logger.info("Creating canister via cycles wallet", {
    operationType: OperationType.CANISTER_DEPLOY,
    operationId,
    metadata: {
      walletId,
      cycles: cycles.toString(),
      ownerLength: owner.toText().length
    }
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
  
  logger.info("Installing code via cycles wallet", {
    operationType: OperationType.CANISTER_DEPLOY,
    operationId,
    canisterId: canisterId.toText(),
    metadata: { wasmSize: wasmModule.length }
  });

  await wallet.wallet_install_code({
    mode: { install: null },
    canister_id: canisterId,
    wasm_module: wasmModule,
    arg: initArgs,
  });

  logger.info("Canister creation and installation completed", {
    operationType: OperationType.CANISTER_DEPLOY,
    operationId,
    canisterId: canisterId.toText(),
    metadata: { cyclesUsed: cycles.toString() }
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

export const deploy = api<DeployCanisterRequest, DeployCanisterResponse>(
  { expose: true, method: "POST", path: "/icp/deploy" },
  withOperationLogging(
    OperationType.CANISTER_DEPLOY,
    "Deploy ICRC-1 Canister",
    monitor("icp.deploy", async (req) => {
      const operationId = logger.startOperation(
        OperationType.CANISTER_DEPLOY,
        "Canister deployment initiated",
        {
          metadata: {
            tokenName: req.tokenName,
            symbol: req.symbol,
            totalSupply: req.totalSupply,
            decimals: req.decimals,
            isMintable: req.isMintable,
            isBurnable: req.isBurnable
          }
        }
      );

      // Set Sentry tags for this operation
      setTag("operation_type", "canister_deploy");
      setTag("token_symbol", req.symbol);

      try {
        // Add breadcrumb for deployment start
        addBreadcrumb(
          "Canister deployment started",
          "blockchain",
          "info",
          {
            symbol: req.symbol,
            totalSupply: req.totalSupply,
            operationId,
          }
        );

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
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Invalid deployment parameters",
            { errors: validator.getErrors() },
            OperationType.CANISTER_DEPLOY,
            operationId
          );
        }

        if (!req.delegationIdentity) {
          throw createAppError(
            ErrorCode.INVALID_DELEGATION,
            "Valid delegation identity is required",
            undefined,
            OperationType.CANISTER_DEPLOY,
            operationId
          );
        }

        logger.info("Deployment validation passed", {
          operationType: OperationType.CANISTER_DEPLOY,
          operationId,
          metadata: {
            symbol: req.symbol,
            totalSupply: req.totalSupply
          }
        });

        let feeResult: { feePaidE8s: bigint } | null = null;
        try {
          const userAgent = await createAuthenticatedAgent(req.delegationIdentity, 3, operationId);
          feeResult = await collectCreationFeeWithUserIdentity(userAgent, operationId);
          
          logger.info("Creation fee collected successfully", {
            operationType: OperationType.CANISTER_DEPLOY,
            operationId,
            metadata: { feePaidE8s: feeResult.feePaidE8s.toString() }
          });
        } catch (feeErr) {
          const bypass = (skipUserFeeDuringDev() || "").toLowerCase() === "true";
          if (bypass) {
            logger.warn("Bypassing user ICP fee transfer due to delegation/connection issues (dev only)", {
              operationType: OperationType.CANISTER_DEPLOY,
              operationId,
              metadata: { error: feeErr instanceof Error ? feeErr.message : String(feeErr) }
            });
            metrics.increment("canister.deploy_fee_bypassed");
          } else {
            if (feeErr instanceof AppError && feeErr.code === ErrorCode.INVALID_DELEGATION) {
              throw createAppError(
                ErrorCode.INVALID_DELEGATION,
                "Failed to authenticate for fee payment",
                {
                  originalError: feeErr.message,
                  hint: "Please reconnect your wallet and ensure your session hasn't expired.",
                },
                OperationType.CANISTER_DEPLOY,
                operationId
              );
            }
            throw feeErr;
          }
        }

        const wasmModule = await getTokenWasm(operationId);

        logger.info("WASM module loaded, preparing init args", {
          operationType: OperationType.CANISTER_DEPLOY,
          operationId,
          metadata: { wasmSize: wasmModule.length }
        });

        const initArgs = encodeIcrc1InitArgs({
          name: req.tokenName,
          symbol: req.symbol,
          decimals: req.decimals,
          totalSupply: BigInt(req.totalSupply),
          owner: req.ownerPrincipal,
          isMintable: req.isMintable,
          isBurnable: req.isBurnable,
        });

        let canisterId: Principal;
        let cyclesUsed: bigint;

        const walletConfigured = Boolean(treasuryCyclesWalletId() && treasuryDelegationIdentityJSON());
        if (walletConfigured) {
          logger.info("Using cycles wallet for deployment", {
            operationType: OperationType.CANISTER_DEPLOY,
            operationId
          });

          const result = await createAndInstallWithCyclesWallet(
            Principal.fromText(req.ownerPrincipal),
            wasmModule,
            initArgs,
            operationId
          );
          canisterId = result.canisterId;
          cyclesUsed = result.cyclesUsed;
        } else {
          logger.info("Using user identity for direct deployment", {
            operationType: OperationType.CANISTER_DEPLOY,
            operationId
          });

          const userAgent = await createAuthenticatedAgent(req.delegationIdentity, 3, operationId);
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

        logger.info("Canister deployment successful", {
          operationType: OperationType.CANISTER_DEPLOY,
          operationId,
          canisterId: canisterId.toText(),
          metadata: {
            symbol: req.symbol,
            cyclesUsed: cyclesUsed.toString(),
            deploymentMethod: walletConfigured ? "cycles_wallet" : "direct"
          }
        });

        addBreadcrumb(
          "Canister deployed successfully",
          "blockchain",
          "info",
          { 
            canisterId: canisterId.toText(),
            cyclesUsed: cyclesUsed.toString(),
            status: "deployed"
          }
        );

        try {
          const agent = await createQueryAgentWithFallback();
          const management = Actor.createActor(managementIdlFactory, {
            agent,
            canisterId: Principal.fromText("aaaaa-aa"),
          }) as ActorSubclass<any>;
          const status = await management.canister_status({ canister_id: canisterId });
          const statusKey = Object.keys(status.status)[0];
          if (statusKey !== "running") {
            logger.warn("Canister not in running state post-deploy", {
              operationType: OperationType.CANISTER_DEPLOY,
              operationId,
              canisterId: canisterId.toText(),
              metadata: { statusKey }
            });
          }
        } catch (error) {
          logger.warn("Failed to verify canister status", {
            operationType: OperationType.CANISTER_DEPLOY,
            operationId,
            canisterId: canisterId.toText(),
            metadata: { error: error instanceof Error ? error.message : "Unknown" }
          });
        }

        const deploymentHash = `deploy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        metrics.increment("canister.deployed");

        const cyclesStr = cyclesUsed.toString();
        const feeICPStr = feeResult ? (userCreationFeeICP() || "1") : "0";

        logger.completeOperation(
          operationId,
          OperationType.CANISTER_DEPLOY,
          "Canister deployment completed successfully",
          true,
          undefined,
          {
            canisterId: canisterId.toText(),
            symbol: req.symbol,
            cyclesUsed: cyclesStr,
            feePaidICP: feeICPStr
          }
        );

        addBreadcrumb(
          "Canister deployment completed successfully",
          "blockchain",
          "info",
          {
            canisterId: canisterId.toText(),
            symbol: req.symbol,
            deploymentHash
          }
        );

        return {
          canisterId: canisterId.toText(),
          status: "deployed",
          deploymentHash,
          cyclesUsed: cyclesStr,
          feePaidICP: feeICPStr,
        };
      } catch (error) {
        metrics.increment("canister.deploy_failed");
        
        logger.completeOperation(
          operationId,
          OperationType.CANISTER_DEPLOY,
          "Canister deployment failed",
          false,
          undefined,
          {
            symbol: req.symbol,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "icp.deploy", OperationType.CANISTER_DEPLOY, operationId);
      }
    })
  )
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

export const getStatus = api<{ canisterId: string }, CanisterStatus>(
  { expose: true, method: "GET", path: "/icp/canister/:canisterId/status" },
  withOperationLogging(
    OperationType.CANISTER_STATUS,
    "Get Canister Status",
    monitor("icp.getStatus", async (req) => {
      const operationId = logger.startOperation(
        OperationType.CANISTER_STATUS,
        "Canister status query initiated",
        {
          canisterId: req.canisterId
        }
      );

      try {
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

        logger.info("Querying canister status", {
          operationType: OperationType.CANISTER_STATUS,
          operationId,
          canisterId: req.canisterId
        });

        const agent = await createQueryAgentWithFallback();

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

        logger.completeOperation(
          operationId,
          OperationType.CANISTER_STATUS,
          "Canister status retrieved successfully",
          true,
          undefined,
          {
            canisterId: req.canisterId,
            status: statusKey,
            controllersCount: controllers.length
          }
        );

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
        logger.completeOperation(
          operationId,
          OperationType.CANISTER_STATUS,
          "Canister status query failed",
          false,
          undefined,
          {
            canisterId: req.canisterId,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "icp.getStatus", OperationType.CANISTER_STATUS, operationId);
      }
    })
  )
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

export const performTokenOperation = api<TokenOperationRequest, TokenOperationResponse>(
  { expose: true, method: "POST", path: "/icp/operation" },
  withOperationLogging(
    OperationType.TOKEN_TRANSFER,
    "Perform Token Operation",
    monitor("icp.tokenOperation", async (req) => {
      const operationId = logger.startOperation(
        OperationType.TOKEN_TRANSFER,
        `Token ${req.operation} operation initiated`,
        {
          canisterId: req.canisterId,
          metadata: {
            operation: req.operation,
            amount: req.amount,
            hasRecipient: !!req.recipient
          }
        }
      );

      // Set Sentry tags for this operation
      setTag("operation_type", `token_${req.operation}`);
      setTag("canister_id", req.canisterId);

      try {
        // Add breadcrumb for operation start
        addBreadcrumb(
          `Token ${req.operation} operation started`,
          "blockchain",
          "info",
          {
            canisterId: req.canisterId,
            operation: req.operation,
            amount: req.amount,
            operationId,
          }
        );

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
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Invalid operation parameters",
            { errors: validator.getErrors() },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        if (!req.delegationIdentity) {
          throw createAppError(
            ErrorCode.INVALID_DELEGATION,
            "Valid delegation identity is required",
            undefined,
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        logger.info("Token operation validation passed", {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          canisterId: req.canisterId,
          metadata: {
            operation: req.operation,
            amount: req.amount
          }
        });

        const { principal: targetCanister, isLedger } = resolveCanisterPrincipal(req.canisterId);

        if (isLedger && req.operation !== "transfer") {
          throw createAppError(
            ErrorCode.VALIDATION_ERROR,
            "Only transfer operations are supported on the ICP Ledger canister",
            { operation: req.operation },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        }

        const agent = await createAuthenticatedAgent(req.delegationIdentity, 3, operationId);

        const tokenActor = Actor.createActor(isLedger ? icrc1LedgerIdlFactory : icrc1IdlFactory, {
          agent,
          canisterId: targetCanister,
        }) as ActorSubclass<any>;

        if (!isLedger) {
          const required = new Set(["icrc1_transfer", "icrc1_balance_of"]);
          if (req.operation === "mint") required.add("mint");
          if (req.operation === "burn") required.add("burn");
          for (const m of required) {
            if (typeof (tokenActor as any)[m] !== "function") {
              throw createAppError(
                ErrorCode.CANISTER_ERROR,
                `Canister does not expose required method: ${m}`,
                { method: m },
                OperationType.TOKEN_TRANSFER,
                operationId
              );
            }
          }
        }

        const amount = BigInt(req.amount);
        const ownerAccount = {
          owner: Principal.fromText(req.ownerPrincipal),
          subaccount: [],
        };

        let result: any;

        logger.info(`Executing ${req.operation} operation on canister`, {
          operationType: OperationType.TOKEN_TRANSFER,
          operationId,
          canisterId: req.canisterId,
          metadata: {
            operation: req.operation,
            amount: req.amount,
            isLedger
          }
        });

        switch (req.operation) {
          case "mint":
            if (isLedger) {
              throw createAppError(
                ErrorCode.VALIDATION_ERROR,
                "Mint is not supported on ICP Ledger",
                undefined,
                OperationType.TOKEN_TRANSFER,
                operationId
              );
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
              throw createAppError(
                ErrorCode.VALIDATION_ERROR,
                "Burn is not supported on ICP Ledger",
                undefined,
                OperationType.TOKEN_TRANSFER,
                operationId
              );
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
            throw createAppError(
              ErrorCode.VALIDATION_ERROR,
              `Unknown operation: ${req.operation}`,
              { operation: req.operation },
              OperationType.TOKEN_TRANSFER,
              operationId
            );
        }

        let transactionId: string;
        let success: boolean;

        if (result && result.Ok !== undefined) {
          success = true;
          transactionId = result.Ok.toString();
        } else if (result && result.Err !== undefined) {
          success = false;
          const errorDetails = JSON.stringify(result.Err);
          
          logger.error(`Token ${req.operation} operation failed on canister`, new Error(errorDetails), {
            operationType: OperationType.TOKEN_TRANSFER,
            operationId,
            canisterId: req.canisterId,
            metadata: { operation: req.operation, errorDetails }
          });

          throw createAppError(
            ErrorCode.CANISTER_ERROR,
            `Operation failed: ${errorDetails}`,
            { errorDetails },
            OperationType.TOKEN_TRANSFER,
            operationId
          );
        } else {
          success = true;
          transactionId = String(result ?? "");
        }

        let newBalance: string | undefined;
        try {
          const balance = await (tokenActor as any).icrc1_balance_of(ownerAccount);
          newBalance = balance.toString();
        } catch (error) {
          logger.warn("Failed to fetch updated balance", {
            operationType: OperationType.TOKEN_TRANSFER,
            operationId,
            metadata: { error: error instanceof Error ? error.message : "Unknown" }
          });
        }

        metrics.increment("token.operation_success");

        logger.completeOperation(
          operationId,
          OperationType.TOKEN_TRANSFER,
          `Token ${req.operation} operation completed successfully`,
          true,
          undefined,
          {
            canisterId: req.canisterId,
            operation: req.operation,
            transactionId,
            newBalance
          }
        );

        addBreadcrumb(
          `Token ${req.operation} operation completed successfully`,
          "blockchain",
          "info",
          {
            canisterId: req.canisterId,
            operation: req.operation,
            transactionId,
            amount: req.amount
          }
        );

        return {
          success,
          transactionId,
          newBalance,
          blockIndex: transactionId,
        };
      } catch (error) {
        metrics.increment("token.operation_failed");
        
        logger.completeOperation(
          operationId,
          OperationType.TOKEN_TRANSFER,
          `Token ${req.operation} operation failed`,
          false,
          undefined,
          {
            canisterId: req.canisterId,
            operation: req.operation,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "icp.performTokenOperation", OperationType.TOKEN_TRANSFER, operationId);
      }
    })
  )
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

export const getTokenInfo = api<{ canisterId: string }, TokenInfo>(
  { expose: true, method: "GET", path: "/icp/token/:canisterId/info" },
  withOperationLogging(
    OperationType.BALANCE_QUERY,
    "Get Token Info",
    monitor("icp.getTokenInfo", async (req) => {
      const operationId = logger.startOperation(
        OperationType.BALANCE_QUERY,
        "Token info query initiated",
        {
          canisterId: req.canisterId
        }
      );

      try {
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

        logger.info("Retrieving token info from canister", {
          operationType: OperationType.BALANCE_QUERY,
          operationId,
          canisterId: req.canisterId
        });

        const agent = await createQueryAgentWithFallback();

        const tokenActor = Actor.createActor(icrc1IdlFactory, {
          agent,
          canisterId: Principal.fromText(req.canisterId),
        }) as ActorSubclass<any>;

        const fetchPromise = async () => {
          return Promise.all([
            tokenActor.icrc1_name(),
            tokenActor.icrc1_symbol(),
            tokenActor.icrc1_decimals(),
            tokenActor.icrc1_total_supply(),
            tokenActor.icrc1_metadata(),
          ]);
        };

        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
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

        const transferFeeEntry = metadata.find(([key]: [string, any]) => key === "icrc1:fee");
        const transferFee = transferFeeEntry ? transferFeeEntry[1].Nat?.toString?.() || "0" : "0";

        const metadataEntries: MetadataEntry[] = metadata.map(([key, value]: [string, any]) => ({
          key,
          value,
        }));

        logger.completeOperation(
          operationId,
          OperationType.BALANCE_QUERY,
          "Token info retrieved successfully",
          true,
          undefined,
          {
            canisterId: req.canisterId,
            symbol,
            name,
            totalSupply: totalSupply.toString()
          }
        );

        return {
          name,
          symbol,
          decimals,
          totalSupply: totalSupply.toString(),
          transferFee,
          metadata: metadataEntries,
        };
      } catch (error) {
        logger.completeOperation(
          operationId,
          OperationType.BALANCE_QUERY,
          "Token info query failed",
          false,
          undefined,
          {
            canisterId: req.canisterId,
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        );

        return handleError(error as Error, "icp.getTokenInfo", OperationType.BALANCE_QUERY, operationId);
      }
    })
  )
);

export interface BalanceRequest {
  canisterId: string;
  principal: string;
  subaccount?: string;
}

export interface BalanceResponse {
  balance: string;
}

export const getBalance = api<BalanceRequest, BalanceResponse>(
  { expose: true, method: "GET", path: "/icp/token/:canisterId/balance/:principal" },
  withOperationLogging(
    OperationType.BALANCE_QUERY,
    "Get Balance",
    monitor("icp.getBalance", async (req) => {
      const operationId = logger.startOperation(
        OperationType.BALANCE_QUERY,
        "Balance query initiated",
        {
          canisterId: req.canisterId,
          metadata: {
            principalLength: req.principal.length,
            hasSubaccount: !!req.subaccount
          }
        }
      );

      try {
        const validator = validate().required(req.canisterId, "canisterId").required(req.principal, "principal");

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

        const { principal: targetCanister } = resolveCanisterPrincipal(req.canisterId);

        logger.info("Querying balance from canister", {
          operationType: OperationType.BALANCE_QUERY,
          operationId,
          canisterId: targetCanister.toText(),
          metadata: {
            principalLength: req.principal.length
          }
        });

        const agent = await createQueryAgentWithFallback();

        const tokenActor = Actor.createActor(icrc1LedgerIdlFactory, {
          agent,
          canisterId: targetCanister,
        }) as ActorSubclass<any>;

        const account = {
          owner: Principal.fromText(req.principal),
          subaccount: req.subaccount ? [new Uint8Array(Buffer.from(req.subaccount, "hex"))] : [],
        };

        const withTimeout = <T,>(p: Promise<T>, ms: number) =>
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

        const balance = await withBackoff(() => withTimeout(tokenActor.icrc1_balance_of(account), 15000), 3, 500);

        logger.completeOperation(
          operationId,
          OperationType.BALANCE_QUERY,
          "Balance query successful",
          true,
          undefined,
          {
            canisterId: req.canisterId,
            balance: balance.toString()
          }
        );

        return {
          balance: balance.toString(),
        };
      } catch (error) {
        return handleError(error as Error, "icp.getBalance", OperationType.BALANCE_QUERY, operationId);
      }
    })
  )
);
