import { api } from "encore.dev/api";
import { Query } from "encore.dev/api";
import { analyticsDB } from "./db";
import { tokenDB } from "../token/db";
import { validate } from "../common/validation";
import { handleError, ErrorCode, AppError } from "../common/errors";
import { metrics, monitor } from "../common/monitoring";
import log from "encore.dev/log";

export interface TokenMetrics {
  tokenId: number;
  metricDate: Date;
  totalSupply: number;
  holderCount: number;
  transferCount: number;
  mintCount: number;
  burnCount: number;
  volume24h: number;
}

export interface GetTokenMetricsRequest {
  tokenId: number;
  days?: Query<number>;
}

export interface GetTokenMetricsResponse {
  metrics: TokenMetrics[];
  summary: {
    currentSupply: number;
    totalTransfers: number;
    totalMints: number;
    totalBurns: number;
    avgDailyVolume: number;
  };
}

// Retrieves analytics metrics for a specific token.
export const getTokenMetrics = api<GetTokenMetricsRequest, GetTokenMetricsResponse>(
  { expose: true, method: "GET", path: "/analytics/tokens/:tokenId/metrics" },
  monitor("analytics.getTokenMetrics", async (req) => {
    try {
      // Input validation
      validate()
        .required(req.tokenId, "tokenId")
        .number(req.tokenId, "tokenId", { min: 1, integer: true })
        .throwIfInvalid();

      const days = req.days ?? 30;
      if (days < 1 || days > 365) {
        throw new AppError(
          ErrorCode.VALIDATION_ERROR,
          "Days parameter must be between 1 and 365"
        );
      }

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Verify token exists in token database
      const tokenExists = await tokenDB.queryRow<{ id: number }>`
        SELECT id FROM tokens WHERE id = ${req.tokenId}
      `;

      if (!tokenExists) {
        throw new AppError(ErrorCode.RESOURCE_NOT_FOUND, "Token not found");
      }

      // Get metrics for the specified period
      const metricsRows = await analyticsDB.queryAll<{
        token_id: number;
        metric_date: Date;
        total_supply: number;
        holder_count: number;
        transfer_count: number;
        mint_count: number;
        burn_count: number;
        volume_24h: number;
      }>`
        SELECT 
          token_id, metric_date, total_supply, holder_count,
          transfer_count, mint_count, burn_count, volume_24h
        FROM token_metrics 
        WHERE token_id = ${req.tokenId} 
          AND metric_date >= ${startDate.toISOString().split('T')[0]}
        ORDER BY metric_date DESC
      `;

      const metricsList: TokenMetrics[] = metricsRows.map(row => ({
        tokenId: row.token_id,
        metricDate: row.metric_date,
        totalSupply: row.total_supply,
        holderCount: row.holder_count,
        transferCount: row.transfer_count,
        mintCount: row.mint_count,
        burnCount: row.burn_count,
        volume24h: row.volume_24h,
      }));

      // Calculate summary statistics
      const totalTransfers = metricsRows.reduce((sum, row) => sum + row.transfer_count, 0);
      const totalMints = metricsRows.reduce((sum, row) => sum + row.mint_count, 0);
      const totalBurns = metricsRows.reduce((sum, row) => sum + row.burn_count, 0);
      const avgDailyVolume = metricsRows.length > 0 
        ? metricsRows.reduce((sum, row) => sum + row.volume_24h, 0) / metricsRows.length 
        : 0;

      // Get current supply from token table
      const tokenRow = await tokenDB.queryRow<{ total_supply: number }>`
        SELECT total_supply FROM tokens WHERE id = ${req.tokenId}
      `;

      const summary = {
        currentSupply: tokenRow?.total_supply ?? 0,
        totalTransfers,
        totalMints,
        totalBurns,
        avgDailyVolume,
      };

      metrics.increment("analytics.token_metrics_retrieved");

      log.info("Token metrics retrieved", { 
        tokenId: req.tokenId, 
        days, 
        metricsCount: metricsList.length 
      });

      return { metrics: metricsList, summary };
    } catch (error) {
      return handleError(error as Error, "analytics.getTokenMetrics");
    }
  })
);

export interface PlatformStats {
  totalTokens: number;
  totalTransactions: number;
  totalVolume: number;
  activeTokens: number;
  dailyStats: Array<{
    date: Date;
    tokensCreated: number;
    transactions: number;
    volume: number;
  }>;
}

// Retrieves platform-wide analytics and statistics.
export const getPlatformStats = api<void, PlatformStats>(
  { expose: true, method: "GET", path: "/analytics/platform" },
  monitor("analytics.getPlatformStats", async () => {
    try {
      // Get overall platform statistics from token database
      const platformRow = await tokenDB.queryRow<{
        total_tokens: number;
        total_transactions: number;
        active_tokens: number;
      }>`
        SELECT 
          COUNT(DISTINCT t.id) as total_tokens,
          COALESCE(COUNT(tt.id), 0) as total_transactions,
          COUNT(DISTINCT CASE WHEN t.status = 'deployed' THEN t.id END) as active_tokens
        FROM tokens t
        LEFT JOIN token_transactions tt ON t.id = tt.token_id
      `;

      // Get daily stats for the last 30 days from analytics database
      const dailyStatsRows = await analyticsDB.queryAll<{
        stat_date: Date;
        total_tokens_created: number;
        total_transactions: number;
        total_volume: number;
      }>`
        SELECT stat_date, total_tokens_created, total_transactions, total_volume
        FROM daily_stats 
        WHERE stat_date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY stat_date DESC
      `;

      const dailyStats = dailyStatsRows.map(row => ({
        date: row.stat_date,
        tokensCreated: row.total_tokens_created,
        transactions: row.total_transactions,
        volume: row.total_volume,
      }));

      const totalVolume = dailyStatsRows.reduce((sum, row) => sum + row.total_volume, 0);

      metrics.increment("analytics.platform_stats_retrieved");

      log.info("Platform stats retrieved", { 
        totalTokens: platformRow?.total_tokens ?? 0,
        activeTokens: platformRow?.active_tokens ?? 0,
        dailyStatsCount: dailyStats.length
      });

      return {
        totalTokens: platformRow?.total_tokens ?? 0,
        totalTransactions: platformRow?.total_transactions ?? 0,
        totalVolume,
        activeTokens: platformRow?.active_tokens ?? 0,
        dailyStats,
      };
    } catch (error) {
      return handleError(error as Error, "analytics.getPlatformStats");
    }
  })
);

// Helper function to record token metrics (called by other services)
export async function recordTokenMetrics(tokenId: number, metricsData: Omit<TokenMetrics, 'tokenId' | 'metricDate'>): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    await analyticsDB.exec`
      INSERT INTO token_metrics (
        token_id, metric_date, total_supply, holder_count, 
        transfer_count, mint_count, burn_count, volume_24h
      ) 
      VALUES (
        ${tokenId}, ${today}, ${metricsData.totalSupply}, ${metricsData.holderCount},
        ${metricsData.transferCount}, ${metricsData.mintCount}, ${metricsData.burnCount}, ${metricsData.volume24h}
      )
      ON CONFLICT (token_id, metric_date) 
      DO UPDATE SET
        total_supply = EXCLUDED.total_supply,
        holder_count = EXCLUDED.holder_count,
        transfer_count = EXCLUDED.transfer_count,
        mint_count = EXCLUDED.mint_count,
        burn_count = EXCLUDED.burn_count,
        volume_24h = EXCLUDED.volume_24h,
        updated_at = NOW()
    `;

    log.info("Token metrics recorded", { tokenId, date: today });
  } catch (error) {
    log.error("Failed to record token metrics", { tokenId, error });
  }
}

// Helper function to record daily platform stats
export async function recordDailyStats(stats: {
  tokensCreated: number;
  transactions: number;
  volume: number;
  activeTokens: number;
  newHolders: number;
  totalHolders: number;
}): Promise<void> {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    await analyticsDB.exec`
      INSERT INTO daily_stats (
        stat_date, total_tokens_created, total_transactions, total_volume,
        active_tokens, new_holders, total_holders
      ) 
      VALUES (
        ${today}, ${stats.tokensCreated}, ${stats.transactions}, ${stats.volume},
        ${stats.activeTokens}, ${stats.newHolders}, ${stats.totalHolders}
      )
      ON CONFLICT (stat_date) 
      DO UPDATE SET
        total_tokens_created = EXCLUDED.total_tokens_created,
        total_transactions = EXCLUDED.total_transactions,
        total_volume = EXCLUDED.total_volume,
        active_tokens = EXCLUDED.active_tokens,
        new_holders = EXCLUDED.new_holders,
        total_holders = EXCLUDED.total_holders,
        updated_at = NOW()
    `;

    log.info("Daily stats recorded", { date: today, stats });
  } catch (error) {
    log.error("Failed to record daily stats", { error });
  }
}
