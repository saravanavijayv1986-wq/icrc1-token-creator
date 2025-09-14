import { api } from "encore.dev/api";
import { Query } from "encore.dev/api";
import { monitoringDB } from "./db";
import { tokenDB } from "../token/db";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError } from "../common/errors";
import { metrics, monitor } from "../common/monitoring";
import log from "encore.dev/log";

export interface CanisterHealthMetrics {
  canisterId: string;
  tokenId: number;
  tokenName: string;
  symbol: string;
  status: string;
  cycleBalance: string;
  memorySize: string;
  uptimePercentage: number;
  lastCheck: Date;
  responseTimeMs: number;
  errorCount: number;
  alertCount: number;
}

export interface GetCanisterHealthRequest {
  canisterId?: string;
  tokenId?: number;
  limit?: Query<number>;
  offset?: Query<number>;
}

export interface GetCanisterHealthResponse {
  canisters: CanisterHealthMetrics[];
  total: number;
  summary: {
    totalCanisters: number;
    healthyCanisters: number;
    unhealthyCanisters: number;
    averageUptimePercentage: number;
    totalCyclesBalance: string;
  };
}

// Retrieves canister health metrics and status information.
export const getCanisterHealth = api<GetCanisterHealthRequest, GetCanisterHealthResponse>(
  { expose: true, method: "GET", path: "/monitoring/health" },
  monitor("monitoring.getCanisterHealth", async (req) => {
    try {
      const limit = req.limit ?? 50;
      const offset = req.offset ?? 0;

      let whereConditions = ["1=1"];
      const params: any[] = [];

      if (req.canisterId) {
        whereConditions.push(`ch.canister_id = $${params.length + 1}`);
        params.push(req.canisterId);
      }

      if (req.tokenId) {
        whereConditions.push(`ch.token_id = $${params.length + 1}`);
        params.push(req.tokenId);
      }

      const whereClause = whereConditions.join(" AND ");

      // Get latest health data for each canister
      const healthQuery = `
        WITH latest_health AS (
          SELECT DISTINCT ON (ch.canister_id) 
            ch.canister_id, ch.token_id, ch.status, ch.cycle_balance,
            ch.memory_size, ch.uptime_percentage, ch.last_check,
            ch.response_time_ms, ch.error_count,
            t.token_name, t.symbol
          FROM canister_health ch
          JOIN tokens t ON ch.token_id = t.id
          WHERE ${whereClause}
          ORDER BY ch.canister_id, ch.last_check DESC
        ),
        alert_counts AS (
          SELECT canister_id, COUNT(*) as alert_count
          FROM monitoring_alerts
          WHERE acknowledged = false
            AND created_at >= NOW() - INTERVAL '24 hours'
          GROUP BY canister_id
        )
        SELECT 
          lh.*,
          COALESCE(ac.alert_count, 0) as alert_count
        FROM latest_health lh
        LEFT JOIN alert_counts ac ON lh.canister_id = ac.canister_id
        ORDER BY lh.last_check DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      const healthRows = await monitoringDB.rawQueryAll<{
        canister_id: string;
        token_id: number;
        token_name: string;
        symbol: string;
        status: string;
        cycle_balance: string;
        memory_size: string;
        uptime_percentage: number;
        last_check: Date;
        response_time_ms: number;
        error_count: number;
        alert_count: number;
      }>(healthQuery, ...params, limit, offset);

      // Get total count
      const countQuery = `
        SELECT COUNT(DISTINCT ch.canister_id) as count
        FROM canister_health ch
        JOIN tokens t ON ch.token_id = t.id
        WHERE ${whereClause}
      `;
      const totalRow = await monitoringDB.rawQueryRow<{ count: number }>(countQuery, ...params);
      const total = totalRow?.count ?? 0;

      // Transform results
      const canisters: CanisterHealthMetrics[] = healthRows.map(row => ({
        canisterId: row.canister_id,
        tokenId: row.token_id,
        tokenName: row.token_name,
        symbol: row.symbol,
        status: row.status,
        cycleBalance: row.cycle_balance,
        memorySize: row.memory_size,
        uptimePercentage: row.uptime_percentage,
        lastCheck: row.last_check,
        responseTimeMs: row.response_time_ms,
        errorCount: row.error_count,
        alertCount: row.alert_count,
      }));

      // Calculate summary
      const healthyCanisters = canisters.filter(c => 
        c.status === 'running' && c.uptimePercentage >= 95 && c.alertCount === 0
      ).length;
      const unhealthyCanisters = canisters.length - healthyCanisters;
      const averageUptimePercentage = canisters.length > 0
        ? canisters.reduce((sum, c) => sum + c.uptimePercentage, 0) / canisters.length
        : 0;
      const totalCyclesBalance = canisters
        .reduce((sum, c) => sum + BigInt(c.cycleBalance), BigInt(0))
        .toString();

      const summary = {
        totalCanisters: canisters.length,
        healthyCanisters,
        unhealthyCanisters,
        averageUptimePercentage,
        totalCyclesBalance,
      };

      return { canisters, total, summary };
    } catch (error) {
      return handleError(error as Error, "monitoring.getCanisterHealth");
    }
  })
);

export interface TransactionSuccessMetrics {
  canisterId: string;
  tokenId: number;
  tokenName: string;
  symbol: string;
  date: Date;
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  successRate: number;
  averageResponseTime: number;
}

export interface GetTransactionMetricsRequest {
  canisterId?: string;
  tokenId?: number;
  days?: Query<number>;
}

export interface GetTransactionMetricsResponse {
  metrics: TransactionSuccessMetrics[];
  summary: {
    totalTransactions: number;
    totalSuccessful: number;
    totalFailed: number;
    overallSuccessRate: number;
    averageResponseTime: number;
  };
}

// Retrieves transaction success rates and performance metrics.
export const getTransactionMetrics = api<GetTransactionMetricsRequest, GetTransactionMetricsResponse>(
  { expose: true, method: "GET", path: "/monitoring/transactions" },
  monitor("monitoring.getTransactionMetrics", async (req) => {
    try {
      const days = req.days ?? 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      let whereConditions = [`tm.date_recorded >= '${startDate.toISOString().split('T')[0]}'`];
      const params: any[] = [];

      if (req.canisterId) {
        whereConditions.push(`tm.canister_id = $${params.length + 1}`);
        params.push(req.canisterId);
      }

      if (req.tokenId) {
        whereConditions.push(`tm.token_id = $${params.length + 1}`);
        params.push(req.tokenId);
      }

      const whereClause = whereConditions.join(" AND ");

      const metricsQuery = `
        SELECT 
          tm.canister_id, tm.token_id, tm.date_recorded,
          tm.total_transactions, tm.successful_transactions, tm.failed_transactions,
          tm.average_response_time_ms,
          t.token_name, t.symbol,
          CASE 
            WHEN tm.total_transactions > 0 
            THEN (tm.successful_transactions::float / tm.total_transactions::float) * 100
            ELSE 0
          END as success_rate
        FROM transaction_metrics tm
        JOIN tokens t ON tm.token_id = t.id
        WHERE ${whereClause}
        ORDER BY tm.date_recorded DESC, tm.canister_id
      `;

      const metricsRows = await monitoringDB.rawQueryAll<{
        canister_id: string;
        token_id: number;
        token_name: string;
        symbol: string;
        date_recorded: Date;
        total_transactions: number;
        successful_transactions: number;
        failed_transactions: number;
        average_response_time_ms: number;
        success_rate: number;
      }>(metricsQuery, ...params);

      const metrics: TransactionSuccessMetrics[] = metricsRows.map(row => ({
        canisterId: row.canister_id,
        tokenId: row.token_id,
        tokenName: row.token_name,
        symbol: row.symbol,
        date: row.date_recorded,
        totalTransactions: row.total_transactions,
        successfulTransactions: row.successful_transactions,
        failedTransactions: row.failed_transactions,
        successRate: row.success_rate,
        averageResponseTime: row.average_response_time_ms,
      }));

      // Calculate summary
      const totalTransactions = metrics.reduce((sum, m) => sum + m.totalTransactions, 0);
      const totalSuccessful = metrics.reduce((sum, m) => sum + m.successfulTransactions, 0);
      const totalFailed = metrics.reduce((sum, m) => sum + m.failedTransactions, 0);
      const overallSuccessRate = totalTransactions > 0 ? (totalSuccessful / totalTransactions) * 100 : 0;
      const averageResponseTime = metrics.length > 0
        ? metrics.reduce((sum, m) => sum + m.averageResponseTime, 0) / metrics.length
        : 0;

      const summary = {
        totalTransactions,
        totalSuccessful,
        totalFailed,
        overallSuccessRate,
        averageResponseTime,
      };

      return { metrics, summary };
    } catch (error) {
      return handleError(error as Error, "monitoring.getTransactionMetrics");
    }
  })
);

export interface MonitoringAlert {
  id: number;
  canisterId: string;
  tokenId: number;
  tokenName: string;
  symbol: string;
  alertType: string;
  severity: string;
  title: string;
  message: string;
  metadata?: any;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  createdAt: Date;
}

export interface GetAlertsRequest {
  severity?: Query<string>;
  acknowledged?: Query<boolean>;
  limit?: Query<number>;
  offset?: Query<number>;
}

export interface GetAlertsResponse {
  alerts: MonitoringAlert[];
  total: number;
  summary: {
    totalAlerts: number;
    criticalAlerts: number;
    warningAlerts: number;
    acknowledgedAlerts: number;
  };
}

// Retrieves monitoring alerts with filtering options.
export const getAlerts = api<GetAlertsRequest, GetAlertsResponse>(
  { expose: true, method: "GET", path: "/monitoring/alerts" },
  monitor("monitoring.getAlerts", async (req) => {
    try {
      const limit = req.limit ?? 50;
      const offset = req.offset ?? 0;

      let whereConditions = ["1=1"];
      const params: any[] = [];

      if (req.severity) {
        whereConditions.push(`ma.severity = $${params.length + 1}`);
        params.push(req.severity);
      }

      if (req.acknowledged !== undefined) {
        whereConditions.push(`ma.acknowledged = $${params.length + 1}`);
        params.push(req.acknowledged);
      }

      const whereClause = whereConditions.join(" AND ");

      const alertsQuery = `
        SELECT 
          ma.id, ma.canister_id, ma.token_id, ma.alert_type, ma.severity,
          ma.title, ma.message, ma.metadata, ma.acknowledged,
          ma.acknowledged_by, ma.acknowledged_at, ma.created_at,
          t.token_name, t.symbol
        FROM monitoring_alerts ma
        JOIN tokens t ON ma.token_id = t.id
        WHERE ${whereClause}
        ORDER BY ma.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;

      const alertRows = await monitoringDB.rawQueryAll<{
        id: number;
        canister_id: string;
        token_id: number;
        token_name: string;
        symbol: string;
        alert_type: string;
        severity: string;
        title: string;
        message: string;
        metadata: any;
        acknowledged: boolean;
        acknowledged_by?: string;
        acknowledged_at?: Date;
        created_at: Date;
      }>(alertsQuery, ...params, limit, offset);

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as count
        FROM monitoring_alerts ma
        JOIN tokens t ON ma.token_id = t.id
        WHERE ${whereClause}
      `;
      const totalRow = await monitoringDB.rawQueryRow<{ count: number }>(countQuery, ...params);
      const total = totalRow?.count ?? 0;

      const alerts: MonitoringAlert[] = alertRows.map(row => ({
        id: row.id,
        canisterId: row.canister_id,
        tokenId: row.token_id,
        tokenName: row.token_name,
        symbol: row.symbol,
        alertType: row.alert_type,
        severity: row.severity,
        title: row.title,
        message: row.message,
        metadata: row.metadata,
        acknowledged: row.acknowledged,
        acknowledgedBy: row.acknowledged_by,
        acknowledgedAt: row.acknowledged_at,
        createdAt: row.created_at,
      }));

      // Calculate summary
      const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
      const warningAlerts = alerts.filter(a => a.severity === 'warning').length;
      const acknowledgedAlerts = alerts.filter(a => a.acknowledged).length;

      const summary = {
        totalAlerts: alerts.length,
        criticalAlerts,
        warningAlerts,
        acknowledgedAlerts,
      };

      return { alerts, total, summary };
    } catch (error) {
      return handleError(error as Error, "monitoring.getAlerts");
    }
  })
);

export interface AcknowledgeAlertRequest {
  alertId: number;
  acknowledgedBy: string;
}

export interface AcknowledgeAlertResponse {
  success: boolean;
  message: string;
}

// Acknowledges a monitoring alert.
export const acknowledgeAlert = api<AcknowledgeAlertRequest, AcknowledgeAlertResponse>(
  { expose: true, method: "POST", path: "/monitoring/alerts/:alertId/acknowledge" },
  monitor("monitoring.acknowledgeAlert", async (req) => {
    try {
      validate()
        .required(req.alertId, "alertId")
        .number(req.alertId, "alertId", { min: 1, integer: true })
        .required(req.acknowledgedBy, "acknowledgedBy")
        .string(req.acknowledgedBy, "acknowledgedBy", { minLength: 1 })
        .throwIfInvalid();

      const result = await monitoringDB.exec`
        UPDATE monitoring_alerts
        SET acknowledged = true, acknowledged_by = ${req.acknowledgedBy}, acknowledged_at = NOW()
        WHERE id = ${req.alertId} AND acknowledged = false
      `;

      return {
        success: true,
        message: "Alert acknowledged successfully"
      };
    } catch (error) {
      return handleError(error as Error, "monitoring.acknowledgeAlert");
    }
  })
);

export interface MonitoringConfig {
  canisterId: string;
  tokenId: number;
  checkIntervalMinutes: number;
  cycleWarningThreshold: string;
  cycleCriticalThreshold: string;
  enabled: boolean;
}

export interface GetMonitoringConfigRequest {
  canisterId?: string;
  tokenId?: number;
}

export interface GetMonitoringConfigResponse {
  configs: MonitoringConfig[];
}

// Retrieves monitoring configuration for canisters.
export const getMonitoringConfig = api<GetMonitoringConfigRequest, GetMonitoringConfigResponse>(
  { expose: true, method: "GET", path: "/monitoring/config" },
  monitor("monitoring.getMonitoringConfig", async (req) => {
    try {
      let whereConditions = ["1=1"];
      const params: any[] = [];

      if (req.canisterId) {
        whereConditions.push(`canister_id = $${params.length + 1}`);
        params.push(req.canisterId);
      }

      if (req.tokenId) {
        whereConditions.push(`token_id = $${params.length + 1}`);
        params.push(req.tokenId);
      }

      const whereClause = whereConditions.join(" AND ");

      const configQuery = `
        SELECT 
          canister_id, token_id, check_interval_minutes,
          cycle_warning_threshold, cycle_critical_threshold, enabled
        FROM health_check_config
        WHERE ${whereClause}
        ORDER BY created_at DESC
      `;

      const configRows = await monitoringDB.rawQueryAll<{
        canister_id: string;
        token_id: number;
        check_interval_minutes: number;
        cycle_warning_threshold: string;
        cycle_critical_threshold: string;
        enabled: boolean;
      }>(configQuery, ...params);

      const configs: MonitoringConfig[] = configRows.map(row => ({
        canisterId: row.canister_id,
        tokenId: row.token_id,
        checkIntervalMinutes: row.check_interval_minutes,
        cycleWarningThreshold: row.cycle_warning_threshold,
        cycleCriticalThreshold: row.cycle_critical_threshold,
        enabled: row.enabled,
      }));

      return { configs };
    } catch (error) {
      return handleError(error as Error, "monitoring.getMonitoringConfig");
    }
  })
);

export interface UpdateMonitoringConfigRequest {
  canisterId: string;
  checkIntervalMinutes?: number;
  cycleWarningThreshold?: string;
  cycleCriticalThreshold?: string;
  enabled?: boolean;
}

export interface UpdateMonitoringConfigResponse {
  success: boolean;
  message: string;
}

// Updates monitoring configuration for a canister.
export const updateMonitoringConfig = api<UpdateMonitoringConfigRequest, UpdateMonitoringConfigResponse>(
  { expose: true, method: "PUT", path: "/monitoring/config/:canisterId" },
  monitor("monitoring.updateMonitoringConfig", async (req) => {
    try {
      validate()
        .required(req.canisterId, "canisterId")
        .string(req.canisterId, "canisterId", { minLength: 1 })
        .throwIfInvalid();

      // Verify canister exists
      const token = await tokenDB.queryRow`
        SELECT id FROM tokens WHERE canister_id = ${req.canisterId}
      `;

      if (!token) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, "Canister not found");
      }

      let updateFields = [];
      let params = [];

      if (req.checkIntervalMinutes !== undefined) {
        updateFields.push(`check_interval_minutes = $${params.length + 1}`);
        params.push(req.checkIntervalMinutes);
      }

      if (req.cycleWarningThreshold !== undefined) {
        updateFields.push(`cycle_warning_threshold = $${params.length + 1}`);
        params.push(req.cycleWarningThreshold);
      }

      if (req.cycleCriticalThreshold !== undefined) {
        updateFields.push(`cycle_critical_threshold = $${params.length + 1}`);
        params.push(req.cycleCriticalThreshold);
      }

      if (req.enabled !== undefined) {
        updateFields.push(`enabled = $${params.length + 1}`);
        params.push(req.enabled);
      }

      if (updateFields.length === 0) {
        return { success: true, message: "No changes to update" };
      }

      const updateQuery = `
        INSERT INTO health_check_config (canister_id, token_id, ${updateFields.map((_, i) => updateFields[i].split(' = ')[0]).join(', ')})
        VALUES ($${params.length + 1}, $${params.length + 2}, ${params.map((_, i) => '$' + (i + 1)).join(', ')})
        ON CONFLICT (canister_id)
        DO UPDATE SET ${updateFields.join(', ')}
      `;

      await monitoringDB.rawExec(updateQuery, ...params, req.canisterId, token.id);

      log.info("Monitoring config updated", {
        canisterId: req.canisterId,
        tokenId: token.id,
        updates: Object.keys(req).filter(key => key !== 'canisterId')
      });

      return {
        success: true,
        message: "Monitoring configuration updated successfully"
      };
    } catch (error) {
      return handleError(error as Error, "monitoring.updateMonitoringConfig");
    }
  })
);

export interface PerformanceMetrics {
  canisterId: string;
  tokenId: number;
  tokenName: string;
  symbol: string;
  metricType: string;
  metricValue: number;
  measurementTime: Date;
  metadata?: any;
}

export interface GetPerformanceMetricsRequest {
  canisterId?: string;
  tokenId?: number;
  metricType?: Query<string>;
  hours?: Query<number>;
}

export interface GetPerformanceMetricsResponse {
  metrics: PerformanceMetrics[];
  summary: {
    averageResponseTime: number;
    averageErrorRate: number;
    averageThroughput: number;
  };
}

// Retrieves performance metrics for canisters.
export const getPerformanceMetrics = api<GetPerformanceMetricsRequest, GetPerformanceMetricsResponse>(
  { expose: true, method: "GET", path: "/monitoring/performance" },
  monitor("monitoring.getPerformanceMetrics", async (req) => {
    try {
      const hours = req.hours ?? 24;
      const startTime = new Date();
      startTime.setHours(startTime.getHours() - hours);

      let whereConditions = [`pm.measurement_time >= '${startTime.toISOString()}'`];
      const params: any[] = [];

      if (req.canisterId) {
        whereConditions.push(`pm.canister_id = $${params.length + 1}`);
        params.push(req.canisterId);
      }

      if (req.tokenId) {
        whereConditions.push(`pm.token_id = $${params.length + 1}`);
        params.push(req.tokenId);
      }

      if (req.metricType) {
        whereConditions.push(`pm.metric_type = $${params.length + 1}`);
        params.push(req.metricType);
      }

      const whereClause = whereConditions.join(" AND ");

      const metricsQuery = `
        SELECT 
          pm.canister_id, pm.token_id, pm.metric_type, pm.metric_value,
          pm.measurement_time, pm.metadata,
          t.token_name, t.symbol
        FROM performance_metrics pm
        JOIN tokens t ON pm.token_id = t.id
        WHERE ${whereClause}
        ORDER BY pm.measurement_time DESC
      `;

      const metricsRows = await monitoringDB.rawQueryAll<{
        canister_id: string;
        token_id: number;
        token_name: string;
        symbol: string;
        metric_type: string;
        metric_value: number;
        measurement_time: Date;
        metadata: any;
      }>(metricsQuery, ...params);

      const metrics: PerformanceMetrics[] = metricsRows.map(row => ({
        canisterId: row.canister_id,
        tokenId: row.token_id,
        tokenName: row.token_name,
        symbol: row.symbol,
        metricType: row.metric_type,
        metricValue: row.metric_value,
        measurementTime: row.measurement_time,
        metadata: row.metadata,
      }));

      // Calculate summary
      const responseTimeMetrics = metrics.filter(m => m.metricType === 'response_time');
      const errorRateMetrics = metrics.filter(m => m.metricType === 'error_rate');
      const throughputMetrics = metrics.filter(m => m.metricType === 'throughput');

      const averageResponseTime = responseTimeMetrics.length > 0
        ? responseTimeMetrics.reduce((sum, m) => sum + m.metricValue, 0) / responseTimeMetrics.length
        : 0;

      const averageErrorRate = errorRateMetrics.length > 0
        ? errorRateMetrics.reduce((sum, m) => sum + m.metricValue, 0) / errorRateMetrics.length
        : 0;

      const averageThroughput = throughputMetrics.length > 0
        ? throughputMetrics.reduce((sum, m) => sum + m.metricValue, 0) / throughputMetrics.length
        : 0;

      const summary = {
        averageResponseTime,
        averageErrorRate,
        averageThroughput,
      };

      return { metrics, summary };
    } catch (error) {
      return handleError(error as Error, "monitoring.getPerformanceMetrics");
    }
  })
);

// Initialize monitoring for a new token canister
export async function initializeMonitoring(tokenId: number, canisterId: string): Promise<void> {
  try {
    // Create default monitoring configuration
    await monitoringDB.exec`
      INSERT INTO health_check_config (canister_id, token_id, enabled)
      VALUES (${canisterId}, ${tokenId}, true)
      ON CONFLICT (canister_id) DO NOTHING
    `;

    log.info("Monitoring initialized for canister", {
      tokenId,
      canisterId
    });
  } catch (error) {
    log.error("Failed to initialize monitoring", {
      tokenId,
      canisterId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
