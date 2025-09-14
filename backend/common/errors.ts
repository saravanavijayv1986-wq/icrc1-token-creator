import { APIError } from "encore.dev/api";
import log from "encore.dev/log";
import { captureException } from "./sentry";

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
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: any,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleError(error: Error, context: string): never {
  // Capture to Sentry first to preserve stack/context (avoids leaking sensitive values).
  captureException(error, {
    context,
    ...(error instanceof AppError
      ? { app_code: error.code, details: safeDetails(error.details) }
      : {}),
  });

  // Log sanitized error (avoid logging raw request payloads or secrets in details).
  log.error(`Error in ${context}:`, {
    error: error.message,
    stack: error.stack,
    ...(error instanceof AppError ? { code: error.code, details: safeDetails(error.details) } : {})
  });

  // Convert to appropriate API error
  if (error instanceof AppError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_ERROR:
        throw APIError.invalidArgument(error.message, safeDetails(error.details));
      case ErrorCode.RESOURCE_NOT_FOUND:
        throw APIError.notFound(error.message, safeDetails(error.details));
      case ErrorCode.UNAUTHORIZED_ACCESS:
        throw APIError.permissionDenied(error.message, safeDetails(error.details));
      case ErrorCode.RATE_LIMIT_EXCEEDED:
        throw APIError.resourceExhausted(error.message, safeDetails(error.details));
      case ErrorCode.INSUFFICIENT_FUNDS:
        throw APIError.failedPrecondition(error.message, safeDetails(error.details));
      default:
        throw APIError.internal(error.message, safeDetails(error.details));
    }
  }

  // Generic error handling
  throw APIError.internal("An unexpected error occurred", { originalError: error.message });
}

function safeDetails(details: unknown): unknown {
  // Basic scrubbing: remove keys commonly containing sensitive content
  if (!details || typeof details !== "object") return details;
  const banned = ["authorization", "token", "password", "secret", "delegationIdentity", "wasm_module", "arg"];
  const clone: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details as Record<string, unknown>)) {
    if (banned.includes(k)) {
      clone[k] = "[REDACTED]";
    } else if (v && typeof v === "object") {
      clone[k] = "[object]";
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
