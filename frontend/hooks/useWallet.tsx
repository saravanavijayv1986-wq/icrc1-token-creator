import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { AuthClient } from "@dfinity/auth-client";
import { DelegationIdentity } from "@dfinity/identity";
import { Principal } from "@dfinity/principal";

interface WalletContextType {
  isConnected: boolean;
  principal: string | null;
  delegationIdentity: DelegationIdentity | null;
  authClient: AuthClient | null;
  connect: (walletType: string) => Promise<void>;
  disconnect: () => void;
  getToken: () => Promise<string | null>;
  getDelegation: () => DelegationIdentity | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [principal, setPrincipal] = useState<string | null>(null);
  const [delegationIdentity, setDelegationIdentity] = useState<DelegationIdentity | null>(null);
  const [authClient, setAuthClient] = useState<AuthClient | null>(null);

  useEffect(() => {
    initAuthClient();
  }, []);

  const initAuthClient = async () => {
    try {
      const client = await AuthClient.create({
        idleOptions: {
          // Idle timeout of 30 minutes
          idleTimeout: 1000 * 60 * 30,
          disableDefaultIdleCallback: true,
        },
      });

      setAuthClient(client);

      // Check if already authenticated
      const isAuthenticated = await client.isAuthenticated();
      if (isAuthenticated) {
        const identity = client.getIdentity();
        if (identity instanceof DelegationIdentity) {
          const principalId = identity.getPrincipal().toString();
          setPrincipal(principalId);
          setDelegationIdentity(identity);
          setIsConnected(true);
        }
      }
    } catch (error) {
      console.error("Failed to initialize AuthClient:", error);
    }
  };

  const connect = async (walletType: string) => {
    if (!authClient) {
      throw new Error("Auth client not initialized");
    }

    try {
      let identityProvider: string;
      
      switch (walletType) {
        case "internet-identity":
          identityProvider = "https://identity.ic0.app";
          break;
        case "nfid":
          identityProvider = "https://nfid.one";
          break;
        default:
          throw new Error(`Unsupported wallet type: ${walletType}`);
      }

      await new Promise<void>((resolve, reject) => {
        authClient.login({
          identityProvider,
          maxTimeToLive: BigInt(8 * 60 * 60 * 1000 * 1000 * 1000), // 8 hours in nanoseconds
          onSuccess: () => resolve(),
          onError: (error) => reject(new Error(error || "Authentication failed")),
        });
      });

      const identity = authClient.getIdentity();
      if (!(identity instanceof DelegationIdentity)) {
        throw new Error("Expected delegation identity");
      }

      const principalId = identity.getPrincipal().toString();
      
      setPrincipal(principalId);
      setDelegationIdentity(identity);
      setIsConnected(true);
    } catch (error) {
      console.error("Wallet connection failed:", error);
      throw error;
    }
  };

  const disconnect = async () => {
    if (authClient) {
      await authClient.logout();
    }
    
    setPrincipal(null);
    setDelegationIdentity(null);
    setIsConnected(false);
  };

  const getToken = async (): Promise<string | null> => {
    if (!isConnected || !principal) return null;
    return principal;
  };

  const getDelegation = (): DelegationIdentity | null => {
    return delegationIdentity;
  };

  return (
    <WalletContext.Provider value={{
      isConnected,
      principal,
      delegationIdentity,
      authClient,
      connect,
      disconnect,
      getToken,
      getDelegation,
    }}>
      {children}
    </WalletContext.Provider>
  );
}
