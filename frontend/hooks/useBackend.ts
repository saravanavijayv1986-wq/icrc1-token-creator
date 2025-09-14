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

function isValidPrincipal(principal: string): boolean {
  if (!principal || typeof principal !== 'string') {
    return false;
  }
  
  // More flexible IC principal format validation
  // Principals can have various formats:
  // - Short form: "2vxsx-fae" 
  // - Long form: "rrkah-fqaaa-aaaah-qcuea-cai"
  // - Various canister formats
  const principalPattern = /^[a-z0-9]+([-][a-z0-9]+)*$/;
  
  return principalPattern.test(principal) && 
         principal.length >= 5 && 
         principal.length <= 63 &&
         principal.includes('-'); // All valid principals contain at least one dash
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
    // Basic principal validation first - be more lenient
    if (!targetPrincipal || typeof targetPrincipal !== 'string' || targetPrincipal.length < 5) {
      console.warn("Invalid principal format for ICP balance query:", targetPrincipal);
      return {
        balance: "0",
        error: "Invalid principal format"
      };
    }

    try {
      // Use either authenticated or unauthenticated backend for balance queries
      // Balance queries can often be done without authentication
      const backendClient = getAuthenticatedBackend();
      
      // Use retry mechanism for better reliability
      const result = await withRetry(async () => {
        // Use the configured ICP Ledger Canister ID from the backend
        // The backend will use the secret ICPLedgerCanisterId you configured
        return await backendClient.icp.getBalance({ 
          canisterId: "dummy", // This will be replaced by the backend with the actual ledger canister ID
          principal: targetPrincipal
        });
      }, 2, 1000); // 2 retries with 1 second delay
      
      // Validate the response format
      if (!result || typeof (result as any).balance === 'undefined') {
        console.warn("Invalid ICP balance response format:", result);
        return {
          balance: "0",
          error: "Invalid response format"
        };
      }

      // Propagate backend-provided error if any
      const backendError = (result as any).error as string | undefined;

      return {
        balance: (result as any).balance.toString(),
        error: backendError
      };
    } catch (error) {
      console.error("Failed to fetch ICP balance:", {
        principal: targetPrincipal,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      
      // Determine error type for better user feedback
      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        if (error.message.includes("network") || error.message.includes("fetch")) {
          errorMessage = "Network connection error";
        } else if (error.message.includes("timeout")) {
          errorMessage = "Request timeout";
        } else if (error.message.includes("unauthorized") || error.message.includes("authentication")) {
          errorMessage = "Authentication error";
        } else if (error.message.includes("canister") || error.message.includes("replica")) {
          errorMessage = "Blockchain network error";
        } else if (error.message.includes("principal") || error.message.includes("invalid")) {
          errorMessage = "Invalid wallet principal format";
        } else {
          errorMessage = error.message;
        }
      }

      // Return a safe default response structure instead of throwing
      return {
        balance: "0",
        error: errorMessage
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
