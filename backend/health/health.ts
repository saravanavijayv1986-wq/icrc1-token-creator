import { api } from "encore.dev/api";
import { healthChecker, HealthStatus } from "../common/monitoring";
import { tokenDB } from "../token/db";
import { analyticsDB } from "../analytics/db";
import { Principal } from "@dfinity/principal";
import { HttpAgent, Actor } from "@dfinity/agent";
import { managementIdlFactory } from "../icp/idl";
import log from "encore.dev/log";
import { secret } from "encore.dev/config";

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
