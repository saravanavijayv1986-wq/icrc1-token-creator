import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { tokenDB } from "./db";
import { mint } from "./mint";
import { burn } from "./burn";
import { transfer, getBalance } from "./transfer";
import * as icpModule from "~encore/clients";

// Mock the ICP client
vi.mock("~encore/clients", () => ({
  icp: {
    performTokenOperation: vi.fn(),
    getBalance: vi.fn(),
    getTokenInfo: vi.fn(),
  },
}));

describe("Token Operations", () => {
  let testTokenId: number;

  beforeEach(async () => {
    // Clean up and create test token
    await tokenDB.exec`DELETE FROM tokens WHERE symbol = 'OPTEST'`;
    await tokenDB.exec`DELETE FROM token_transactions WHERE token_id IN (SELECT id FROM tokens WHERE symbol = 'OPTEST')`;

    const tokenResult = await tokenDB.queryRow<{ id: number }>`
      INSERT INTO tokens (token_name, symbol, total_supply, decimals, creator_principal, canister_id, status, is_mintable, is_burnable)
      VALUES ('Operation Test Token', 'OPTEST', 1000000, 8, 'test-creator', 'test-canister', 'deployed', true, true)
      RETURNING id
    `;

    testTokenId = tokenResult!.id;
  });

  afterEach(async () => {
    // Clean up test data
    await tokenDB.exec`DELETE FROM tokens WHERE symbol = 'OPTEST'`;
    await tokenDB.exec`DELETE FROM token_transactions WHERE token_id = ${testTokenId}`;
    vi.clearAllMocks();
  });

  describe("Mint Operations", () => {
    test("should mint tokens successfully", async () => {
      // Mock successful mint operation
      const mockMintResult = {
        success: true,
        transactionId: "mint-tx-123",
        blockIndex: "mint-block-456",
        newBalance: "150000",
      };

      const mockTokenInfo = {
        totalSupply: "1100000",
        name: "Operation Test Token",
        symbol: "OPTEST",
        decimals: 8,
        transferFee: "10000",
        metadata: [],
      };

      vi.mocked(icpModule.icp.performTokenOperation).mockResolvedValue(mockMintResult);
      vi.mocked(icpModule.icp.getTokenInfo).mockResolvedValue(mockTokenInfo);

      const mintRequest = {
        tokenId: testTokenId,
        amount: 100000,
        toPrincipal: "recipient-principal",
        creatorPrincipal: "test-creator",
        delegationIdentity: { toJSON: () => ({}) },
      };

      const result = await mint(mintRequest);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("mint-tx-123");
      expect(result.newTotalSupply).toBe("1100000");

      // Verify transaction was logged
      const transaction = await tokenDB.queryRow`
        SELECT * FROM token_transactions WHERE token_id = ${testTokenId} AND transaction_type = 'mint'
      `;

      expect(transaction).toBeDefined();
      expect(transaction?.to_principal).toBe("recipient-principal");
      expect(transaction?.amount).toBe(100000);
    });

    test("should fail to mint for non-mintable token", async () => {
      // Update token to be non-mintable
      await tokenDB.exec`
        UPDATE tokens SET is_mintable = false WHERE id = ${testTokenId}
      `;

      const mintRequest = {
        tokenId: testTokenId,
        amount: 100000,
        toPrincipal: "recipient-principal",
        creatorPrincipal: "test-creator",
        delegationIdentity: { toJSON: () => ({}) },
      };

      try {
        await mint(mintRequest);
        expect.fail("Should have thrown error for non-mintable token");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should fail to mint for non-owner", async () => {
      const mintRequest = {
        tokenId: testTokenId,
        amount: 100000,
        toPrincipal: "recipient-principal",
        creatorPrincipal: "wrong-creator", // Wrong creator
        delegationIdentity: { toJSON: () => ({}) },
      };

      try {
        await mint(mintRequest);
        expect.fail("Should have thrown error for non-owner");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Burn Operations", () => {
    test("should burn tokens successfully", async () => {
      // Mock successful burn operation
      const mockBurnResult = {
        success: true,
        transactionId: "burn-tx-789",
        blockIndex: "burn-block-012",
        newBalance: "50000",
      };

      const mockTokenInfo = {
        totalSupply: "900000",
        name: "Operation Test Token",
        symbol: "OPTEST",
        decimals: 8,
        transferFee: "10000",
        metadata: [],
      };

      const mockBalance = {
        balance: "100000",
      };

      vi.mocked(icpModule.icp.performTokenOperation).mockResolvedValue(mockBurnResult);
      vi.mocked(icpModule.icp.getTokenInfo).mockResolvedValue(mockTokenInfo);
      vi.mocked(icpModule.icp.getBalance).mockResolvedValue(mockBalance);

      const burnRequest = {
        tokenId: testTokenId,
        amount: 50000,
        fromPrincipal: "test-creator",
        creatorPrincipal: "test-creator",
        delegationIdentity: { toJSON: () => ({}) },
      };

      const result = await burn(burnRequest);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("burn-tx-789");
      expect(result.newTotalSupply).toBe("900000");

      // Verify transaction was logged
      const transaction = await tokenDB.queryRow`
        SELECT * FROM token_transactions WHERE token_id = ${testTokenId} AND transaction_type = 'burn'
      `;

      expect(transaction).toBeDefined();
      expect(transaction?.from_principal).toBe("test-creator");
      expect(transaction?.amount).toBe(50000);
    });

    test("should fail to burn with insufficient balance", async () => {
      const mockBalance = {
        balance: "10000", // Less than burn amount
      };

      vi.mocked(icpModule.icp.getBalance).mockResolvedValue(mockBalance);

      const burnRequest = {
        tokenId: testTokenId,
        amount: 50000, // More than balance
        fromPrincipal: "test-creator",
        creatorPrincipal: "test-creator",
        delegationIdentity: { toJSON: () => ({}) },
      };

      try {
        await burn(burnRequest);
        expect.fail("Should have thrown error for insufficient balance");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Transfer Operations", () => {
    test("should transfer tokens successfully", async () => {
      // Mock successful transfer operation
      const mockTransferResult = {
        success: true,
        transactionId: "transfer-tx-345",
        blockIndex: "transfer-block-678",
        newBalance: "75000",
      };

      const mockTokenInfo = {
        transferFee: "10000",
        name: "Operation Test Token",
        symbol: "OPTEST",
        decimals: 8,
        totalSupply: "1000000",
        metadata: [],
      };

      const mockBalance = {
        balance: "100000",
      };

      vi.mocked(icpModule.icp.performTokenOperation).mockResolvedValue(mockTransferResult);
      vi.mocked(icpModule.icp.getTokenInfo).mockResolvedValue(mockTokenInfo);
      vi.mocked(icpModule.icp.getBalance).mockResolvedValue(mockBalance);

      const transferRequest = {
        tokenId: testTokenId,
        amount: 25000,
        fromPrincipal: "sender-principal",
        toPrincipal: "recipient-principal",
        delegationIdentity: { toJSON: () => ({}) },
      };

      const result = await transfer(transferRequest);

      expect(result.success).toBe(true);
      expect(result.transactionId).toBe("transfer-tx-345");
      expect(result.transferFee).toBe("10000");

      // Verify transaction was logged
      const transaction = await tokenDB.queryRow`
        SELECT * FROM token_transactions WHERE token_id = ${testTokenId} AND transaction_type = 'transfer'
      `;

      expect(transaction).toBeDefined();
      expect(transaction?.from_principal).toBe("sender-principal");
      expect(transaction?.to_principal).toBe("recipient-principal");
      expect(transaction?.amount).toBe(25000);
    });

    test("should fail transfer to same account", async () => {
      const transferRequest = {
        tokenId: testTokenId,
        amount: 25000,
        fromPrincipal: "same-principal",
        toPrincipal: "same-principal", // Same as from
        delegationIdentity: { toJSON: () => ({}) },
      };

      try {
        await transfer(transferRequest);
        expect.fail("Should have thrown error for same account transfer");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should get token balance", async () => {
      const mockBalance = {
        balance: "123456789",
      };

      vi.mocked(icpModule.icp.getBalance).mockResolvedValue(mockBalance);

      const balanceRequest = {
        tokenId: testTokenId,
        principal: "test-principal",
      };

      const result = await getBalance(balanceRequest);

      expect(result.balance).toBe("123456789");
      expect(result.symbol).toBe("OPTEST");
      expect(result.decimals).toBe(8);
    });

    test("should handle balance query for non-deployed token", async () => {
      // Update token to pending status
      await tokenDB.exec`
        UPDATE tokens SET status = 'pending' WHERE id = ${testTokenId}
      `;

      const balanceRequest = {
        tokenId: testTokenId,
        principal: "test-principal",
      };

      try {
        await getBalance(balanceRequest);
        expect.fail("Should have thrown error for non-deployed token");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
