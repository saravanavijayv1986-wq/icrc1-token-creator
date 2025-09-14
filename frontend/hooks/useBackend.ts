import { useCallback } from "react";
import { useWallet } from "./useWallet";
import backend from "~backend/client";
import { withErrorHandling, withRetry } from "../utils/errorHandling";

function icpToE8s(amount: string | number): bigint {
  const str = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error("Invalid ICP amount");
  }
  const [intPart, fracPart = ""] = str.split(".");
  const fracPadded = (fracPart + "00000000").slice(0, 8);
  return BigInt(intPart) * 100000000n + BigInt(fracPadded);
}

// Enhanced principal validation with specific error types
enum PrincipalValidationError {
  EMPTY = "EMPTY",
  INVALID_TYPE = "INVALID_TYPE", 
  TOO_SHORT = "TOO_SHORT",
  TOO_LONG = "TOO_LONG",
  INVALID_FORMAT = "INVALID_FORMAT",
  INVALID_CHECKSUM = "INVALID_CHECKSUM"
}

interface PrincipalValidationResult {
  isValid: boolean;
  error?: PrincipalValidationError;
  message?: string;
}

function validatePrincipal(principal: string): PrincipalValidationResult {
  if (!principal) {
    return {
      isValid: false,
      error: PrincipalValidationError.EMPTY,
      message: "Principal cannot be empty"
    };
  }
  
  if (typeof principal !== 'string') {
    return {
      isValid: false,
      error: PrincipalValidationError.INVALID_TYPE,
      message: "Principal must be a string"
    };
  }
  
  // Basic length validation
  if (principal.length < 5) {
    return {
      isValid: false,
      error: PrincipalValidationError.TOO_SHORT,
      message: "Principal is too short"
    };
  }
  
  if (principal.length > 63) {
    return {
      isValid: false,
      error: PrincipalValidationError.TOO_LONG,
      message: "Principal is too long"
    };
  }

  // Format validation: must contain only lowercase letters, numbers, and hyphens
  if (!/^[a-z0-9-]+$/.test(principal)) {
    return {
      isValid: false,
      error: PrincipalValidationError.INVALID_FORMAT,
      message: "Principal contains invalid characters (only lowercase letters, numbers, and hyphens allowed)"
    };
  }

  // Must contain at least one hyphen (all valid principals have separators)
  if (!principal.includes('-')) {
    return {
      isValid: false,
      error: PrincipalValidationError.INVALID_FORMAT,
      message: "Principal must contain hyphens as separators"
    };
  }

  // Validate IC principal format patterns
  // Short form: "2vxsx-fae" (minimum valid format)
  // Long form: "rrkah-fqaaa-aaaah-qcuea-cai" (canister format)
  const shortPattern = /^[a-z0-9]{2,}-[a-z0-9]{3}$/;
  const longPattern = /^[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{3}$/;
  const mediumPattern = /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/;
  
  if (!shortPattern.test(principal) && !longPattern.test(principal) && !mediumPattern.test(principal)) {
    return {
      isValid: false,
      error: PrincipalValidationError.INVALID_FORMAT,
      message: "Principal does not match expected IC format"
    };
  }

  return { isValid: true };
}

function isValidPrincipal(principal: string): boolean {
  return validatePrincipal(principal).isValid;
}

// Enhanced error classification for balance queries
enum BalanceErrorType {
  NETWORK = "NETWORK",
  TIMEOUT = "TIMEOUT", 
  AUTHENTICATION = "AUTHENTICATION",
  CANISTER_UNAVAILABLE = "CANISTER_UNAVAILABLE",
  PRINCIPAL_INVALID = "PRINCIPAL_INVALID",
  PERMISSION_DENIED = "PERMISSION_DENIED",
  RATE_LIMITED = "RATE_LIMITED",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  UNKNOWN = "UNKNOWN"
}

interface ClassifiedError {
  type: BalanceErrorType;
  message: string;
  isRetryable: boolean;
  userMessage: string;
}

function classifyBalanceError(error: unknown): ClassifiedError {
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  // Network-related errors
  if (errorMessage.includes('network') || 
      errorMessage.includes('fetch') ||
      errorMessage.includes('connection') ||
      errorMessage.includes('connectivity')) {
    return {
      type: BalanceErrorType.NETWORK,
      message: errorMessage,
      isRetryable: true,
      userMessage: "Network connection error. Please check your internet connection and try again."
    };
  }
  
  // Timeout errors
  if (errorMessage.includes('timeout') || 
      errorMessage.includes('timed out') ||
      errorMessage.includes('deadline')) {
    return {
      type: BalanceErrorType.TIMEOUT,
      message: errorMessage,
      isRetryable: true,
      userMessage: "Request timed out. The network may be slow. Please try again."
    };
  }
  
  // Authentication/authorization errors
  if (errorMessage.includes('unauthorized') || 
      errorMessage.includes('unauthenticated') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('auth')) {
    return {
      type: BalanceErrorType.AUTHENTICATION,
      message: errorMessage,
      isRetryable: false,
      userMessage: "Authentication error. Please reconnect your wallet and try again."
    };
  }
  
  // Canister-specific errors
  if (errorMessage.includes('canister') || 
      errorMessage.includes('replica') ||
      errorMessage.includes('ic0.app') ||
      errorMessage.includes('dfinity')) {
    return {
      type: BalanceErrorType.CANISTER_UNAVAILABLE,
      message: errorMessage,
      isRetryable: true,
      userMessage: "The Internet Computer network is temporarily unavailable. Please try again in a moment."
    };
  }
  
  // Principal validation errors
  if (errorMessage.includes('principal') || 
      errorMessage.includes('invalid') ||
      errorMessage.includes('malformed')) {
    return {
      type: BalanceErrorType.PRINCIPAL_INVALID,
      message: errorMessage,
      isRetryable: false,
      userMessage: "Invalid wallet address format. Please check your wallet connection."
    };
  }
  
  // Rate limiting
  if (errorMessage.includes('rate') || 
      errorMessage.includes('limit') ||
      errorMessage.includes('throttle') ||
      errorMessage.includes('too many')) {
    return {
      type: BalanceErrorType.RATE_LIMITED,
      message: errorMessage,
      isRetryable: true,
      userMessage: "Too many requests. Please wait a moment before trying again."
    };
  }
  
  // Permission denied
  if (errorMessage.includes('permission') || 
      errorMessage.includes('forbidden') ||
      errorMessage.includes('denied')) {
    return {
      type: BalanceErrorType.PERMISSION_DENIED,
      message: errorMessage,
      isRetryable: false,
      userMessage: "Permission denied. You may not have access to this resource."
    };
  }
  
  // Service unavailable
  if (errorMessage.includes('service') || 
      errorMessage.includes('unavailable') ||
      errorMessage.includes('maintenance') ||
      errorMessage.includes('down')) {
    return {
      type: BalanceErrorType.SERVICE_UNAVAILABLE,
      message: errorMessage,
      isRetryable: true,
      userMessage: "Service is temporarily unavailable. Please try again later."
    };
  }
  
  // Default case
  return {
    type: BalanceErrorType.UNKNOWN,
    message: errorMessage,
    isRetryable: true,
    userMessage: "An unexpected error occurred while fetching balance. Please try again."
  };
}

// Enhanced retry logic with exponential backoff and jitter
async function withAdvancedRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    jitter?: boolean;
    shouldRetry?: (error: any, attempt: number) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    jitter = true,
    shouldRetry = (error, attempt) => {
      const classified = classifyBalanceError(error);
      return classified.isRetryable && attempt < maxRetries;
    }
  } = options;

  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (!shouldRetry(error, attempt)) {
        throw lastError;
      }

      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      
      // Add jitter to prevent thundering herd
      if (jitter) {
        delay = delay + Math.random() * delay * 0.1;
      }

      console.warn(`Balance query attempt ${attempt} failed, retrying in ${Math.round(delay)}ms:`, {
        error: lastError.message,
        attempt,
        maxRetries
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

export function useBackend() {
  const { isConnected, principal, delegationIdentity } = useWallet();

  const getAuthenticatedBackend = useCallback(() => {
    if (!isConnected || !principal || !delegationIdentity) {
      return backend;
    }

    // Return backend client with proper authentication using the delegation identity
    return backend.with({
      auth: async () => {
        // Use the delegation identity JSON for authentication
        const delegationJson = delegationIdentity.toJSON();
        return {
          delegationIdentity: delegationJson,
        };
      },
    });
  }, [isConnected, principal, delegationIdentity]);

  const createToken = useCallback(withErrorHandling(async (data: {
    tokenName: string;
    symbol: string;
    totalSupply: number;
    decimals?: number;
    logoFile?: string;
    isMintable?: boolean;
    isBurnable?: boolean;
  }) => {
    if (!isConnected || !principal || !delegationIdentity) {
      throw new Error("Wallet not connected");
    }

    const authenticatedBackend = getAuthenticatedBackend();
    
    return await withRetry(async () => {
      return await authenticatedBackend.token.create({
        ...data,
        creatorPrincipal: principal,
        delegationIdentity: delegationIdentity.toJSON(),
      });
    });
  }), [isConnected, principal, delegationIdentity, getAuthenticatedBackend]);

  const mintTokens = useCallback(withErrorHandling(async (
    tokenId: number, 
    amount: number, 
    toPrincipal: string
  ) => {
    if (!isConnected || !principal || !delegationIdentity) {
      throw new Error("Wallet not connected");
    }

    const authenticatedBackend = getAuthenticatedBackend();
    
    return await withRetry(async () => {
      return await authenticatedBackend.token.mint({
        tokenId,
        amount,
        toPrincipal,
        creatorPrincipal: principal,
        delegationIdentity: delegationIdentity.toJSON(),
      });
    });
  }), [isConnected, principal, delegationIdentity, getAuthenticatedBackend]);

  const burnTokens = useCallback(withErrorHandling(async (
    tokenId: number, 
    amount: number, 
    fromPrincipal: string
  ) => {
    if (!isConnected || !principal || !delegationIdentity) {
      throw new Error("Wallet not connected");
    }

    const authenticatedBackend = getAuthenticatedBackend();
    
    return await withRetry(async () => {
      return await authenticatedBackend.token.burn({
        tokenId,
        amount,
        fromPrincipal,
        creatorPrincipal: principal,
        delegationIdentity: delegationIdentity.toJSON(),
      });
    });
  }), [isConnected, principal, delegationIdentity, getAuthenticatedBackend]);

  const transferTokens = useCallback(withErrorHandling(async (
    tokenId: number, 
    amount: number, 
    fromPrincipal: string, 
    toPrincipal: string
  ) => {
    if (!isConnected || !principal || !delegationIdentity) {
      throw new Error("Wallet not connected");
    }

    const authenticatedBackend = getAuthenticatedBackend();
    
    return await withRetry(async () => {
      return await authenticatedBackend.token.transfer({
        tokenId,
        amount,
        fromPrincipal,
        toPrincipal,
        delegationIdentity: delegationIdentity.toJSON(),
      });
    });
  }), [isConnected, principal, delegationIdentity, getAuthenticatedBackend]);

  const transferICP = useCallback(withErrorHandling(async (
    amountICP: string | number,
    toPrincipal: string
  ) => {
    if (!isConnected || !principal || !delegationIdentity) {
      throw new Error("Wallet not connected");
    }

    if (!toPrincipal) {
      throw new Error("Recipient principal is required");
    }

    // Validate recipient principal format
    if (!isValidPrincipal(toPrincipal)) {
      throw new Error("Invalid recipient principal format");
    }

    const amountE8s = icpToE8s(amountICP);
    if (amountE8s <= 0n) {
      throw new Error("Amount must be greater than 0");
    }

    const authenticatedBackend = getAuthenticatedBackend();

    return await withRetry(async () => {
      // Use the configured ICP Ledger Canister ID from the backend
      // The backend will use the secret ICPLedgerCanisterId you configured
      return await authenticatedBackend.icp.performTokenOperation({
        canisterId: "dummy", // This will be replaced by the backend with the actual ledger canister ID
        operation: "transfer",
        amount: amountE8s.toString(),
        recipient: toPrincipal,
        delegationIdentity: delegationIdentity.toJSON(),
        ownerPrincipal: principal,
      });
    });
  }), [isConnected, principal, delegationIdentity, getAuthenticatedBackend]);

  const getTokenBalance = useCallback(withErrorHandling(async (
    tokenId: number, 
    principal: string
  ) => {
    const authenticatedBackend = getAuthenticatedBackend();
    return await withRetry(async () => {
      return await authenticatedBackend.token.getBalance({ tokenId, principal });
    });
  }), [getAuthenticatedBackend]);

  const getICPBalance = useCallback(async (
    targetPrincipal: string
  ) => {
    // Enhanced principal validation with detailed error messages
    const validation = validatePrincipal(targetPrincipal);
    if (!validation.isValid) {
      console.warn("Invalid principal format for ICP balance query:", {
        principal: targetPrincipal,
        error: validation.error,
        message: validation.message
      });
      
      return {
        balance: "0",
        error: validation.message || "Invalid principal format"
      };
    }

    try {
      const backendClient = getAuthenticatedBackend();
      
      // Enhanced retry with smart error handling
      const result = await withAdvancedRetry(async () => {
        return await backendClient.icp.getBalance({ 
          canisterId: "dummy", // This will be replaced by the backend with the actual ledger canister ID
          principal: targetPrincipal
        });
      }, {
        maxRetries: 4, // Increased retries for balance queries
        baseDelay: 800, // Slightly shorter initial delay
        maxDelay: 20000, // Reasonable max delay
        jitter: true,
        shouldRetry: (error, attempt) => {
          const classified = classifyBalanceError(error);
          
          // Don't retry principal validation errors
          if (classified.type === BalanceErrorType.PRINCIPAL_INVALID ||
              classified.type === BalanceErrorType.AUTHENTICATION ||
              classified.type === BalanceErrorType.PERMISSION_DENIED) {
            return false;
          }
          
          // Retry network, timeout, and service errors
          return classified.isRetryable && attempt < 4;
        }
      });
      
      // Validate the response format
      if (!result || typeof (result as any).balance === 'undefined') {
        console.warn("Invalid ICP balance response format:", result);
        return {
          balance: "0",
          error: "Invalid response format from balance service"
        };
      }

      // Propagate backend-provided error if any
      const backendError = (result as any).error as string | undefined;

      return {
        balance: (result as any).balance.toString(),
        error: backendError
      };
      
    } catch (error) {
      const classified = classifyBalanceError(error);
      
      console.error("Failed to fetch ICP balance after retries:", {
        principal: targetPrincipal,
        error: error instanceof Error ? error.message : String(error),
        errorType: classified.type,
        isRetryable: classified.isRetryable,
        stack: error instanceof Error ? error.stack : undefined
      });

      // Return safe default response with user-friendly error message
      return {
        balance: "0",
        error: classified.userMessage
      };
    }
  }, [getAuthenticatedBackend]);

  const syncTokenWithCanister = useCallback(withErrorHandling(async (tokenId: number) => {
    const authenticatedBackend = getAuthenticatedBackend();
    return await withRetry(async () => {
      return await authenticatedBackend.token.syncWithCanister({ tokenId });
    });
  }), [getAuthenticatedBackend]);

  return {
    backend: getAuthenticatedBackend(),
    createToken,
    mintTokens,
    burnTokens,
    transferTokens,
    transferICP,
    getTokenBalance,
    getICPBalance,
    syncTokenWithCanister,
    isConnected,
    principal,
    delegationIdentity,
  };
}
