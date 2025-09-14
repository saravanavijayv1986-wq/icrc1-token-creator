import log from "encore.dev/log";
import { captureException } from "./sentry";

// Structured logging levels
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

// Operation types for structured logging
export enum OperationType {
  TOKEN_CREATION = "token_creation",
  TOKEN_DEPLOYMENT = "token_deployment",
  TOKEN_MINT = "token_mint",
  TOKEN_BURN = "token_burn",
  TOKEN_TRANSFER = "token_transfer",
  WALLET_CONNECT = "wallet_connect",
  WALLET_DISCONNECT = "wallet_disconnect",
  CANISTER_DEPLOY = "canister_deploy",
  CANISTER_STATUS = "canister_status",
  RATE_LIMIT = "rate_limit",
  VALIDATION = "validation",
  HEALTH_CHECK = "health_check",
  ANALYTICS = "analytics",
  MONITORING = "monitoring",
  ICP_TRANSFER = "icp_transfer",
  BALANCE_QUERY = "balance_query",
  AUTHENTICATION = "authentication",
}

// Sanitized context for logging
export interface LogContext {
  operationType: OperationType;
  operationId?: string;
  userId?: string; // Hashed or sanitized user ID
  tokenId?: number;
  canisterId?: string;
  amount?: string;
  duration?: number;
  success?: boolean;
  errorCode?: string;
  metadata?: Record<string, any>;
}

// Sensitive data patterns to sanitize
const SENSITIVE_PATTERNS = [
  /delegationIdentity/i,
  /delegation/i,
  /privateKey/i,
  /secretKey/i,
  /password/i,
  /token/i,
  /authorization/i,
  /bearer/i,
  /signature/i,
  /identity/i,
  /wasm_module/i,
];

const SENSITIVE_KEYS = [
  "delegationIdentity",
  "delegation",
  "privateKey",
  "secretKey",
  "sk",
  "password",
  "authorization",
  "token",
  "bearer",
  "signature",
  "identity",
  "wasm_module",
  "arg",
];

class StructuredLogger {
  private sanitizeValue(value: any): any {
    if (value === null || value === undefined) {
      return value;
    }

    if (typeof value === "string") {
      // Check for sensitive patterns
      for (const pattern of SENSITIVE_PATTERNS) {
        if (pattern.test(value)) {
          return "[REDACTED_SENSITIVE_STRING]";
        }
      }
      
      // Redact long strings that might contain sensitive data
      if (value.length > 1000) {
        return `[LONG_STRING_${value.length}_CHARS]`;
      }
      
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map(item => this.sanitizeValue(item));
    }

    if (typeof value === "object") {
      const sanitized: Record<string, any> = {};
      
      for (const [key, val] of Object.entries(value)) {
        // Check if key is sensitive
        if (SENSITIVE_KEYS.some(sensitiveKey => 
          key.toLowerCase().includes(sensitiveKey.toLowerCase())
        )) {
          sanitized[key] = "[REDACTED]";
          continue;
        }
        
        // Check if key contains patterns that suggest sensitive data
        if (SENSITIVE_PATTERNS.some(pattern => pattern.test(key))) {
          sanitized[key] = "[REDACTED]";
          continue;
        }
        
        sanitized[key] = this.sanitizeValue(val);
      }
      
      return sanitized;
    }

    return "[UNKNOWN_TYPE]";
  }

  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private hashUserId(principal?: string): string | undefined {
    if (!principal) return undefined;
    
    // Simple hash for user identification without exposing actual principal
    let hash = 0;
    for (let i = 0; i < principal.length; i++) {
      const char = principal.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return `user_${Math.abs(hash).toString(36)}`;
  }

  debug(message: string, context?: Partial<LogContext>): void {
    this.logWithLevel(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: Partial<LogContext>): void {
    this.logWithLevel(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: Partial<LogContext>): void {
    this.logWithLevel(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: Partial<LogContext>): void {
    this.logWithLevel(LogLevel.ERROR, message, {
      ...context,
      success: false,
      errorCode: error?.name || "UNKNOWN_ERROR",
    });

    // Send to error tracking
    if (error) {
      captureException(error, {
        level: "error",
        tags: {
          operationType: context?.operationType,
          operationId: context?.operationId,
        },
        extra: this.sanitizeValue(context),
      });
    }
  }

  // Log the start of an operation
  startOperation(
    operationType: OperationType,
    message: string,
    context?: Partial<LogContext>
  ): string {
    const operationId = this.generateOperationId();
    
    this.info(`Started: ${message}`, {
      ...context,
      operationType,
      operationId,
    });
    
    return operationId;
  }

  // Log the completion of an operation
  completeOperation(
    operationId: string,
    operationType: OperationType,
    message: string,
    success: boolean,
    duration?: number,
    context?: Partial<LogContext>
  ): void {
    const level = success ? LogLevel.INFO : LogLevel.ERROR;
    
    this.logWithLevel(level, `Completed: ${message}`, {
      ...context,
      operationType,
      operationId,
      success,
      duration,
    });
  }

  private logWithLevel(level: LogLevel, message: string, context?: Partial<LogContext>): void {
    const sanitizedContext = context ? this.sanitizeValue({
      ...context,
      userId: context.userId || this.hashUserId(context.metadata?.principal),
      timestamp: new Date().toISOString(),
    }) : undefined;

    switch (level) {
      case LogLevel.DEBUG:
        log.info(`[DEBUG] ${message}`, sanitizedContext);
        break;
      case LogLevel.INFO:
        log.info(`[INFO] ${message}`, sanitizedContext);
        break;
      case LogLevel.WARN:
        log.warn(`[WARN] ${message}`, sanitizedContext);
        break;
      case LogLevel.ERROR:
        log.error(`[ERROR] ${message}`, sanitizedContext);
        break;
    }
  }
}

export const logger = new StructuredLogger();

// Helper function for timing operations
export function withTiming<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  return new Promise(async (resolve, reject) => {
    const startTime = Date.now();
    try {
      const result = await fn();
      const duration = Date.now() - startTime;
      resolve({ result, duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      reject({ error, duration });
    }
  });
}

// Higher-order function to wrap operations with structured logging
export function withOperationLogging<T extends any[], R>(
  operationType: OperationType,
  operationName: string,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const operationId = logger.startOperation(
      operationType,
      operationName,
      {
        metadata: { args: logger["sanitizeValue"](args) },
      }
    );

    try {
      const { result, duration } = await withTiming(() => fn(...args));
      
      logger.completeOperation(
        operationId,
        operationType,
        operationName,
        true,
        duration
      );
      
      return result;
    } catch (error) {
      const duration = (error as any).duration || 0;
      const actualError = (error as any).error || error;
      
      logger.completeOperation(
        operationId,
        operationType,
        operationName,
        false,
        duration,
        {
          errorCode: actualError instanceof Error ? actualError.name : "UNKNOWN_ERROR",
        }
      );
      
      throw actualError;
    }
  };
}
