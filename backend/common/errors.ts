import { APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { captureException, addBreadcrumb } from "./sentry";
import { logger, OperationType } from "./logger";

export enum ErrorCode {
  VALIDATION_ERROR = "VALIDATION_ERROR",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  UNAUTHORIZED_ACCESS = "UNAUTHORIZED_ACCESS",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  EXTERNAL_SERVICE_ERROR = "EXTERNAL_SERVICE_ERROR",
  BLOCKCHAIN_ERROR = "BLOCKCHAIN_ERROR",
  INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS",
  TOKEN_DEPLOYMENT_FAILED = "TOKEN_DEPLOYMENT_FAILED",
  INVALID_DELEGATION = "INVALID_DELEGATION",
  CANISTER_ERROR = "CANISTER_ERROR"
}

export class AppError extends Error {
  public readonly isAppError = true;
  
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any,
    public statusCode: number = 500,
    public operationType?: OperationType,
    public operationId?: string
  ) {
    super(message);
    this.name = 'AppError';
    
    // Ensure proper prototype chain
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function handleError(
  error: Error, 
  context: string,
  operationType?: OperationType,
  operationId?: string
): never {
  // Add breadcrumb for error tracking
  addBreadcrumb(
    `Error in ${context}`,
    "error",
    "error",
    {
      context,
      operationType,
      operationId,
      errorType: error.constructor.name,
    }
  );

  // Determine if this is an AppError or needs to be wrapped
  let appError: AppError;
  
  if (error instanceof AppError) {
    appError = error;
    // Update operation context if not already set
    if (!appError.operationType && operationType) {
      appError.operationType = operationType;
    }
    if (!appError.operationId && operationId) {
      appError.operationId = operationId;
    }
  } else {
    // Wrap regular errors in AppError
    const errorCode = classifyError(error);
    appError = new AppError(
      errorCode,
      error.message,
      { originalError: error.name },
      getStatusCodeForError(errorCode),
      operationType,
      operationId
    );
  }

  // Capture to Sentry with sanitized context
  captureException(appError, {
    level: "error",
    tags: {
      errorCode: appError.code,
      context,
      operationType: appError.operationType || "unknown",
    },
    extra: {
      operationId: appError.operationId,
      statusCode: appError.statusCode,
      details: safeDetails(appError.details),
    },
    fingerprint: [appError.code, context],
  });

  // Log with structured logging
  logger.error(
    `Error in ${context}: ${appError.message}`,
    appError,
    {
      operationType: appError.operationType,
      operationId: appError.operationId,
      errorCode: appError.code,
    }
  );

  // Convert to appropriate API error
  switch (appError.code) {
    case ErrorCode.VALIDATION_ERROR:
      throw APIError.invalidArgument(appError.message, safeDetails(appError.details));
    case ErrorCode.RESOURCE_NOT_FOUND:
      throw APIError.notFound(appError.message, safeDetails(appError.details));
    case ErrorCode.UNAUTHORIZED_ACCESS:
      throw APIError.permissionDenied(appError.message, safeDetails(appError.details));
    case ErrorCode.RATE_LIMIT_EXCEEDED:
      throw APIError.resourceExhausted(appError.message, safeDetails(appError.details));
    case ErrorCode.INSUFFICIENT_FUNDS:
      throw APIError.failedPrecondition(appError.message, safeDetails(appError.details));
    default:
      throw APIError.internal(appError.message, safeDetails(appError.details));
  }
}

function classifyError(error: Error): ErrorCode {
  const message = error.message.toLowerCase();
  
  if (message.includes("validation") || message.includes("invalid")) {
    return ErrorCode.VALIDATION_ERROR;
  }
  if (message.includes("not found") || message.includes("does not exist")) {
    return ErrorCode.RESOURCE_NOT_FOUND;
  }
  if (message.includes("unauthorized") || message.includes("permission denied")) {
    return ErrorCode.UNAUTHORIZED_ACCESS;
  }
  if (message.includes("rate limit") || message.includes("too many requests")) {
    return ErrorCode.RATE_LIMIT_EXCEEDED;
  }
  if (message.includes("insufficient") || message.includes("balance")) {
    return ErrorCode.INSUFFICIENT_FUNDS;
  }
  if (message.includes("delegation") || message.includes("identity")) {
    return ErrorCode.INVALID_DELEGATION;
  }
  if (message.includes("canister") || message.includes("replica")) {
    return ErrorCode.CANISTER_ERROR;
  }
  if (message.includes("network") || message.includes("connection")) {
    return ErrorCode.EXTERNAL_SERVICE_ERROR;
  }
  if (message.includes("blockchain") || message.includes("ic") || message.includes("icp")) {
    return ErrorCode.BLOCKCHAIN_ERROR;
  }
  
  return ErrorCode.EXTERNAL_SERVICE_ERROR;
}

function getStatusCodeForError(errorCode: ErrorCode): number {
  switch (errorCode) {
    case ErrorCode.VALIDATION_ERROR:
      return 400;
    case ErrorCode.UNAUTHORIZED_ACCESS:
      return 403;
    case ErrorCode.RESOURCE_NOT_FOUND:
      return 404;
    case ErrorCode.RATE_LIMIT_EXCEEDED:
      return 429;
    case ErrorCode.INSUFFICIENT_FUNDS:
    case ErrorCode.INVALID_DELEGATION:
      return 412;
    default:
      return 500;
  }
}

function safeDetails(details: unknown): unknown {
  if (!details || typeof details !== "object") return details;
  
  // List of keys that commonly contain sensitive content
  const sensitiveKeys = [
    "authorization", "token", "password", "secret", "delegationIdentity", 
    "delegation", "wasm_module", "arg", "privateKey", "secretKey", "identity",
    "bearer", "signature", "sk"
  ];
  
  const clone: Record<string, unknown> = {};
  
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (sensitiveKeys.some(sensitiveKey => k.toLowerCase().includes(sensitiveKey.toLowerCase()))) {
      clone[k] = "[REDACTED]";
    } else if (v && typeof v === "object") {
      clone[k] = "[OBJECT]";
    } else if (typeof v === "string" && v.length > 1000) {
      clone[k] = `[LARGE_STRING_${v.length}_CHARS]`;
    } else {
      clone[k] = v;
    }
  }
  
  return clone;
}

export function validateInput<T>(data: any, schema: any): T {
  try {
    // In production, use a proper validation library like Zod or Joi
    return data as T;
  } catch (error) {
    throw new AppError(
      ErrorCode.VALIDATION_ERROR,
      "Invalid input data",
      { validation: error }
    );
  }
}

// Helper to create context-aware errors
export function createAppError(
  code: ErrorCode,
  message: string,
  details?: any,
  operationType?: OperationType,
  operationId?: string
): AppError {
  return new AppError(code, message, details, getStatusCodeForError(code), operationType, operationId);
}

// Helper to wrap functions with error context
export function withErrorContext<T extends any[], R>(
  context: string,
  operationType: OperationType,
  fn: (...args: T) => Promise<R>
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    const operationId = `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Error) {
        return handleError(error, context, operationType, operationId);
      }
      throw error;
    }
  };
}
