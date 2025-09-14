import { expect, test, describe, beforeEach, afterEach } from "vitest";
import { analyticsDB } from "./db";
import { getTokenMetrics, getPlatformStats, recordTokenMetrics, recordDailyStats } from "./token_metrics";
import { tokenDB } from "../token/db";

describe("Analytics Token Metrics", () => {
  beforeEach(async () => {
    // Clean up test data
    await analyticsDB.exec`DELETE FROM token_metrics WHERE token_id IN (999, 1000)`;
    await analyticsDB.exec`DELETE FROM daily_stats WHERE stat_date = '2024-01-01'`;
    await tokenDB.exec`DELETE FROM tokens WHERE id IN (999, 1000)`;
  });

  afterEach(async () => {
    // Clean up test data
    await analyticsDB.exec`DELETE FROM token_metrics WHERE token_id IN (999, 1000)`;
    await analyticsDB.exec`DELETE FROM daily_stats WHERE stat_date = '2024-01-01'`;
    await tokenDB.exec`DELETE FROM tokens WHERE id IN (999, 1000)`;
  });

  test("should record token metrics successfully", async () => {
    // Create test token
    await tokenDB.exec`
      INSERT INTO tokens (id, token_name, symbol, total_supply, decimals, creator_principal, status)
      VALUES (999, 'Test Token', 'TEST', 1000000, 8, 'test-principal', 'deployed')
    `;

    const metricsData = {
      totalSupply: 1000000,
      holderCount: 50,
      transferCount: 100,
      mintCount: 5,
      burnCount: 2,
      volume24h: 50000,
    };

    await recordTokenMetrics(999, metricsData);

    // Verify metrics were recorded
    const metrics = await analyticsDB.queryRow`
      SELECT * FROM token_metrics WHERE token_id = 999
    `;

    expect(metrics).toBeDefined();
    expect(metrics?.total_supply).toBe(1000000);
    expect(metrics?.holder_count).toBe(50);
    expect(metrics?.transfer_count).toBe(100);
  });

  test("should get token metrics with summary", async () => {
    // Create test token
    await tokenDB.exec`
      INSERT INTO tokens (id, token_name, symbol, total_supply, decimals, creator_principal, status)
      VALUES (1000, 'Test Token 2', 'TEST2', 2000000, 8, 'test-principal', 'deployed')
    `;

    // Insert test metrics
    const today = new Date().toISOString().split('T')[0];
    await analyticsDB.exec`
      INSERT INTO token_metrics (token_id, metric_date, total_supply, holder_count, transfer_count, mint_count, burn_count, volume_24h)
      VALUES (1000, ${today}, 2000000, 75, 150, 10, 5, 75000)
    `;

    const result = await getTokenMetrics({ tokenId: 1000, days: 30 });

    expect(result.metrics).toBeDefined();
    expect(result.metrics.length).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
    expect(result.summary.currentSupply).toBe(2000000);
    expect(result.summary.totalTransfers).toBe(150);
  });

  test("should handle invalid token ID", async () => {
    const result = await getTokenMetrics({ tokenId: 99999, days: 30 });
    
    // Should throw an error for non-existent token
    expect(result).toBeUndefined();
  });

  test("should get platform stats", async () => {
    // Insert test daily stats
    await analyticsDB.exec`
      INSERT INTO daily_stats (stat_date, total_tokens_created, total_transactions, total_volume, active_tokens, new_holders, total_holders)
      VALUES ('2024-01-01', 5, 100, 250000, 3, 25, 125)
    `;

    const stats = await getPlatformStats();

    expect(stats).toBeDefined();
    expect(stats.totalTokens).toBeGreaterThanOrEqual(0);
    expect(stats.totalTransactions).toBeGreaterThanOrEqual(0);
    expect(stats.dailyStats).toBeDefined();
  });

  test("should record daily stats", async () => {
    const statsData = {
      tokensCreated: 5,
      transactions: 100,
      volume: 250000,
      activeTokens: 3,
      newHolders: 25,
      totalHolders: 125,
    };

    await recordDailyStats(statsData);

    // Verify stats were recorded
    const today = new Date().toISOString().split('T')[0];
    const stats = await analyticsDB.queryRow`
      SELECT * FROM daily_stats WHERE stat_date = ${today}
    `;

    expect(stats).toBeDefined();
    expect(stats?.total_tokens_created).toBe(5);
    expect(stats?.total_transactions).toBe(100);
    expect(stats?.total_volume).toBe(250000);
  });

  test("should handle upsert for existing daily stats", async () => {
    const today = new Date().toISOString().split('T')[0];
    
    // Insert initial stats
    await recordDailyStats({
      tokensCreated: 3,
      transactions: 50,
      volume: 100000,
      activeTokens: 2,
      newHolders: 10,
      totalHolders: 100,
    });

    // Update with new stats
    await recordDailyStats({
      tokensCreated: 5,
      transactions: 75,
      volume: 150000,
      activeTokens: 3,
      newHolders: 15,
      totalHolders: 115,
    });

    const stats = await analyticsDB.queryRow`
      SELECT * FROM daily_stats WHERE stat_date = ${today}
    `;

    expect(stats?.total_tokens_created).toBe(5);
    expect(stats?.total_transactions).toBe(75);
    expect(stats?.total_volume).toBe(150000);
  });
});
