import { useCallback } from "react";
import { useWallet } from "./useWallet";
import backend from "~backend/client";

function icpToE8s(amount: string | number): bigint {
  const str = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error("Invalid ICP amount");
  }
  const [intPart, fracPart = ""] = str.split(".");
  const fracPadded = (fracPart + "00000000").slice(0, 8);
  return BigInt(intPart) * 100000000n + BigInt(fracPadded);
}

async function withRetry<T>(
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
      
      // Don't retry on certain errors
      if (lastError.message.includes('authentication') || 
          lastError.message.includes('unauthorized') ||
          lastError.message.includes('invalid principal') ||
          lastError.message.includes('delegation')) {
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

export function useBackend() {
  const { isConnected, principal, delegationIdentity, identityJson } = useWallet();

  const createToken = useCallback(async (data: {
    tokenName: string;
    symbol: string;
    totalSupply: number;
    decimals?: number;
    logoFile?: string;
    isMintable?: boolean;
    isBurnable?: boolean;
  }) => {
    if (!isConnected || !principal || !identityJson) {
      throw new Error("Wallet not connected. Please connect your wallet to perform this action.");
    }

    return await withRetry(async () => {
      return await backend.token.create({
        ...data,
        creatorPrincipal: principal,
        delegationIdentity: identityJson,
      });
    });
  }, [isConnected, principal, identityJson]);

  const mintTokens = useCallback(async (
    tokenId: number, 
    amount: number, 
    toPrincipal: string
  ) => {
    if (!isConnected || !principal || !identityJson) {
      throw new Error("Wallet not connected. Please connect your wallet to perform this action.");
    }

    return await withRetry(async () => {
      return await backend.token.mint({
        tokenId,
        amount,
        toPrincipal,
        creatorPrincipal: principal,
        delegationIdentity: identityJson,
      });
    });
  }, [isConnected, principal, identityJson]);

  const burnTokens = useCallback(async (
    tokenId: number, 
    amount: number, 
    fromPrincipal: string
  ) => {
    if (!isConnected || !principal || !identityJson) {
      throw new Error("Wallet not connected. Please connect your wallet to perform this action.");
    }

    return await withRetry(async () => {
      return await backend.token.burn({
        tokenId,
        amount,
        fromPrincipal,
        creatorPrincipal: principal,
        delegationIdentity: identityJson,
      });
    });
  }, [isConnected, principal, identityJson]);

  const transferTokens = useCallback(async (
    tokenId: number, 
    amount: number, 
    fromPrincipal: string, 
    toPrincipal: string
  ) => {
    if (!isConnected || !principal || !identityJson) {
      throw new Error("Wallet not connected. Please connect your wallet to perform this action.");
    }

    return await withRetry(async () => {
      return await backend.token.transfer({
        tokenId,
        amount,
        fromPrincipal,
        toPrincipal,
        delegationIdentity: identityJson,
      });
    });
  }, [isConnected, principal, identityJson]);

  const transferICP = useCallback(async (
    amountICP: string | number,
    toPrincipal: string
  ) => {
    if (!isConnected || !principal || !identityJson) {
      throw new Error("Wallet not connected. Please connect your wallet to perform this action.");
    }

    if (!toPrincipal) {
      throw new Error("Recipient principal is required");
    }
    
    try {
      const p = Principal.fromText(toPrincipal);
      if (p.isAnonymous()) {
        throw new Error("Cannot transfer to anonymous principal");
      }
    } catch (e) {
      throw new Error("Invalid recipient principal format");
    }

    const amountE8s = icpToE8s(amountICP);
    if (amountE8s <= 0n) {
      throw new Error("Amount must be greater than 0");
    }

    return await withRetry(async () => {
      return await backend.icp.performTokenOperation({
        canisterId: "dummy",
        operation: "transfer",
        amount: amountE8s.toString(),
        recipient: toPrincipal,
        delegationIdentity: identityJson,
        ownerPrincipal: principal,
      });
    });
  }, [isConnected, principal, identityJson]);

  const getTokenBalance = useCallback(async (
    tokenId: number, 
    principal: string
  ) => {
    return await withRetry(async () => {
      return await backend.token.getBalance({ tokenId, principal });
    });
  }, []);

  const getICPBalance = useCallback(async (
    targetPrincipal: string
  ) => {
    if (!targetPrincipal) {
      return {
        balance: "0",
        error: "Principal is required"
      };
    }
    
    try {
      Principal.fromText(targetPrincipal);
    } catch (e) {
      return {
        balance: "0",
        error: "Invalid wallet principal format"
      };
    }

    try {
      const result = await withRetry(async () => {
        return await backend.icp.getBalance({ 
          canisterId: "dummy",
          principal: targetPrincipal
        });
      }, 2, 1000);
      
      if (!result || typeof result.balance === 'undefined') {
        return {
          balance: "0",
          error: "Invalid response format"
        };
      }

      return {
        balance: result.balance.toString(),
        error: result.error
      };
      
    } catch (error) {
      console.error("Failed to fetch ICP balance:", error);
      
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      
      if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
        return { balance: "0", error: "Network connection error" };
      } else if (errorMessage.includes('timeout')) {
        return { balance: "0", error: "Request timed out" };
      } else if (errorMessage.includes('unauthorized') || errorMessage.includes('auth')) {
        return { balance: "0", error: "Authentication error" };
      } else if (errorMessage.includes('rate limit')) {
        return { balance: "0", error: "Too many requests. Please wait and try again." };
      } else if (errorMessage.includes('canister') || errorMessage.includes('replica')) {
        return { balance: "0", error: "The Internet Computer network is temporarily unavailable. Please try again in a moment." };
      } else if (errorMessage.includes('principal') || errorMessage.includes('invalid')) {
        return { balance: "0", error: "Invalid wallet principal format" };
      } else if (errorMessage.includes('service') || errorMessage.includes('unavailable')) {
        return { balance: "0", error: "Service is temporarily unavailable. Please try again." };
      } else {
        return { balance: "0", error: "Unable to fetch balance. Please check your connection and try again." };
      }
    }
  }, []);

  const syncTokenWithCanister = useCallback(async (tokenId: number) => {
    return await withRetry(async () => {
      return await backend.token.syncWithCanister({ tokenId });
    });
  }, []);

  return {
    backend,
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
