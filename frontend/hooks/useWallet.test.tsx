import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WalletProvider, useWallet } from "./useWallet";
import { AuthClient } from "@dfinity/auth-client";
import { DelegationIdentity } from "@dfinity/identity";

// Mock @dfinity/auth-client
vi.mock("@dfinity/auth-client", () => ({
  AuthClient: {
    create: vi.fn(),
  },
}));

vi.mock("@dfinity/identity", () => ({
  DelegationIdentity: vi.fn(),
}));

// Test component to use the wallet hook
function TestComponent() {
  const { isConnected, principal, connect, disconnect } = useWallet();
  
  return (
    <div>
      <div data-testid="connection-status">{isConnected ? "connected" : "disconnected"}</div>
      <div data-testid="principal">{principal || "no-principal"}</div>
      <button data-testid="connect-ii" onClick={() => connect("internet-identity")}>
        Connect II
      </button>
      <button data-testid="connect-nfid" onClick={() => connect("nfid")}>
        Connect NFID
      </button>
      <button data-testid="disconnect" onClick={disconnect}>
        Disconnect
      </button>
    </div>
  );
}

describe("useWallet Hook", () => {
  let mockAuthClient: any;
  let mockIdentity: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Create mock identity
    mockIdentity = {
      getPrincipal: vi.fn().mockReturnValue({
        toString: () => "test-principal-123"
      }),
    };

    // Create mock auth client
    mockAuthClient = {
      isAuthenticated: vi.fn().mockResolvedValue(false),
      getIdentity: vi.fn().mockReturnValue(mockIdentity),
      login: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(AuthClient.create).mockResolvedValue(mockAuthClient);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should initialize as disconnected", async () => {
    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    expect(screen.getByTestId("connection-status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("principal")).toHaveTextContent("no-principal");
  });

  test("should restore connection on initialization if authenticated", async () => {
    // Mock already authenticated
    mockAuthClient.isAuthenticated.mockResolvedValue(true);
    
    // Mock delegation identity
    const mockDelegationIdentity = Object.create(DelegationIdentity.prototype);
    mockDelegationIdentity.getPrincipal = vi.fn().mockReturnValue({
      toString: () => "existing-principal"
    });
    mockAuthClient.getIdentity.mockReturnValue(mockDelegationIdentity);

    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Should restore connection
    expect(screen.getByTestId("connection-status")).toHaveTextContent("connected");
    expect(screen.getByTestId("principal")).toHaveTextContent("existing-principal");
  });

  test("should connect with Internet Identity", async () => {
    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Mock successful login
    const mockDelegationIdentity = Object.create(DelegationIdentity.prototype);
    mockDelegationIdentity.getPrincipal = vi.fn().mockReturnValue({
      toString: () => "connected-principal"
    });

    mockAuthClient.login.mockImplementation(({ onSuccess }: any) => {
      mockAuthClient.getIdentity.mockReturnValue(mockDelegationIdentity);
      onSuccess();
    });

    await act(async () => {
      screen.getByTestId("connect-ii").click();
    });

    expect(mockAuthClient.login).toHaveBeenCalledWith({
      identityProvider: "https://identity.ic0.app",
      maxTimeToLive: expect.any(BigInt),
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    });

    expect(screen.getByTestId("connection-status")).toHaveTextContent("connected");
    expect(screen.getByTestId("principal")).toHaveTextContent("connected-principal");
  });

  test("should connect with NFID", async () => {
    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Mock successful login
    const mockDelegationIdentity = Object.create(DelegationIdentity.prototype);
    mockDelegationIdentity.getPrincipal = vi.fn().mockReturnValue({
      toString: () => "nfid-principal"
    });

    mockAuthClient.login.mockImplementation(({ onSuccess }: any) => {
      mockAuthClient.getIdentity.mockReturnValue(mockDelegationIdentity);
      onSuccess();
    });

    await act(async () => {
      screen.getByTestId("connect-nfid").click();
    });

    expect(mockAuthClient.login).toHaveBeenCalledWith({
      identityProvider: "https://nfid.one",
      maxTimeToLive: expect.any(BigInt),
      onSuccess: expect.any(Function),
      onError: expect.any(Function),
    });
  });

  test("should handle connection errors", async () => {
    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Mock failed login
    mockAuthClient.login.mockImplementation(({ onError }: any) => {
      onError("Connection failed");
    });

    await act(async () => {
      screen.getByTestId("connect-ii").click();
    });

    // Should remain disconnected
    expect(screen.getByTestId("connection-status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("principal")).toHaveTextContent("no-principal");
  });

  test("should disconnect successfully", async () => {
    // Start connected
    mockAuthClient.isAuthenticated.mockResolvedValue(true);
    const mockDelegationIdentity = Object.create(DelegationIdentity.prototype);
    mockDelegationIdentity.getPrincipal = vi.fn().mockReturnValue({
      toString: () => "connected-principal"
    });
    mockAuthClient.getIdentity.mockReturnValue(mockDelegationIdentity);

    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Should be connected initially
    expect(screen.getByTestId("connection-status")).toHaveTextContent("connected");

    // Disconnect
    await act(async () => {
      screen.getByTestId("disconnect").click();
    });

    expect(mockAuthClient.logout).toHaveBeenCalled();
    expect(screen.getByTestId("connection-status")).toHaveTextContent("disconnected");
    expect(screen.getByTestId("principal")).toHaveTextContent("no-principal");
  });

  test("should handle unsupported wallet type", async () => {
    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    const { connect } = useWallet();

    await expect(act(async () => {
      await connect("unsupported-wallet" as any);
    })).rejects.toThrow("Unsupported wallet type");
  });

  test("should handle AuthClient creation failure", async () => {
    vi.mocked(AuthClient.create).mockRejectedValue(new Error("Failed to create AuthClient"));

    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Should remain disconnected and not crash
    expect(screen.getByTestId("connection-status")).toHaveTextContent("disconnected");
  });

  test("should reject non-delegation identity", async () => {
    await act(async () => {
      render(
        <WalletProvider>
          <TestComponent />
        </WalletProvider>
      );
    });

    // Mock login with non-delegation identity
    const mockRegularIdentity = {
      getPrincipal: vi.fn().mockReturnValue({
        toString: () => "regular-principal"
      }),
    };

    mockAuthClient.login.mockImplementation(({ onSuccess }: any) => {
      mockAuthClient.getIdentity.mockReturnValue(mockRegularIdentity);
      onSuccess();
    });

    await expect(act(async () => {
      screen.getByTestId("connect-ii").click();
    })).rejects.toThrow("Expected delegation identity");
  });
});
