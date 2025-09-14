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

    const transferResult = await result.current.transferICP("1.5", "rrkah-fqaaa-aaaah-qcuea-cai");

    expect(mockBackendWithAuth.icp.performTokenOperation).toHaveBeenCalledWith({
      canisterId: "dummy",
      operation: "transfer",
      amount: "150000000", // 1.5 ICP in e8s
      recipient: "rrkah-fqaaa-aaaah-qcuea-cai",
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
      result.current.transferICP("0", "rrkah-fqaaa-aaaah-qcuea-cai")
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

  test("should validate principals for ICP balance queries", async () => {
    const { result } = renderHook(() => useBackend());

    // Test invalid principals
    const invalidPrincipals = [
      "",
      "too-short",
      "UPPERCASE-NOT-ALLOWED",
      "has@special#chars",
      "no-hyphens-here",
      "toolongprincipalidentifierthatexceedsmaximumlengthof63chars",
    ];

    for (const invalidPrincipal of invalidPrincipals) {
      const balanceResult = await result.current.getICPBalance(invalidPrincipal);
      expect(balanceResult.balance).toBe("0");
      expect(balanceResult.error).toBeDefined();
    }
  });

  test("should handle ICP balance network errors with retry", async () => {
    mockBackendWithAuth.icp.getBalance
      .mockRejectedValueOnce(new Error("Network connection failed"))
      .mockRejectedValueOnce(new Error("Request timeout"))
      .mockResolvedValue({ balance: "123456789" });

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getICPBalance("rrkah-fqaaa-aaaah-qcuea-cai");

    expect(balanceResult.balance).toBe("123456789");
    expect(mockBackendWithAuth.icp.getBalance).toHaveBeenCalledTimes(3);
  });

  test("should handle non-retryable ICP balance errors", async () => {
    mockBackendWithAuth.icp.getBalance.mockRejectedValue(new Error("Authentication failed"));

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getICPBalance("rrkah-fqaaa-aaaah-qcuea-cai");

    expect(balanceResult.balance).toBe("0");
    expect(balanceResult.error).toContain("Authentication error");
    expect(mockBackendWithAuth.icp.getBalance).toHaveBeenCalledTimes(1); // No retry for auth errors
  });

  test("should handle ICP balance response validation", async () => {
    // Test invalid response format
    mockBackendWithAuth.icp.getBalance.mockResolvedValue(null);

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getICPBalance("rrkah-fqaaa-aaaah-qcuea-cai");

    expect(balanceResult.balance).toBe("0");
    expect(balanceResult.error).toContain("Invalid response format");
  });

  test("should get ICP balance with error handling", async () => {
    mockBackendWithAuth.icp.getBalance.mockRejectedValue(new Error("Canister unavailable"));

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getICPBalance("rrkah-fqaaa-aaaah-qcuea-cai");

    expect(balanceResult).toEqual({ 
      balance: "0", 
      error: "The Internet Computer network is temporarily unavailable. Please try again in a moment."
    });
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
      await result.current.transferICP(testCase.input, "rrkah-fqaaa-aaaah-qcuea-cai");
      
      expect(mockBackendWithAuth.icp.performTokenOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: testCase.expected,
        })
      );
    }
  });

  test("should handle rate limiting errors appropriately", async () => {
    mockBackendWithAuth.icp.getBalance.mockRejectedValue(new Error("Rate limit exceeded"));

    const { result } = renderHook(() => useBackend());

    const balanceResult = await result.current.getICPBalance("rrkah-fqaaa-aaaah-qcuea-cai");

    expect(balanceResult.balance).toBe("0");
    expect(balanceResult.error).toContain("Too many requests");
  });

  test("should classify various error types correctly", async () => {
    const { result } = renderHook(() => useBackend());

    const errorTestCases = [
      { error: "Network connection failed", expectedMessage: "Network connection error" },
      { error: "Request timeout", expectedMessage: "Request timed out" },
      { error: "Unauthorized access", expectedMessage: "Authentication error" },
      { error: "Canister not found", expectedMessage: "Internet Computer network" },
      { error: "Invalid principal format", expectedMessage: "Invalid wallet address" },
      { error: "Service unavailable", expectedMessage: "Service is temporarily unavailable" },
    ];

    for (const testCase of errorTestCases) {
      mockBackendWithAuth.icp.getBalance.mockRejectedValue(new Error(testCase.error));
      
      const balanceResult = await result.current.getICPBalance("rrkah-fqaaa-aaaah-qcuea-cai");
      
      expect(balanceResult.balance).toBe("0");
      expect(balanceResult.error).toContain(testCase.expectedMessage);
    }
  });
});
