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

export function useBackend() {
  const { isConnected, principal, delegationIdentity } = useWallet();

  const getAuthenticatedBackend = useCallback(() => {
    if (!isConnected || !principal || !delegationIdentity) {
      return backend;
    }

    // Return backend client with authentication
    return backend.with({
      auth: async () => {
        return {
          authorization: `Bearer ${principal}`,
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

    // Basic principal validation
    const principalPattern = /^[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{3}$/;
    if (!principalPattern.test(toPrincipal)) {
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
    principal: string
  ) => {
    try {
      const authenticatedBackend = getAuthenticatedBackend();
      
      // Use the configured ICP Ledger Canister ID from the backend
      // The backend will use the secret ICPLedgerCanisterId you configured
      const result = await authenticatedBackend.icp.getBalance({ 
        canisterId: "dummy", // This will be replaced by the backend with the actual ledger canister ID
        principal 
      });
      
      return result;
    } catch (error) {
      console.error("Failed to fetch ICP balance:", error);
      
      // Return a default response structure instead of throwing
      return {
        balance: "0"
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
