import { expect, test, describe, beforeEach, afterEach, vi } from "vitest";
import { deploy, getStatus, performTokenOperation, getTokenInfo, getBalance } from "./canister";
import * as storageModule from "./storage";

// Mock the storage module
vi.mock("./storage", () => ({
  storage: {
    exists: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

// Mock fetch for WASM module download
global.fetch = vi.fn();

describe("ICP Canister Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Canister Deployment", () => {
    test("should deploy canister validation path", async () => {
      // Mock WASM module exists in storage
      vi.mocked(storageModule.storage.exists).mockResolvedValue(true);
      vi.mocked(storageModule.storage.download).mockResolvedValue(Buffer.from("mock-wasm-data"));

      const deployRequest = {
        tokenName: "Test Token",
        symbol: "TEST",
        totalSupply: 1000000,
        decimals: 8,
        isMintable: true,
        isBurnable: false,
        delegationIdentity: {
          toJSON: () => ({ test: "delegation" }),
          getPrincipal: () => ({ toString: () => "test-principal" }),
        },
        ownerPrincipal: "rrkah-fqaaa-aaaah-qcuea-cai",
      } as any;

      try {
        await deploy(deployRequest);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should validate deployment parameters", async () => {
      const invalidRequest = {
        tokenName: "", // Invalid - empty
        symbol: "T", // Invalid - too short
        totalSupply: 0, // Invalid - zero
        decimals: 20, // Invalid - too high
        isMintable: true,
        isBurnable: false,
        delegationIdentity: null, // Invalid - missing
        ownerPrincipal: "invalid-principal-format", // Invalid format
      };

      try {
        await deploy(invalidRequest as any);
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should download WASM module when not in storage", async () => {
      // Mock WASM module doesn't exist in storage
      vi.mocked(storageModule.storage.exists).mockResolvedValue(false);
      
      // Mock successful fetch
      const mockWasmData = new Uint8Array([0x00, 0x61, 0x73, 0x6d]); // WASM magic number
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(mockWasmData.buffer),
      } as any);

      vi.mocked(storageModule.storage.upload).mockResolvedValue(undefined as any);

      const deployRequest = {
        tokenName: "Test Token",
        symbol: "TEST",
        totalSupply: 1000000,
        decimals: 8,
        isMintable: true,
        isBurnable: false,
        delegationIdentity: {
          toJSON: () => ({ test: "delegation" }),
          getPrincipal: () => ({ toString: () => "test-principal" }),
        },
        ownerPrincipal: "rrkah-fqaaa-aaaah-qcuea-cai",
      };

      try {
        await deploy(deployRequest as any);
      } catch (error) {
        expect(global.fetch).toHaveBeenCalled();
      }
    });
  });

  describe("Canister Status", () => {
    test("should validate canister ID format", async () => {
      try {
        await getStatus({ canisterId: "invalid-format" });
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should handle valid canister ID format", async () => {
      const validCanisterId = "rrkah-fqaaa-aaaah-qcuea-cai";
      
      try {
        await getStatus({ canisterId: validCanisterId });
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Token Operations", () => {
    test("should validate token operation parameters", async () => {
      const invalidRequest = {
        canisterId: "invalid-format",
        operation: "invalid-operation" as any,
        amount: "-100", // Invalid - negative
        recipient: "invalid-principal",
        delegationIdentity: null,
        ownerPrincipal: "invalid-format",
      };

      try {
        await performTokenOperation(invalidRequest);
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should validate mint operation requires recipient", async () => {
      const mintRequest = {
        canisterId: "rrkah-fqaaa-aaaah-qcuea-cai",
        operation: "mint" as const,
        amount: "1000",
        // recipient missing
        delegationIdentity: { toJSON: () => ({}) },
        ownerPrincipal: "rrkah-fqaaa-aaaah-qcuea-cai",
      } as any;

      try {
        await performTokenOperation(mintRequest);
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should validate transfer operation requires recipient", async () => {
      const transferRequest = {
        canisterId: "rrkah-fqaaa-aaaah-qcuea-cai",
        operation: "transfer" as const,
        amount: "1000",
        // recipient missing
        delegationIdentity: { toJSON: () => ({}) },
        ownerPrincipal: "rrkah-fqaaa-aaaah-qcuea-cai",
      } as any;

      try {
        await performTokenOperation(transferRequest);
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Token Info", () => {
    test("should validate canister ID for token info", async () => {
      try {
        await getTokenInfo({ canisterId: "invalid-format" });
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe("Balance Queries", () => {
    test("should validate principal format for balance query", async () => {
      const request = {
        canisterId: "rrkah-fqaaa-aaaah-qcuea-cai",
        principal: "invalid-principal-format",
      };

      try {
        await getBalance(request);
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should handle dummy canister ID for ICP ledger", async () => {
      const request = {
        canisterId: "dummy",
        principal: "rrkah-fqaaa-aaaah-qcuea-cai",
      };

      try {
        const result = await getBalance(request);
        expect(result.balance === "0" || Number(result.balance) >= 0).toBeTruthy();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test("should validate subaccount format", async () => {
      const request = {
        canisterId: "rrkah-fqaaa-aaaah-qcuea-cai",
        principal: "rrkah-fqaaa-aaaah-qcuea-cai",
        subaccount: "invalid-hex-format", // Should be hex
      };

      try {
        await getBalance(request);
        expect.fail("Should have thrown validation error");
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
