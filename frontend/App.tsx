import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "@/components/ui/toaster";
import { WalletProvider } from "./hooks/useWallet";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Header from "./components/Header";
import HomePage from "./pages/HomePage";
import SearchPage from "./pages/SearchPage";
import CreateTokenPage from "./pages/CreateTokenPage";
import DashboardPage from "./pages/DashboardPage";
import AnalyticsPage from "./pages/AnalyticsPage";
import TokenDetailsPage from "./pages/TokenDetailsPage";
import { environment, performanceConfig } from "./config";

// Configure React Query with production-ready settings
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: performanceConfig.cache.ttl.tokens,
      retry: environment.isProduction ? 3 : 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: environment.isProduction,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: environment.isProduction ? 2 : 0,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
    },
  },
});

// Add global error handler for unhandled promise rejections
if (environment.isProduction) {
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
    // Report to error tracking service here
  });
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <WalletProvider>
          <Router>
            <div className="min-h-screen bg-background">
              <Header />
              <main className="pb-8">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/create" element={<CreateTokenPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/tokens/:id" element={<TokenDetailsPage />} />
                </Routes>
              </main>
              <Toaster />
            </div>
          </Router>
        </WalletProvider>
        {environment.isDevelopment && (
          <ReactQueryDevtools 
            initialIsOpen={false}
            position="bottom-right"
          />
        )}
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
