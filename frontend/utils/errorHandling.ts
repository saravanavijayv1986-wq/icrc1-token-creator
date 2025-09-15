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
    
    // Extract specific error codes from error messages
    if (message.includes('principal format') || message.includes('Invalid principal')) {
      code = 'INVALID_PRINCIPAL_FORMAT';
    } else if (message.includes('delegation') || message.includes('authentication')) {
      code = 'AUTHENTICATION_ERROR';
    } else if (message.includes('network') || message.includes('fetch')) {
      code = 'NETWORK_ERROR';
    } else if (message.includes('timeout')) {
      code = 'TIMEOUT_ERROR';
    }
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
    'AUTHENTICATION_ERROR': 'Authentication failed. Please reconnect your wallet and try again.',
    'INVALID_PRINCIPAL_FORMAT': 'Invalid wallet address format. Please reconnect your wallet to refresh your identity.',
    'NETWORK_ERROR': 'Network connection error. Please check your internet connection and try again.',
    'TIMEOUT_ERROR': 'Request timed out. Please try again.',
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
      
      // Don't show toast for specific authentication errors that should be handled upstream
      if (!message.includes('Wallet not connected') && 
          !message.includes('Authentication expired')) {
        toast({
          title: "Operation Failed",
          description: getUserFriendlyMessage('OPERATION_FAILED', message),
          variant: "destructive",
        });
      }
      
      throw new AppError('OPERATION_FAILED', message);
    }
  };
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry certain types of errors
      const message = lastError.message.toLowerCase();
      if (message.includes('authentication') ||
          message.includes('delegation') ||
          message.includes('unauthorized') ||
          message.includes('invalid principal') ||
          message.includes('permission denied')) {
        break;
      }
      
      if (attempt === maxRetries) {
        break;
      }

      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}
