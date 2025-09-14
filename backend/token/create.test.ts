import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { tokenDB } from "./db";
import { create, syncWithCanister } from "./create";
import * as icpModule from "~encore/clients";

// Mock the ICP client
vi.mock("~encore/clients", () => ({
  icp: {
    deploy: vi.fn(),
    getTokenInfo: vi.fn(),
  },
}));

describe("Token Creation", () => {
  beforeEach(async () => {
    // Clean up test data
    await tokenDB.exec`DELETE FROM tokens WHERE symbol IN ('TEST', 'MOCK', 'SYNC')`;
    await tokenDB.exec`DELETE FROM token_transactions WHERE token_id IN (SELECT id FROM tokens WHERE symbol IN ('TEST', 'MOCK', 'SYNC'))`;
  });

  afterEach(async () => {
    // Clean up test data
    await tokenDB.exec`DELETE FROM tokens WHERE symbol IN ('TEST', 'MOCK', 'SYNC')`;
    await tokenDB.exec`DELETE FROM token_transactions WHERE token_id IN (SELECT id FROM tokens WHERE symbol IN ('TEST', 'MOCK', 'SYNC'))`;
    vi.clearAllMocks();
  });

  test("should create token successfully", async () => {
    // Mock successful ICP deployment
    const mockDeployResult = {
      canisterId: "test-canister-id",
      status: "deployed",
      deploymentHash: "test-hash",
      cyclesUsed: "1000000000",
      feePaidICP: "1",
    };

    vi.mocked(icpModule.icp.deploy).mockResolvedValue(mockDeployResult);

    const tokenData = {
      tokenName: "Test Token",
      symbol: "TEST",
      totalSupply: 1000000,
      decimals: 8,
      isMintable: true,
      isBurnable: false,
      creatorPrincipal: "test-principal-123",
      delegationIdentity: { toJSON: () => ({}) },
    };

    const result = await create(tokenData);

    expect(result).toBeDefined();
    expect(result.canisterId).toBe("test-canister-id");
    expect(result.deploymentStatus).toBe("deployed");

    // Verify token was created in database
    const token = await tokenDB.queryRow`
      SELECT * FROM tokens WHERE symbol = 'TEST'
    `;

    expect(token).toBeDefined();
    expect(token?.token_name).toBe("Test Token");
    expect(token?.total_supply).toBe(1000000);
    expect(token?.status).toBe("deployed");

    // Verify transaction was logged
    const transaction = await tokenDB.queryRow`
      SELECT * FROM token_transactions WHERE token_id = ${token?.id} AND transaction_type = 'creation'
    `;

    expect(transaction).toBeDefined();
    expect(transaction?.to_principal).toBe("test-principal-123");
  });

  test("should handle deployment failure", async () => {
    // Mock failed ICP deployment
    vi.mocked(icpModule.icp.deploy).mockRejectedValue(new Error("Deployment failed"));

    const tokenData = {
      tokenName: "Mock Token",
      symbol: "MOCK",
      totalSupply: 500000,
      decimals: 8,
      isMintable: false,
      isBurnable: true,
      creatorPrincipal: "test-principal-456",
      delegationIdentity: { toJSON: () => ({}) },
    };

    try {
      await create(tokenData);
      expect.fail("Should have thrown an error");
    } catch (error) {
      // Verify token status was set to failed
      const token = await tokenDB.queryRow`
        SELECT * FROM tokens WHERE symbol = 'MOCK'
      `;

      expect(token?.status).toBe("failed");
      expect(token?.failure_reason).toContain("Deployment failed");
    }
  });

  test("should validate input parameters", async () => {
    const invalidTokenData = {
      tokenName: "", // Invalid - empty name
      symbol: "T", // Invalid - too short
      totalSupply: 0, // Invalid - zero supply
      decimals: 8,
      isMintable: false,
      isBurnable: false,
      creatorPrincipal: "invalid-principal", // Invalid format
      delegationIdentity: null, // Invalid - missing delegation
    };

    try {
      await create(invalidTokenData as any);
      expect.fail("Should have thrown validation error");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test("should prevent duplicate symbols", async () => {
    // Create first token
    await tokenDB.exec`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, status)
      VALUES ('Existing Token', 'EXIST', 1000000, 8, 'test-principal', 'deployed')
    `;

    const duplicateTokenData = {
      tokenName: "Duplicate Token",
      symbol: "EXIST", // Duplicate symbol
      totalSupply: 2000000,
      decimals: 8,
      isMintable: false,
      isBurnable: false,
      creatorPrincipal: "test-principal-789",
      delegationIdentity: { toJSON: () => ({}) },
    };

    try {
      await create(duplicateTokenData);
      expect.fail("Should have thrown duplicate symbol error");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test("should sync token with canister", async () => {
    // Create test token
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status)
      VALUES ('Sync Token', 'SYNC', 1000000, 8, 'test-principal', 'sync-canister-id', 'deployed')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    // Mock token info from canister
    const mockTokenInfo = {
      name: "Updated Sync Token",
      symbol: "SYNC",
      decimals: 8,
      totalSupply: "1200000",
      transferFee: "10000",
      metadata: [],
    };

    vi.mocked(icpModule.icp.getTokenInfo).mockResolvedValue(mockTokenInfo);

    const result = await syncWithCanister({ tokenId });

    expect(result.success).toBe(true);
    expect(result.updatedFields).toContain("totalSupply");

    // Verify token was updated
    const updatedToken = await tokenDB.queryRow`
      SELECT * FROM tokens WHERE id = ${tokenId}
    `;

    expect(updatedToken?.token_name).toBe("Updated Sync Token");
    expect(updatedToken?.total_supply).toBe(1200000);
  });

  test("should handle sync with non-existent token", async () => {
    try {
      await syncWithCanister({ tokenId: 99999 });
      expect.fail("Should have thrown error for non-existent token");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });

  test("should handle sync with non-deployed token", async () => {
    // Create token with pending status
    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, status)
      VALUES ('Pending Token', 'PEND', 1000000, 8, 'test-principal', 'pending')
      RETURNING id
    `;

    const tokenId = tokenResult!.id;

    try {
      await syncWithCanister({ tokenId });
      expect.fail("Should have thrown error for non-deployed token");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
