import { APIError } from "encore.dev/api";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: any) => string;
}

class RateLimiter {
  private requests = new Map<string, { count: number; resetTime: number }>();

  constructor(private config: RateLimitConfig) {}

  async checkLimit(key: string): Promise<void> {
    const now = Date.now();
    const record = this.requests.get(key);

    if (!record || now > record.resetTime) {
      // New window or expired window
      this.requests.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs
      });
      return;
    }

    if (record.count >= this.config.maxRequests) {
      const resetInSeconds = Math.ceil((record.resetTime - now) / 1000);
      throw APIError.resourceExhausted(
        "Rate limit exceeded",
        { retryAfter: `${resetInSeconds}s` }
      );
    }

    record.count++;
  }

  // Cleanup expired entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.requests.entries()) {
      if (now > record.resetTime) {
        this.requests.delete(key);
      }
    }
  }
}

// Rate limiters for different operations
export const tokenCreationLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5 // 5 tokens per minute per user
});

export const tokenOperationLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30 // 30 operations per minute per user
});

export const searchLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100 // 100 searches per minute per IP
});

// Cleanup expired rate limit entries every 5 minutes
setInterval(() => {
  tokenCreationLimiter.cleanup();
  tokenOperationLimiter.cleanup();
  searchLimiter.cleanup();
}, 5 * 60 * 1000);
