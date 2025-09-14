import { api } from "encore.dev/api";
import { healthChecker, HealthStatus } from "../common/monitoring";
import { tokenDB } from "../token/db";
import { analyticsDB } from "../analytics/db";
import { Principal } from "@dfinity/principal";
import { HttpAgent, Actor } from "@dfinity/agent";
import { managementIdlFactory } from "../icp/idl";
import log from "encore.dev/log";
import { secret } from "encore.dev/config";
import { parseTreasuryDelegationIdentity, createAuthenticatedAgent } from "../icp/canister";

// Health check endpoint
export const getHealth = api<void, HealthStatus>(
  { expose: true, method: "GET", path: "/health" },
  async () => {
    return await healthChecker.getHealth();
  }
);

// Setup health checks
healthChecker.addCheck('database', async () => {
  try {
    await tokenDB.queryRow`SELECT 1`;
    return { status: 'pass', message: 'Database connection is healthy' };
  } catch (error) {
    return { 
      status: 'fail', 
      message: `Database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
});

healthChecker.addCheck('analytics_database', async () => {
  try {
    await analyticsDB.queryRow`SELECT 1`;
    return { status: 'pass', message: 'Analytics database connection is healthy' };
  } catch (error) {
    return { 
      status: 'fail', 
      message: `Analytics database connection failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
});

healthChecker.addCheck('rate_limits_table', async () => {
  try {
    // Verify the rate_limits table exists and is accessible
    // We attempt a simple query; if the table doesn't exist this will throw.
    await tokenDB.queryRow`SELECT limiter_name FROM rate_limits LIMIT 1`;
    return { status: 'pass', message: 'rate_limits table exists' };
  } catch (error) {
    return {
      status: 'fail',
      message: `rate_limits table missing or inaccessible: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
});

healthChecker.addCheck('memory', async () => {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 500) {
    return { status: 'warn', message: `High memory usage: ${heapUsedMB.toFixed(2)}MB` };
  }
  
  return { status: 'pass', message: `Memory usage: ${heapUsedMB.toFixed(2)}MB` };
});

// Basic ICP connectivity check against the public management canister.
// Also verifies that we can reach the network endpoints used by ledger queries.
const icpHost = secret("ICPHost");
healthChecker.addCheck('ic_ledger_connectivity', async () => {
  const hosts = [icpHost() || "https://ic0.app", "https://icp-api.io"];
  for (const host of hosts) {
    try {
      const agent = new HttpAgent({ host });
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        await agent.fetchRootKey();
      }
      const management = Actor.createActor(managementIdlFactory, {
        agent,
        canisterId: Principal.fromText("aaaaa-aa"),
      }) as any;
      // A light-weight status call to verify connectivity. Use the management canister itself.
      await management.canister_status({ canister_id: Principal.fromText("aaaaa-aa") });
      return { status: 'pass', message: `ICP network reachable via ${host}` };
    } catch (err) {
      log.warn("ICP connectivity check failed for host", {
        host,
        error: err instanceof Error ? err.message : "Unknown",
      });
      // try next host
    }
  }
  return { status: 'fail', message: "Unable to reach ICP public endpoints (ic0.app or icp-api.io)" };
});

// Ensures the treasury delegation principal is a controller of the cycles wallet canister (visibility-only).
// This will report 'warn' if not configured, 'fail' if cannot verify (likely not a controller), and 'pass' if confirmed.
const treasuryCyclesWalletId = secret("TreasuryCyclesWallet");
const treasuryDelegationIdentityJSON = secret("TreasuryDelegationIdentityJSON");

healthChecker.addCheck('treasury_wallet_controller', async () => {
  const walletIdText = (treasuryCyclesWalletId() || "").trim();
  const treasuryJson = treasuryDelegationIdentityJSON();

  if (!walletIdText || !treasuryJson) {
    return {
      status: 'warn',
      message: 'Treasury cycles wallet or delegation identity not configured; controller check skipped.',
    };
  }

  try {
    const walletId = Principal.fromText(walletIdText);
    const treasuryIdentity = parseTreasuryDelegationIdentity();
    const treasuryPrincipal = treasuryIdentity.getPrincipal().toText();

    // Use treasury identity to attempt canister_status (requires controller permissions)
    const agent = await createAuthenticatedAgent(treasuryIdentity);
    const management = Actor.createActor(managementIdlFactory, {
      agent,
      canisterId: Principal.fromText("aaaaa-aa"),
    }) as any;

    const status = await management.canister_status({ canister_id: walletId });
    const controllers: string[] = status.settings.controllers.map((p: any) => p.toText());
    const isController = controllers.includes(treasuryPrincipal);

    return isController
      ? { status: 'pass', message: 'Treasury principal is a controller of the cycles wallet.' }
      : {
          status: 'fail',
          message: 'Treasury principal is NOT a controller of the cycles wallet. Run the setup endpoint or the dfx update-settings command.',
        };
  } catch (err) {
    // Likely unauthorized to query canister_status -> not a controller
    return {
      status: 'fail',
      message:
        'Unable to verify controllers (caller not authorized). Ensure the treasury principal has controller rights on the cycles wallet.',
    };
  }
});
