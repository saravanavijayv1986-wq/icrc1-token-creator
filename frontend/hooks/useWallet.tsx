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
        
        // Validate that we have a proper delegation identity
        if (identity instanceof DelegationIdentity) {
          try {
            const principalId = identity.getPrincipal();
            
            // Validate principal format
            if (principalId && !principalId.isAnonymous()) {
              const principalText = principalId.toString();
              
              // Validate principal format more thoroughly
              if (isValidPrincipalFormat(principalText)) {
                setPrincipal(principalText);
                setDelegationIdentity(identity);
                setIsConnected(true);
                console.log("Restored wallet connection:", principalText);
              } else {
                console.warn("Invalid principal format on restore, clearing session");
                await client.logout();
              }
            } else {
              console.warn("Anonymous principal detected, clearing session");
              await client.logout();
            }
          } catch (error) {
            console.error("Error validating restored identity:", error);
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

  const isValidPrincipalFormat = (principalText: string): boolean => {
    if (!principalText || typeof principalText !== 'string') return false;
    if (principalText.length < 5 || principalText.length > 63) return false;
    if (!/^[a-z0-9-]+$/.test(principalText)) return false;
    if (!principalText.includes('-')) return false;
    
    // Check various valid principal patterns
    const patterns = [
      /^[a-z0-9]{2,}-[a-z0-9]{3}$/, // Short format
      /^[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{3}$/, // Standard format
      /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/, // Variable length
    ];
    
    return patterns.some(pattern => pattern.test(principalText));
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

      console.log(`Connecting to ${walletType}...`);

      await new Promise<void>((resolve, reject) => {
        authClient.login({
          identityProvider,
          maxTimeToLive: BigInt(8 * 60 * 60 * 1000 * 1000 * 1000), // 8 hours in nanoseconds
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
      
      if (!isValidPrincipalFormat(principalText)) {
        throw new Error(`Invalid principal format received: ${principalText.substring(0, 20)}...`);
      }

      console.log("Wallet connected successfully:", principalText);
      
      setPrincipal(principalText);
      setDelegationIdentity(identity);
      setIsConnected(true);
      
    } catch (error) {
      console.error("Wallet connection failed:", error);
      
      // Clean up any partial state
      setPrincipal(null);
      setDelegationIdentity(null);
      setIsConnected(false);
      
      // Provide more specific error messages
      if (error instanceof Error) {
        if (error.message.includes("User rejected")) {
          throw new Error("Connection was cancelled. Please try again and approve the connection.");
        } else if (error.message.includes("network") || error.message.includes("fetch")) {
          throw new Error("Network error. Please check your connection and try again.");
        } else if (error.message.includes("principal")) {
          throw new Error("Authentication failed: Invalid identity format. Please try reconnecting.");
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
