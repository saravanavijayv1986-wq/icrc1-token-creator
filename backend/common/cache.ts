interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache<T> {
  private storage = new Map<string, CacheEntry<T>>();
  private readonly defaultTTL: number;

  constructor(defaultTTLSeconds: number = 300) {
    this.defaultTTL = defaultTTLSeconds * 1000;
    
    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  set(key: string, value: T, ttlSeconds?: number): void {
    const ttl = (ttlSeconds || this.defaultTTL / 1000) * 1000;
    this.storage.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  get(key: string): T | null {
    const entry = this.storage.get(key);
    
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.storage.delete(key);
      return null;
    }

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  delete(key: string): boolean {
    return this.storage.delete(key);
  }

  clear(): void {
    this.storage.clear();
  }

  size(): number {
    this.cleanup();
    return this.storage.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.storage.entries()) {
      if (now > entry.expiresAt) {
        this.storage.delete(key);
      }
    }
  }

  // Get with callback to populate cache if missing
  async getOrSet(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttlSeconds);
    return value;
  }
}

// Global cache instances
export const tokenCache = new Cache<any>(300); // 5 minutes
export const canisterStatusCache = new Cache<any>(60); // 1 minute
export const balanceCache = new Cache<any>(30); // 30 seconds
