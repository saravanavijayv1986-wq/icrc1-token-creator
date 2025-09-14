import { toast } from "@/components/ui/use-toast";

export interface ApiError {
  code: string;
  message: string;
  details?: any;
}

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleApiError(error: any): never {
  console.error('API Error:', error);

  let code = 'UNKNOWN_ERROR';
  let message = 'An unexpected error occurred';
  let details = null;

  if (error?.response?.data) {
    const errorData = error.response.data;
    code = errorData.code || 'API_ERROR';
    message = errorData.message || 'API request failed';
    details = errorData.details;
  } else if (error instanceof Error) {
    message = error.message;
  }

  toast({
    title: "Error",
    description: getUserFriendlyMessage(code, message),
    variant: "destructive",
  });

  throw new AppError(code, message, details);
}

function getUserFriendlyMessage(code: string, originalMessage: string): string {
  const friendlyMessages: Record<string, string> = {
    'VALIDATION_ERROR': 'Please check your input and try again.',
    'RESOURCE_NOT_FOUND': 'The requested resource was not found.',
    'UNAUTHORIZED_ACCESS': 'You do not have permission to perform this action.',
    'RATE_LIMIT_EXCEEDED': 'Too many requests. Please wait a moment and try again.',
    'INSUFFICIENT_FUNDS': 'Insufficient funds for this operation.',
    'TOKEN_DEPLOYMENT_FAILED': 'Token deployment failed. Please try again.',
    'INVALID_DELEGATION': 'Authentication expired. Please reconnect your wallet.',
    'CANISTER_ERROR': 'Blockchain operation failed. Please try again.',
    'EXTERNAL_SERVICE_ERROR': 'External service is temporarily unavailable.',
    'BLOCKCHAIN_ERROR': 'Blockchain network error. Please try again later.',
  };

  return friendlyMessages[code] || originalMessage;
}

export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      
      console.error('Operation failed:', error);
      
      const message = error instanceof Error ? error.message : String(error);
      
      toast({
        title: "Operation Failed",
        description: message,
        variant: "destructive",
      });
      
      throw new AppError('OPERATION_FAILED', message);
    }
  };
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt === maxRetries) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, attempt - 1)));
    }
  }

  throw lastError!;
}
