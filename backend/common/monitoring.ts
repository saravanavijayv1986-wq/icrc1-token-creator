import log from "encore.dev/log";

export interface MetricData {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: Date;
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private metrics: MetricData[] = [];

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

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
    const metric: MetricData = {
      name,
      value,
      tags,
      timestamp: new Date()
    };

    this.metrics.push(metric);
    
    // Log metric for external monitoring systems
    log.info("Metric recorded", {
      metric: name,
      value,
      tags
    });

    // Keep only last 1000 metrics in memory
    if (this.metrics.length > 1000) {
      this.metrics = this.metrics.slice(-1000);
    }
  }

  getMetrics(): MetricData[] {
    return [...this.metrics];
  }

  clearMetrics(): void {
    this.metrics = [];
  }
}

export const metrics = MetricsCollector.getInstance();

// Performance monitoring decorator
export function monitor(metricName: string) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const tags = { method: propertyName };
      
      try {
        metrics.increment(`${metricName}.started`, tags);
        const result = await method.apply(this, args);
        metrics.increment(`${metricName}.success`, tags);
        return result;
      } catch (error) {
        metrics.increment(`${metricName}.error`, tags);
        throw error;
      } finally {
        const duration = Date.now() - startTime;
        metrics.timing(metricName, duration, tags);
      }
    };
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
