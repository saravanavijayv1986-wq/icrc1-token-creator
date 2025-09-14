import { Cron } from "encore.dev/cron";
import { monitoringDB } from "./db";
import { tokenDB } from "../token/db";
import { icp } from "~encore/clients";
import { metrics, monitor } from "../common/monitoring";
import log from "encore.dev/log";

interface CanisterHealthData {
  canisterId: string;
  tokenId: number;
  status: string;
  cycleBalance: bigint;
  memorySize: bigint;
  controllers: string[];
  moduleHash?: string;
  responseTimeMs: number;
}

interface TransactionMetrics {
  canisterId: string;
  tokenId: number;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averageResponseTime: number;
}

// Health checker that runs every 15 minutes
export const healthCheckCron = new Cron(
  "canister-health-check",
  { schedule: "*/15 * * * *" }, // Every 15 minutes
  async () => {
    await performHealthChecks();
  }
);

// Metrics collector that runs every hour
export const metricsCollectorCron = new Cron(
  "metrics-collector",
  { schedule: "0 * * * *" }, // Every hour
  async () => {
    await collectPerformanceMetrics();
  }
);

// Alert processor that runs every 5 minutes
export const alertProcessorCron = new Cron(
  "alert-processor",
  { schedule: "*/5 * * * *" }, // Every 5 minutes
  async () => {
    await processAlerts();
  }
);

async function performHealthChecks(): Promise<void> {
  try {
    log.info("Starting canister health checks");

    // Get all deployed tokens with enabled monitoring
    const tokensWithCanisters = await tokenDB.queryAll<{
      id: number;
      canister_id: string;
      token_name: string;
      symbol: string;
    }>`
      SELECT t.id, t.canister_id, t.token_name, t.symbol
      FROM tokens t
      WHERE t.status = 'deployed' 
        AND t.canister_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM monitoring.health_check_config hcc 
          WHERE hcc.canister_id = t.canister_id AND hcc.enabled = true
        )
    `;

    log.info(`Checking health for ${tokensWithCanisters.length} canisters`);

    for (const token of tokensWithCanisters) {
      try {
        await checkCanisterHealth(token.canister_id, token.id);
      } catch (error) {
        log.error("Failed to check canister health", {
          canisterId: token.canister_id,
          tokenId: token.id,
          error: error instanceof Error ? error.message : String(error)
        });

        // Record the error
        await recordHealthError(token.canister_id, token.id, error);
      }
    }

    log.info("Completed canister health checks");
    metrics.increment("monitoring.health_checks_completed");
  } catch (error) {
    log.error("Health check process failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    metrics.increment("monitoring.health_check_errors");
  }
}

async function checkCanisterHealth(canisterId: string, tokenId: number): Promise<void> {
  const startTime = Date.now();

  try {
    // Get canister status from ICP
    const status = await icp.getStatus({ canisterId });
    const responseTime = Date.now() - startTime;

    const healthData: CanisterHealthData = {
      canisterId,
      tokenId,
      status: status.status,
      cycleBalance: BigInt(status.cyclesBalance),
      memorySize: BigInt(status.memorySize),
      controllers: status.controllers,
      moduleHash: status.moduleHash,
      responseTimeMs: responseTime,
    };

    // Record health data
    await recordHealthData(healthData);

    // Check for alerts
    await checkForAlerts(healthData);

    metrics.increment("monitoring.health_check_success");
  } catch (error) {
    metrics.increment("monitoring.health_check_failure");
    throw error;
  }
}

async function recordHealthData(health: CanisterHealthData): Promise<void> {
  // Calculate uptime percentage (simple implementation based on recent checks)
  const recentChecks = await monitoringDB.queryAll<{ error_count: number }>`
    SELECT error_count
    FROM canister_health
    WHERE canister_id = ${health.canisterId}
      AND last_check >= NOW() - INTERVAL '24 hours'
    ORDER BY last_check DESC
    LIMIT 96
  `;

  const totalChecks = recentChecks.length + 1;
  const errorCount = recentChecks.reduce((sum, check) => sum + check.error_count, 0);
  const uptimePercentage = ((totalChecks - errorCount) / totalChecks) * 100;

  await monitoringDB.exec`
    INSERT INTO canister_health (
      canister_id, token_id, status, cycle_balance, memory_size,
      controllers, module_hash, response_time_ms, error_count, uptime_percentage
    ) VALUES (
      ${health.canisterId}, ${health.tokenId}, ${health.status}, ${health.cycleBalance},
      ${health.memorySize}, ${health.controllers}, ${health.moduleHash},
      ${health.responseTimeMs}, 0, ${uptimePercentage}
    )
  `;
}

async function recordHealthError(canisterId: string, tokenId: number, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  await monitoringDB.exec`
    INSERT INTO canister_health (
      canister_id, token_id, status, cycle_balance, memory_size,
      controllers, response_time_ms, error_count, uptime_percentage
    ) VALUES (
      ${canisterId}, ${tokenId}, 'unknown', 0, 0,
      '{}', 0, 1, 0
    )
  `;

  // Create alert for health check failure
  await createAlert({
    canisterId,
    tokenId,
    alertType: 'health_check_failed',
    severity: 'warning',
    title: 'Health Check Failed',
    message: `Failed to check canister health: ${errorMessage}`,
    metadata: { error: errorMessage }
  });
}

async function checkForAlerts(health: CanisterHealthData): Promise<void> {
  // Get alert thresholds
  const config = await monitoringDB.queryRow<{
    cycle_warning_threshold: number;
    cycle_critical_threshold: number;
  }>`
    SELECT cycle_warning_threshold, cycle_critical_threshold
    FROM health_check_config
    WHERE canister_id = ${health.canisterId}
  `;

  if (!config) return;

  const cycleBalance = Number(health.cycleBalance);

  // Check for cycle alerts
  if (cycleBalance <= config.cycle_critical_threshold) {
    await createCycleAlert(health, 'critical_cycles', config.cycle_critical_threshold);
  } else if (cycleBalance <= config.cycle_warning_threshold) {
    await createCycleAlert(health, 'low_cycles', config.cycle_warning_threshold);
  }

  // Check for stopped canister
  if (health.status === 'stopped') {
    await createAlert({
      canisterId: health.canisterId,
      tokenId: health.tokenId,
      alertType: 'canister_stopped',
      severity: 'critical',
      title: 'Canister Stopped',
      message: 'Token canister has stopped running',
      metadata: { status: health.status }
    });
  }

  // Check for high response time
  if (health.responseTimeMs > 5000) {
    await createAlert({
      canisterId: health.canisterId,
      tokenId: health.tokenId,
      alertType: 'high_response_time',
      severity: 'warning',
      title: 'High Response Time',
      message: `Canister response time is ${health.responseTimeMs}ms`,
      metadata: { responseTime: health.responseTimeMs }
    });
  }
}

async function createCycleAlert(health: CanisterHealthData, alertType: string, threshold: number): Promise<void> {
  // Check if we already have an unresolved alert of this type
  const existingAlert = await monitoringDB.queryRow`
    SELECT id FROM cycle_alerts
    WHERE canister_id = ${health.canisterId}
      AND alert_type = ${alertType}
      AND resolved = false
  `;

  if (existingAlert) return; // Don't create duplicate alerts

  await monitoringDB.exec`
    INSERT INTO cycle_alerts (
      canister_id, token_id, alert_type, threshold_value, current_value
    ) VALUES (
      ${health.canisterId}, ${health.tokenId}, ${alertType}, ${threshold}, ${health.cycleBalance}
    )
  `;

  const severity = alertType === 'critical_cycles' ? 'critical' : 'warning';
  const title = alertType === 'critical_cycles' ? 'Critical Cycle Balance' : 'Low Cycle Balance';

  await createAlert({
    canisterId: health.canisterId,
    tokenId: health.tokenId,
    alertType,
    severity,
    title,
    message: `Canister cycle balance is ${health.cycleBalance} (threshold: ${threshold})`,
    metadata: { 
      cycleBalance: health.cycleBalance.toString(),
      threshold: threshold.toString(),
      formatted: {
        balance: formatCycles(Number(health.cycleBalance)),
        threshold: formatCycles(threshold)
      }
    }
  });
}

interface AlertData {
  canisterId: string;
  tokenId: number;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  metadata?: any;
}

async function createAlert(alert: AlertData): Promise<void> {
  await monitoringDB.exec`
    INSERT INTO monitoring_alerts (
      canister_id, token_id, alert_type, severity, title, message, metadata
    ) VALUES (
      ${alert.canisterId}, ${alert.tokenId}, ${alert.alertType},
      ${alert.severity}, ${alert.title}, ${alert.message}, ${alert.metadata}
    )
  `;

  log.warn("Alert created", {
    canisterId: alert.canisterId,
    alertType: alert.alertType,
    severity: alert.severity,
    title: alert.title
  });

  metrics.increment("monitoring.alerts_created", { 
    alert_type: alert.alertType,
    severity: alert.severity 
  });
}

async function collectPerformanceMetrics(): Promise<void> {
  try {
    log.info("Collecting performance metrics");

    // Get transaction metrics for the last hour
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const tokensWithCanisters = await tokenDB.queryAll<{
      id: number;
      canister_id: string;
    }>`
      SELECT id, canister_id
      FROM tokens
      WHERE status = 'deployed' AND canister_id IS NOT NULL
    `;

    for (const token of tokensWithCanisters) {
      try {
        // Get recent transactions for this token
        const transactions = await tokenDB.queryAll<{
          created_at: Date;
          metadata: any;
        }>`
          SELECT created_at, metadata
          FROM token_transactions
          WHERE token_id = ${token.id}
            AND created_at >= ${hourAgo.toISOString()}
          ORDER BY created_at DESC
        `;

        if (transactions.length === 0) continue;

        // Calculate metrics
        const totalTransactions = transactions.length;
        const successfulTransactions = transactions.filter(tx => 
          !tx.metadata?.error
        ).length;
        const failedTransactions = totalTransactions - successfulTransactions;

        // Calculate average response time from metadata if available
        const responseTimes = transactions
          .map(tx => tx.metadata?.responseTime)
          .filter(time => typeof time === 'number');
        const averageResponseTime = responseTimes.length > 0
          ? responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length
          : 0;

        // Record transaction metrics
        await recordTransactionMetrics({
          canisterId: token.canister_id,
          tokenId: token.id,
          totalTransactions,
          successfulTransactions,
          failedTransactions,
          averageResponseTime
        });

        // Record performance metrics
        const errorRate = totalTransactions > 0 ? (failedTransactions / totalTransactions) * 100 : 0;
        
        await monitoringDB.exec`
          INSERT INTO performance_metrics (canister_id, token_id, metric_type, metric_value, metadata)
          VALUES (${token.canister_id}, ${token.id}, 'error_rate', ${errorRate}, ${{}})
        `;

        if (averageResponseTime > 0) {
          await monitoringDB.exec`
            INSERT INTO performance_metrics (canister_id, token_id, metric_type, metric_value, metadata)
            VALUES (${token.canister_id}, ${token.id}, 'response_time', ${averageResponseTime}, ${{}})
          `;
        }

      } catch (error) {
        log.error("Failed to collect metrics for token", {
          tokenId: token.id,
          canisterId: token.canister_id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    metrics.increment("monitoring.metrics_collection_completed");
  } catch (error) {
    log.error("Metrics collection failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    metrics.increment("monitoring.metrics_collection_errors");
  }
}

async function recordTransactionMetrics(metrics: TransactionMetrics): Promise<void> {
  await monitoringDB.exec`
    INSERT INTO transaction_metrics (
      canister_id, token_id, total_transactions, successful_transactions,
      failed_transactions, average_response_time_ms
    ) VALUES (
      ${metrics.canisterId}, ${metrics.tokenId}, ${metrics.totalTransactions},
      ${metrics.successfulTransactions}, ${metrics.failedTransactions}, ${metrics.averageResponseTime}
    )
    ON CONFLICT (canister_id, date_recorded)
    DO UPDATE SET
      total_transactions = transaction_metrics.total_transactions + EXCLUDED.total_transactions,
      successful_transactions = transaction_metrics.successful_transactions + EXCLUDED.successful_transactions,
      failed_transactions = transaction_metrics.failed_transactions + EXCLUDED.failed_transactions,
      average_response_time_ms = (transaction_metrics.average_response_time_ms + EXCLUDED.average_response_time_ms) / 2
  `;
}

async function processAlerts(): Promise<void> {
  try {
    log.info("Processing monitoring alerts");

    // Get unacknowledged critical alerts
    const criticalAlerts = await monitoringDB.queryAll<{
      id: number;
      canister_id: string;
      token_id: number;
      alert_type: string;
      title: string;
      message: string;
      created_at: Date;
    }>`
      SELECT id, canister_id, token_id, alert_type, title, message, created_at
      FROM monitoring_alerts
      WHERE severity = 'critical'
        AND acknowledged = false
        AND created_at >= NOW() - INTERVAL '1 hour'
      ORDER BY created_at DESC
    `;

    for (const alert of criticalAlerts) {
      // Here you would integrate with external alerting systems
      // For now, we'll just log the critical alerts
      log.error("CRITICAL ALERT", {
        alertId: alert.id,
        canisterId: alert.canister_id,
        tokenId: alert.token_id,
        alertType: alert.alert_type,
        title: alert.title,
        message: alert.message,
        createdAt: alert.created_at
      });
    }

    // Resolve old cycle alerts if balance has improved
    await resolveImprovedCycleAlerts();

    metrics.increment("monitoring.alert_processing_completed");
  } catch (error) {
    log.error("Alert processing failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    metrics.increment("monitoring.alert_processing_errors");
  }
}

async function resolveImprovedCycleAlerts(): Promise<void> {
  // Get current health data for canisters with unresolved cycle alerts
  const unresolvedAlerts = await monitoringDB.queryAll<{
    canister_id: string;
    alert_type: string;
    threshold_value: number;
  }>`
    SELECT DISTINCT canister_id, alert_type, threshold_value
    FROM cycle_alerts
    WHERE resolved = false
      AND alert_type IN ('low_cycles', 'critical_cycles')
  `;

  for (const alert of unresolvedAlerts) {
    // Get latest health data
    const latestHealth = await monitoringDB.queryRow<{
      cycle_balance: number;
    }>`
      SELECT cycle_balance
      FROM canister_health
      WHERE canister_id = ${alert.canister_id}
      ORDER BY last_check DESC
      LIMIT 1
    `;

    if (latestHealth && latestHealth.cycle_balance > alert.threshold_value * 1.2) {
      // Resolve alerts if balance is 20% above threshold
      await monitoringDB.exec`
        UPDATE cycle_alerts
        SET resolved = true, resolved_at = NOW()
        WHERE canister_id = ${alert.canister_id}
          AND alert_type = ${alert.alert_type}
          AND resolved = false
      `;

      log.info("Resolved cycle alert", {
        canisterId: alert.canister_id,
        alertType: alert.alert_type,
        currentBalance: latestHealth.cycle_balance,
        threshold: alert.threshold_value
      });
    }
  }
}

function formatCycles(cycles: number): string {
  if (cycles >= 1e12) {
    return `${(cycles / 1e12).toFixed(2)}T`;
  } else if (cycles >= 1e9) {
    return `${(cycles / 1e9).toFixed(2)}B`;
  } else if (cycles >= 1e6) {
    return `${(cycles / 1e6).toFixed(2)}M`;
  } else if (cycles >= 1e3) {
    return `${(cycles / 1e3).toFixed(2)}K`;
  }
  return cycles.toString();
}

// Export functions for manual testing
export {
  performHealthChecks,
  collectPerformanceMetrics,
  processAlerts,
  checkCanisterHealth,
  formatCycles
};
