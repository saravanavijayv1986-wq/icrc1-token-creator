// Environment-specific configuration (Vite)
// Use import.meta.env.MODE for build-time mode detection.
const mode = import.meta.env.MODE;
const isProduction = mode === 'production';
const isDevelopment = mode === 'development';

// Configuration for wallet integration and Internet Identity
export const walletConfig = {
  // Internet Identity provider URL
  identityProviderUrl: isProduction 
    ? "https://identity.ic0.app"
    : "https://identity.ic0.app", // Use production II even in dev for real tokens
  
  // Supported wallet types
  supportedWallets: ["internet-identity", "nfid"],
  
  // Default network
  network: isProduction ? "mainnet" : "local",
  
  // Host for IC agent
  host: isProduction ? "https://ic0.app" : "https://ic0.app", // Use mainnet for real deployments
  
  // Internet Identity configuration
  internetIdentity: {
    // Maximum delegation expiration (8 hours in production, 24 hours in dev)
    maxTimeToLive: BigInt((isProduction ? 8 : 24) * 60 * 60 * 1000 * 1000 * 1000),
    
    // Whether to create identity if it doesn't exist
    createIfMissing: true,
    
    // Identity provider canister ID
    canisterId: "rdmx6-jaaaa-aaaah-qca7q-cai", // Internet Identity canister
    
    // Derivation origin for non-production environments to ensure consistent principals.
    derivationOrigin: isDevelopment ? window.location.origin : undefined,
  },
};

// API configuration
export const apiConfig = {
  // Base URL for backend API calls (auto-configured by Encore.ts)
  baseUrl: "",
  
  // Request timeout in milliseconds
  timeout: isProduction ? 30000 : 10000, // Longer timeout in production
  
  // Retry configuration
  retry: {
    attempts: isProduction ? 3 : 1,
    delay: 1000,
  },
};

// Analytics configuration
export const analyticsConfig = {
  // Enable analytics tracking
  enabled: isProduction,
  
  // Analytics update interval (milliseconds)
  updateInterval: isProduction ? 60000 : 30000, // 1 minute in prod, 30s in dev
  
  // Error tracking
  errorTracking: {
    enabled: isProduction,
    sampleRate: 0.1, // 10% sampling in production
  },
};

// Token creation configuration
export const tokenConfig = {
  // Default token parameters
  defaults: {
    decimals: 8,
    isMintable: false,
    isBurnable: false,
  },
  
  // Fee configuration
  fees: {
    creationFeeICP: "1", // 1 ICP fee for token creation
    minimumBalance: "0.1", // Minimum ICP balance required
    estimatedCycles: "3000000000000", // 3T cycles
  },
  
  // Validation rules
  validation: {
    minNameLength: 2,
    maxNameLength: 50,
    minSymbolLength: 2,
    maxSymbolLength: 10,
    minSupply: 1,
    maxSupply: 1000000000000,
    minDecimals: 0,
    maxDecimals: 18,
    maxLogoSize: 2 * 1024 * 1024, // 2MB
    allowedImageTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
  },
  
  // Feature limits
  limits: {
    // Rate limits
    creationPerHour: isProduction ? 5 : 50,
    operationsPerMinute: isProduction ? 30 : 100,
    
    // Resource limits
    maxTokensPerUser: isProduction ? 100 : 1000,
  },
};

// Security configuration
export const securityConfig = {
  // Content Security Policy
  csp: {
    enabled: isProduction,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", "data:", "https:"],
      'connect-src': ["'self'", "https://ic0.app", "https://*.ic0.app"],
    },
  },
  
  // Request validation
  validation: {
    enabled: true,
    sanitizeInputs: true,
    maxRequestSize: 10 * 1024 * 1024, // 10MB
  },
};

// Performance configuration
export const performanceConfig = {
  // Caching
  cache: {
    enabled: true,
    ttl: {
      tokens: 5 * 60 * 1000, // 5 minutes
      balances: 30 * 1000, // 30 seconds
      transactions: 60 * 1000, // 1 minute
      analytics: 10 * 60 * 1000, // 10 minutes
    },
  },
  
  // Lazy loading
  lazyLoading: {
    enabled: true,
    threshold: 0.1, // Load when 10% visible
  },
  
  // Virtual scrolling for large lists
  virtualScrolling: {
    enabled: true,
    itemHeight: 80,
    overscan: 5,
  },
};

// Monitoring configuration
export const monitoringConfig = {
  // Performance monitoring
  performance: {
    enabled: isProduction,
    sampleRate: 0.1, // 10% sampling
  },
  
  // Error reporting
  errorReporting: {
    enabled: isProduction,
    endpoint: "", // Configure your error reporting service
  },
  
  // User analytics
  userAnalytics: {
    enabled: isProduction,
    trackPageViews: true,
    trackUserActions: true,
    respectDoNotTrack: true,
  },
};

// Feature flags
export const featureFlags = {
  // Enable advanced analytics
  advancedAnalytics: isProduction,
  
  // Enable real-time updates
  realTimeUpdates: true,
  
  // Enable dark mode
  darkMode: true,
  
  // Enable token marketplace
  marketplace: false, // Coming soon
  
  // Enable multi-signature support
  multiSig: false, // Future feature
  
  // Enable token governance
  governance: false, // Future feature
};

// Export environment info
export const environment = {
  isProduction,
  isDevelopment,
  version: "1.0.0",
  buildTime: new Date().toISOString(),
};
