import { APIError } from "encore.dev/api";
import log from "encore.dev/log";

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
  // Log the error with context
  log.error(`Error in ${context}:`, {
    error: error.message,
    stack: error.stack,
    ...(error instanceof AppError ? { code: error.code, details: error.details } : {})
  });

  // Convert to appropriate API error
  if (error instanceof AppError) {
    switch (error.code) {
      case ErrorCode.VALIDATION_ERROR:
        throw APIError.invalidArgument(error.message, error.details);
      case ErrorCode.RESOURCE_NOT_FOUND:
        throw APIError.notFound(error.message, error.details);
      case ErrorCode.UNAUTHORIZED_ACCESS:
        throw APIError.permissionDenied(error.message, error.details);
      case ErrorCode.RATE_LIMIT_EXCEEDED:
        throw APIError.resourceExhausted(error.message, error.details);
      case ErrorCode.INSUFFICIENT_FUNDS:
        throw APIError.failedPrecondition(error.message, error.details);
      default:
        throw APIError.internal(error.message, error.details);
    }
  }

  // Generic error handling
  throw APIError.internal("An unexpected error occurred", { originalError: error.message });
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
