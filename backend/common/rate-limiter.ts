import { APIError } from "encore.dev/api";
import { tokenDB } from "../token/db";

interface RateLimiterOptions {
  name: string;
  windowMs: number;
  maxRequests: number;
}

class SQLRateLimiter {
  private name: string;
  private windowMs: number;
  private maxRequests: number;

  constructor(opts: RateLimiterOptions) {
    this.name = opts.name;
    this.windowMs = opts.windowMs;
    this.maxRequests = opts.maxRequests;
  }

  async checkLimit(key: string): Promise<void> {
    if (!key) {
      // Fallback key to avoid accidental global bucket
      key = "anonymous";
    }

    const now = Date.now();
    const windowStart = new Date(Math.floor(now / this.windowMs) * this.windowMs);
    const windowEnd = new Date(windowStart.getTime() + this.windowMs);

    // Upsert and increment the counter atomically
    const row = await tokenDB.rawQueryRow<{ count: number }>(
      `
      INSERT INTO rate_limits (limiter_name, key, window_start, window_end, count)
      VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (limiter_name, key, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count
      `,
      this.name, key, windowStart, windowEnd
    );

    const count = row?.count ?? 1;
    if (count > this.maxRequests) {
      const resetInMs = windowEnd.getTime() - now;
      const resetInSeconds = Math.max(1, Math.ceil(resetInMs / 1000));
      throw APIError.resourceExhausted(
        "Rate limit exceeded",
        { retryAfter: `${resetInSeconds}s`, limiter: this.name }
      );
    }
  }
}

// Pre-configured limiters
export const tokenCreationLimiter = new SQLRateLimiter({
  name: "token_create",
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5,
});

export const tokenOperationLimiter = new SQLRateLimiter({
  name: "token_operation",
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,
});

export const searchLimiter = new SQLRateLimiter({
  name: "search",
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
});
