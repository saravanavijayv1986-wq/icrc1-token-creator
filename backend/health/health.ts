import { api } from "encore.dev/api";
import { healthChecker, HealthStatus } from "../common/monitoring";
import { tokenDB } from "../token/db";
import { analyticsDB } from "../analytics/db";

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
