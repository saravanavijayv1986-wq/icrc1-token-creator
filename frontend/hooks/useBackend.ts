import { useCallback } from "react";
import { useWallet } from "./useWallet";
import backend from "~backend/client";
import { Principal } from "@dfinity/principal";
import { withRetry } from "../utils/errorHandling";

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
      return { balance: "0", error: "principal_required" };
    }
    try {
      Principal.fromText(targetPrincipal);
    } catch (e) {
      return { balance: "0", error: "invalid_principal" };
    }

    try {
      const result = await withRetry(() => backend.icp.getBalance({ canisterId: "dummy", principal: targetPrincipal }), 2, 1000);
      if (!result || typeof result.balance === 'undefined') {
        return { balance: "0", error: "invalid_response" };
      }
      return { balance: result.balance.toString(), error: result.error };
    } catch (error: any) {
      console.error("Failed to fetch ICP balance:", error);
      const code = error?.response?.data?.code;
      let friendlyCode: string;
      switch (code) {
        case 'invalid_argument': friendlyCode = 'invalid_principal'; break;
        case 'resource_exhausted': friendlyCode = 'rate_limit'; break;
        case 'unavailable': friendlyCode = 'network_unavailable'; break;
        case 'internal': friendlyCode = 'service_unavailable'; break;
        case 'unauthenticated': friendlyCode = 'auth_error'; break;
        default: friendlyCode = 'unknown_error';
      }
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
      if (!code) { // If no code, fallback to message parsing for network errors
        if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          friendlyCode = 'network_error';
        } else if (errorMessage.includes('timeout')) {
          friendlyCode = 'timeout';
        }
      }
      return { balance: "0", error: friendlyCode };
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
