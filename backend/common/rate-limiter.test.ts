import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { tokenCreationLimiter, tokenOperationLimiter, searchLimiter } from "./rate-limiter";
import { tokenDB } from "../token/db";

describe("Rate Limiter", () => {
  beforeEach(async () => {
    // Clean up test rate limit data
    await tokenDB.exec`DELETE FROM rate_limits WHERE key LIKE 'test-%'`;
  });

  afterEach(async () => {
    // Clean up test rate limit data
    await tokenDB.exec`DELETE FROM rate_limits WHERE key LIKE 'test-%'`;
  });

  test("should allow requests within limit", async () => {
    const testKey = "test-user-1";
    
    // First request should be allowed
    await expect(tokenCreationLimiter.checkLimit(testKey)).resolves.not.toThrow();
    
    // Second request should be allowed
    await expect(tokenCreationLimiter.checkLimit(testKey)).resolves.not.toThrow();
  });

  test("should block requests exceeding limit", async () => {
    const testKey = "test-user-2";
    
    // Make requests up to the limit
    for (let i = 0; i < 5; i++) {
      await tokenCreationLimiter.checkLimit(testKey);
    }
    
    // Next request should be blocked
    await expect(tokenCreationLimiter.checkLimit(testKey)).rejects.toThrow();
  });

  test("should reset limits after time window", async () => {
    const testKey = "test-user-3";
    
    // Fill up the rate limit
    for (let i = 0; i < 5; i++) {
      await tokenCreationLimiter.checkLimit(testKey);
    }
    
    // Manually update the window to simulate time passing
    const now = new Date();
    const pastWindow = new Date(now.getTime() - 2 * 60 * 1000); // 2 minutes ago
    
    await tokenDB.exec`
      UPDATE rate_limits 
      SET window_start = ${pastWindow}, window_end = ${now}
      WHERE key = ${testKey}
    `;
    
    // Should be allowed again in new window
    await expect(tokenCreationLimiter.checkLimit(testKey)).resolves.not.toThrow();
  });

  test("should handle different limiters independently", async () => {
    const testKey = "test-user-4";
    
    // Fill up token creation limit
    for (let i = 0; i < 5; i++) {
      await tokenCreationLimiter.checkLimit(testKey);
    }
    
    // Token operation limiter should still work
    await expect(tokenOperationLimiter.checkLimit(testKey)).resolves.not.toThrow();
    
    // Search limiter should still work
    await expect(searchLimiter.checkLimit(testKey)).resolves.not.toThrow();
  });

  test("should handle different users independently", async () => {
    const testKey1 = "test-user-5";
    const testKey2 = "test-user-6";
    
    // Fill up limit for user 1
    for (let i = 0; i < 5; i++) {
      await tokenCreationLimiter.checkLimit(testKey1);
    }
    
    // User 2 should still be allowed
    await expect(tokenCreationLimiter.checkLimit(testKey2)).resolves.not.toThrow();
  });

  test("should handle empty key gracefully", async () => {
    // Should use "anonymous" as fallback
    await expect(tokenCreationLimiter.checkLimit("")).resolves.not.toThrow();
    await expect(tokenCreationLimiter.checkLimit(null as any)).resolves.not.toThrow();
    await expect(tokenCreationLimiter.checkLimit(undefined as any)).resolves.not.toThrow();
  });

  test("should provide retry information in error", async () => {
    const testKey = "test-user-7";
    
    // Fill up the rate limit
    for (let i = 0; i < 5; i++) {
      await tokenCreationLimiter.checkLimit(testKey);
    }
    
    try {
      await tokenCreationLimiter.checkLimit(testKey);
      expect.fail("Should have thrown rate limit error");
    } catch (error: any) {
      expect(error.message).toContain("Rate limit exceeded");
      // Should contain retry information
      expect(error.details?.retryAfter).toBeDefined();
      expect(error.details?.limiter).toBe("token_create");
    }
  });

  test("should handle concurrent requests correctly", async () => {
    const testKey = "test-user-8";
    
    // Make multiple concurrent requests
    const promises = Array.from({ length: 10 }, () => 
      tokenCreationLimiter.checkLimit(testKey).catch(() => "blocked")
    );
    
    const results = await Promise.all(promises);
    
    // Only first 5 should succeed
    const successes = results.filter(r => r !== "blocked").length;
    expect(successes).toBe(5);
    
    const blocked = results.filter(r => r === "blocked").length;
    expect(blocked).toBe(5);
  });
});
