import { useState, useEffect, createContext, useContext, ReactNode } from "react";
import { AuthClient } from "@dfinity/auth-client";
import { DelegationIdentity } from "@dfinity/identity";
import { Principal } from "@dfinity/principal";
import { walletConfig } from "../config";

interface WalletContextType {
  isConnected: boolean;
  principal: string | null;
  delegationIdentity: DelegationIdentity | null;
  identityJson: string | null;
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
  const [identityJson, setIdentityJson] = useState<string | null>(null);
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

      const isAuthenticated = await client.isAuthenticated();
      if (isAuthenticated) {
        const identity = client.getIdentity();
        if (identity instanceof DelegationIdentity) {
          const principalId = identity.getPrincipal();
          if (principalId && !principalId.isAnonymous()) {
            setPrincipal(principalId.toString());
            setDelegationIdentity(identity);
            const idJson = JSON.stringify(identity.toJSON());
            setIdentityJson(idJson);
            setIsConnected(true);
            console.log("Restored wallet connection:", principalId.toString());
          } else {
            console.warn("Anonymous or invalid principal detected, clearing session");
            await client.logout();
          }
        } else {
          console.warn("Non-delegation identity detected, clearing session");
          await client.logout();
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
      let derivationOrigin: string | undefined;

      switch (walletType) {
        case "internet-identity":
          identityProvider = walletConfig.identityProviderUrl;
          derivationOrigin = walletConfig.internetIdentity.derivationOrigin;
          break;
        case "nfid":
          identityProvider = "https://nfid.one"; // Assuming NFID has one URL
          break;
        default:
          throw new Error(`Unsupported wallet type: ${walletType}`);
      }

      console.log(`Connecting to ${walletType}...`);

      await new Promise<void>((resolve, reject) => {
        authClient.login({
          identityProvider,
          maxTimeToLive: walletConfig.internetIdentity.maxTimeToLive,
          derivationOrigin,
          onSuccess: () => {
            console.log("Authentication successful");
            resolve();
          },
          onError: (error) => {
            console.error("Authentication failed:", error);
            reject(new Error(error || "Authentication failed"));
          },
        });
      });

      const identity = authClient.getIdentity();
      
      if (!(identity instanceof DelegationIdentity)) {
        throw new Error("Expected delegation identity, but received different type");
      }

      const principalObj = identity.getPrincipal();
      
      if (principalObj.isAnonymous()) {
        throw new Error("Received anonymous principal - authentication may have failed");
      }

      const principalText = principalObj.toString();
      
      console.log("Wallet connected successfully:", principalText);
      
      setPrincipal(principalText);
      setDelegationIdentity(identity);
      const idJson = JSON.stringify(identity.toJSON());
      setIdentityJson(idJson);
      setIsConnected(true);
      
    } catch (error) {
      console.error("Wallet connection failed:", error);
      
      setPrincipal(null);
      setDelegationIdentity(null);
      setIdentityJson(null);
      setIsConnected(false);
      
      if (error instanceof Error) {
        if (error.message.includes("User rejected")) {
          throw new Error("Connection was cancelled. Please try again and approve the connection.");
        } else if (error.message.includes("network") || error.message.includes("fetch")) {
          throw new Error("Network error. Please check your connection and try again.");
        } else if (error.message.includes("principal")) {
          throw new Error("Authentication failed: Invalid identity format. Please reconnect your wallet.");
        } else {
          throw new Error(`Connection failed: ${error.message}`);
        }
      }
      
      throw error;
    }
  };

  const disconnect = async () => {
    try {
      if (authClient) {
        await authClient.logout();
      }
    } catch (error) {
      console.error("Error during logout:", error);
    } finally {
      // Always clear state regardless of logout success
      setPrincipal(null);
      setDelegationIdentity(null);
      setIdentityJson(null);
      setIsConnected(false);
      console.log("Wallet disconnected");
    }
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
      identityJson,
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
