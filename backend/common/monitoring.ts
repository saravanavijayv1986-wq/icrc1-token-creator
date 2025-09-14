import log from "encore.dev/log";
import { analyticsDB } from "../analytics/db";

export interface MetricData {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: Date;
}

class MetricsCollector {
  increment(name: string, tags?: Record<string, string>): void {
    this.record(name, 1, tags);
  }

  decrement(name: string, tags?: Record<string, string>): void {
    this.record(name, -1, tags);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    this.record(name, value, tags);
  }

  timing(name: string, durationMs: number, tags?: Record<string, string>): void {
    this.record(`${name}.duration`, durationMs, tags);
  }

  private record(name: string, value: number, tags?: Record<string, string>): void {
    const timestamp = new Date();

    // Persist metric to analytics.platform_metrics for auditability
    analyticsDB.exec`
      INSERT INTO platform_metrics (metric_name, metric_value, metric_tags, recorded_at)
      VALUES (${name}, ${value}, ${tags ?? null}, ${timestamp})
    `.catch((err) => {
      log.error("Failed to persist metric", { name, value, error: err instanceof Error ? err.message : String(err) });
    });

    // Additionally log for external sinks
    log.info("Metric recorded", { metric: name, value, timestamp });
  }
}

export const metrics = new MetricsCollector();

// Higher-order function to monitor an API handler with timings and counters
export function monitor<Params, Response>(
  metricName: string,
  fn: (params: Params) => Promise<Response>
): (params: Params) => Promise<Response> {
  return async (params: Params): Promise<Response> => {
    const startTime = Date.now();
    try {
      metrics.increment(`${metricName}.started`);
      const res = await fn(params);
      metrics.increment(`${metricName}.success`);
      return res;
    } catch (err) {
      metrics.increment(`${metricName}.error`);
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      metrics.timing(metricName, duration);
    }
  };
}

// Health check utilities
export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  checks: Record<string, {
    status: 'pass' | 'fail' | 'warn';
    message?: string;
    timestamp: Date;
  }>;
}

export class HealthChecker {
  private checks = new Map<string, () => Promise<{ status: 'pass' | 'fail' | 'warn'; message?: string }>>();

  addCheck(name: string, check: () => Promise<{ status: 'pass' | 'fail' | 'warn'; message?: string }>): void {
    this.checks.set(name, check);
  }

  async getHealth(): Promise<HealthStatus> {
    const checks: HealthStatus['checks'] = {};
    let overallStatus: HealthStatus['status'] = 'healthy';

    for (const [name, check] of this.checks) {
      try {
        const result = await check();
        checks[name] = {
          ...result,
          timestamp: new Date()
        };

        if (result.status === 'fail') {
          overallStatus = 'unhealthy';
        } else if (result.status === 'warn' && overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
      } catch (error) {
        checks[name] = {
          status: 'fail',
          message: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date()
        };
        overallStatus = 'unhealthy';
      }
    }

    return {
      status: overallStatus,
      checks
    };
  }
}

export const healthChecker = new HealthChecker();
