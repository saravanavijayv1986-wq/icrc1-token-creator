import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBackend } from "./useBackend";
import { useWallet } from "./useWallet";
import backend from "~backend/client";

// Mock the wallet hook
vi.mock("./useWallet", () => ({
  useWallet: vi.fn(),
}));

// Mock the backend client
vi.mock("~backend/client", () => ({
  default: {
    with: vi.fn(),
    token: {
      create: vi.fn(),
      mint: vi.fn(),
      burn: vi.fn(),
      transfer: vi.fn(),
      getBalance: vi.fn(),
      syncWithCanister: vi.fn(),
    },
    icp: {
      performTokenOperation: vi.fn(),
      getBalance: vi.fn(),
    },
  },
}));

describe("useBackend Hook", () => {
  let mockWalletState: any;
  let mockBackendWithAuth: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock wallet state
    mockWalletState = {
      isConnected: true,
      principal: "test-principal-123",
      delegationIdentity: {
        toJSON: () => ({ test: "delegation" }),
      },
    };

    // Mock authenticated backend
    mockBackendWithAuth = {
      token: {
        create: vi.fn(),
        mint: vi.fn(),
        burn: vi.fn(),
        transfer: vi.fn(),
        getBalance: vi.fn(),
        syncWithCanister: vi.fn(),
      },
      icp: {
        performTokenOperation: vi.fn(),
        getBalance: vi.fn(),
      },
    };

    vi.mocked(useWallet).mockReturnValue(mockWalletState);
    vi.mocked(backend.with).mockReturnValue(mockBackendWithAuth);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("should create authenticated backend when connected", () => {
    const { result } = renderHook(() => useBackend());

    expect(backend.with).toHaveBeenCalledWith({
      auth: expect.any(Function),
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.principal).toBe("test-principal-123");
  });

  test("should use unauthenticated backend when not connected", () => {
    mockWalletState.isConnected = false;
    mockWalletState.principal = null;
    mockWalletState.delegationIdentity = null;

    const { result } = renderHook(() => useBackend());

    expect(result.current.isConnected).toBe(false);
    expect(result.current.principal).toBe(null);
  });

  test("should create token successfully", async () => {
    const mockTokenResult = {
      tokenId: 123,
      canisterId: "test-canister",
      transactionId: "test-tx",
      deploymentStatus: "deployed",
      estimatedTime: "2-3 minutes",
      cyclesUsed: "1000000000",
    };

    mockBackendWithAuth.token.create.mockResolvedValue(mockTokenResult);

    const { result } = renderHook(() => useBackend());

    const tokenData = {
      tokenName: "Test Token",
      symbol: "TEST",
      totalSupply: 1000000,
      decimals: 8,
      isMintable: true,
      isBurnable: false,
    };

    const tokenResult = await result.current.createToken(tokenData);

    expect(mockBackendWithAuth.token.create).toHaveBeenCalledWith({
      ...tokenData,
      creatorPrincipal: "test-principal-123",
      delegationIdentity: { test: "delegation" },
    });

    expect(tokenResult).toEqual(mockTokenResult);
  });

  test("should throw error when creating token without wallet", async () => {
    mockWalletState.isConnected = false;
    mockWalletState.principal = null;

    const { result } = renderHook(() => useBackend());

    const tokenData = {
      tokenName: "Test Token",
      symbol: "TEST",
      totalSupply: 1000000,
    };

    await expect(result.current.createToken(tokenData as any)).rejects.toThrow(
      "Wallet not connected"
    );
  });

  test("should mint tokens successfully", async () => {
    const mockMintResult = {
      success: true,
      transactionId: "mint-tx-123",
      blockIndex: "mint-block-456",
      newTotalSupply: "1100000",
      newBalance: "100000",
    };

    mockBackendWithAuth.token.mint.mockResolvedValue(mockMintResult);

    const { result } = renderHook(() => useBackend());

    const mintResult = await result.current.mintTokens(1, 100000, "recipient-principal");

    expect(mockBackendWithAuth.token.mint).toHaveBeenCalledWith({
      tokenId: 1,
      amount: 100000,
      toPrincipal: "recipient-principal",
      creatorPrincipal: "test-principal-123",
      delegationIdentity: { test: "delegation" },
    });

    expect(mintResult).toEqual(mockMintResult);
  });

  test("should burn tokens successfully", async () => {
    const mockBurnResult = {
      success: true,
      transactionId: "burn-tx-789",
      blockIndex: "burn-block-012",
      newTotalSupply: "900000",
      newBalance: "50000",
    };

    mockBackendWithAuth.token.burn.mockResolvedValue(mockBurnResult);

    const { result } = renderHook(() => useBackend());

    const burnResult = await result.current.burnTokens(1, 50000, "test-principal-123");

    expect(mockBackendWithAuth.token.burn).toHaveBeenCalledWith({
      tokenId: 1,
      amount: 50000,
      fromPrincipal: "test-principal-123",
      creatorPrincipal: "test-principal-123",
      delegationIdentity: { test: "delegation" },
    });

    expect(burnResult).toEqual(mockBurnResult);
  });

  test("should transfer tokens successfully", async () => {
    const mockTransferResult = {
      success: true,
      transactionId: "transfer-tx-345",
      blockIndex: "transfer-block-678",
      transferFee: "10000",
      newBalance: "75000",
    };

    mockBackendWithAuth.token.transfer.mockResolvedValue(mockTransferResult);

    const { result } = renderHook(() => useBackend());

    const transferResult = await result.current.transferTokens(
      1, 25000, "sender-principal", "recipient-principal"
    );

    expect(mockBackendWithAuth.token.transfer).toHaveBeenCalledWith({
      tokenId: 1,
      amount: 25000,
      fromPrincipal: "sender-principal",
      toPrincipal: "recipient-principal",
      delegationIdentity: { test: "delegation" },
    });

    expect(transferResult).toEqual(mockTransferResult);
  });

  test("should transfer ICP successfully", async () => {
    const mockICPTransferResult = {
      success: true,
      transactionId: "icp-tx-901",
      blockIndex: "icp-block-234",
      newBalance: "25000000000", // in e8s
    };

    mockBackendWithAuth.icp.performTokenOperation.mockResolvedValue(mockICPTransferResult);

    const { result } = renderHook(() => useBackend());

    const transferResult = await result.current.transferICP("1.5", "recipient-principal");

    expect(mockBackendWithAuth.icp.performTokenOperation).toHaveBeenCalledWith({
      canisterId: "dummy",
      operation: "transfer",
      amount: "150000000", // 1.5 ICP in e8s
      recipient: "recipient-principal",
      delegationIdentity: { test: "delegation" },
      ownerPrincipal: "test-principal-123",
    });

    expect(transferResult).toEqual(mockICPTransferResult);
  });

  test("should validate ICP transfer parameters", async () => {
    const { result } = renderHook(() => useBackend());

    // Test invalid recipient
    await expect(
      result.current.transferICP("1.0", "invalid-principal")
    ).rejects.toThrow("Invalid recipient principal format");

    // Test zero amount
    await expect(
      result.current.transferICP("0", "valid-principal-123")
    ).rejects.toThrow("Amount must be greater than 0");

    // Test missing recipient
    await expect(
      result.current.transferICP("1.0", "")
    ).rejects.toThrow("Recipient principal is required");
  });

  test("should get token balance", async () => {
    const mockBalanceResult = {
      balance: "123456789",
      decimals: 8,
      symbol: "TEST",
    };

    mockBackendWithAuth.token.getBalance.mockResolvedValue(mockBalanceResult);

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getTokenBalance(1, "test-principal");

    expect(mockBackendWithAuth.token.getBalance).toHaveBeenCalledWith({
      tokenId: 1,
      principal: "test-principal",
    });

    expect(balanceResult).toEqual(mockBalanceResult);
  });

  test("should get ICP balance with error handling", async () => {
    mockBackendWithAuth.icp.getBalance.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getICPBalance("test-principal");

    expect(balanceResult).toEqual({ balance: "0" });
  });

  test("should sync token with canister", async () => {
    const mockSyncResult = {
      success: true,
      updatedFields: ["name", "totalSupply"],
    };

    mockBackendWithAuth.token.syncWithCanister.mockResolvedValue(mockSyncResult);

    const { result } = renderHook(() => useBackend());

    const syncResult = await result.current.syncTokenWithCanister(1);

    expect(mockBackendWithAuth.token.syncWithCanister).toHaveBeenCalledWith({
      tokenId: 1,
    });

    expect(syncResult).toEqual(mockSyncResult);
  });

  test("should handle ICP amount conversion correctly", async () => {
    const { result } = renderHook(() => useBackend());

    // Test various ICP amounts
    const testCases = [
      { input: "1", expected: "100000000" },
      { input: "0.5", expected: "50000000" },
      { input: "0.00000001", expected: "1" },
      { input: "10.12345678", expected: "1012345678" },
    ];

    mockBackendWithAuth.icp.performTokenOperation.mockResolvedValue({
      success: true,
      transactionId: "test",
      blockIndex: "test",
    });

    for (const testCase of testCases) {
      await result.current.transferICP(testCase.input, "test-principal-123");
      
      expect(mockBackendWithAuth.icp.performTokenOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: testCase.expected,
        })
      );
    }
  });
});
