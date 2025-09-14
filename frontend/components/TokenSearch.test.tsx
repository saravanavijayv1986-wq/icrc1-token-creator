import { expect, test, describe, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TokenSearch from "./TokenSearch";
import backend from "~backend/client";

// Mock the backend
vi.mock("~backend/client", () => ({
  default: {
    token: {
      search: vi.fn(),
      getPopular: vi.fn(),
    },
  },
}));

// Mock React Router
vi.mock("react-router-dom", () => ({
  Link: ({ to, children, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

describe("TokenSearch Component", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const renderWithQuery = (component: React.ReactElement) => {
    return render(
      <QueryClientProvider client={queryClient}>
        {component}
      </QueryClientProvider>
    );
  };

  test("should render popular tokens section", async () => {
    const mockPopularTokens = {
      tokens: [
        {
          id: 1,
          tokenName: "Popular Token 1",
          symbol: "POP1",
          totalSupply: 1000000,
          decimals: 8,
          logoUrl: null,
          canisterId: "test-canister-1",
          creatorPrincipal: "test-creator",
          createdAt: new Date(),
          isMintable: true,
          isBurnable: false,
          status: "deployed",
          rank: 1,
        },
        {
          id: 2,
          tokenName: "Popular Token 2",
          symbol: "POP2",
          totalSupply: 2000000,
          decimals: 8,
          logoUrl: "https://example.com/logo.png",
          canisterId: "test-canister-2",
          creatorPrincipal: "test-creator",
          createdAt: new Date(),
          isMintable: false,
          isBurnable: true,
          status: "deployed",
          rank: 2,
        },
      ],
    };

    vi.mocked(backend.token.getPopular).mockResolvedValue(mockPopularTokens);
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: [],
        supplyRange: { min: 0, max: 0 },
      },
    });

    renderWithQuery(<TokenSearch />);

    await waitFor(() => {
      expect(screen.getByText("Popular Tokens")).toBeInTheDocument();
      expect(screen.getByText("Popular Token 1")).toBeInTheDocument();
      expect(screen.getByText("Popular Token 2")).toBeInTheDocument();
      expect(screen.getByText("POP1")).toBeInTheDocument();
      expect(screen.getByText("POP2")).toBeInTheDocument();
    });
  });

  test("should handle search input", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: [],
        supplyRange: { min: 0, max: 0 },
      },
    });

    renderWithQuery(<TokenSearch />);

    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    
    fireEvent.change(searchInput, { target: { value: "TEST" } });

    await waitFor(() => {
      expect(backend.token.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "TEST",
        })
      );
    });
  });

  test("should debounce search input", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: [],
        supplyRange: { min: 0, max: 0 },
      },
    });

    renderWithQuery(<TokenSearch />);

    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    
    // Type quickly
    fireEvent.change(searchInput, { target: { value: "T" } });
    fireEvent.change(searchInput, { target: { value: "TE" } });
    fireEvent.change(searchInput, { target: { value: "TES" } });
    fireEvent.change(searchInput, { target: { value: "TEST" } });

    // Should only call search once after debounce delay
    await waitFor(() => {
      expect(backend.token.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "TEST",
        })
      );
    });

    // Verify it wasn't called for intermediate values
    expect(backend.token.search).toHaveBeenCalledTimes(1);
  });

  test("should display search results", async () => {
    const mockSearchResults = {
      tokens: [
        {
          id: 3,
          tokenName: "Search Result Token",
          symbol: "SRT",
          totalSupply: 500000,
          decimals: 8,
          logoUrl: null,
          canisterId: "search-canister",
          creatorPrincipal: "search-creator",
          createdAt: new Date(),
          isMintable: true,
          isBurnable: false,
          status: "deployed",
          rank: 1,
        },
      ],
      total: 1,
      filters: {
        categories: ["DeFi", "Gaming"],
        statusOptions: ["deployed", "deploying"],
        supplyRange: { min: 1000, max: 1000000 },
      },
    };

    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue(mockSearchResults);

    renderWithQuery(<TokenSearch />);

    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    fireEvent.change(searchInput, { target: { value: "Search" } });

    await waitFor(() => {
      expect(screen.getByText("1 tokens found")).toBeInTheDocument();
      expect(screen.getByText("Search Result Token")).toBeInTheDocument();
      expect(screen.getByText("SRT")).toBeInTheDocument();
      expect(screen.getByText("500,000 supply")).toBeInTheDocument();
    });
  });

  test("should show no results message", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: [],
        supplyRange: { min: 0, max: 0 },
      },
    });

    renderWithQuery(<TokenSearch />);

    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    fireEvent.change(searchInput, { target: { value: "NONEXISTENT" } });

    await waitFor(() => {
      expect(screen.getByText("No tokens found")).toBeInTheDocument();
      expect(screen.getByText("Try adjusting your search criteria.")).toBeInTheDocument();
    });
  });

  test("should handle filter changes", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: ["deployed", "deploying"],
        supplyRange: { min: 0, max: 1000000 },
      },
    });

    renderWithQuery(<TokenSearch />);

    // Change status filter
    const statusSelect = screen.getByDisplayValue("All Status");
    fireEvent.click(statusSelect);
    
    await waitFor(() => {
      const deployedOption = screen.getByText("Deployed");
      fireEvent.click(deployedOption);
    });

    await waitFor(() => {
      expect(backend.token.search).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "deployed",
        })
      );
    });
  });

  test("should reset filters", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: [],
        supplyRange: { min: 0, max: 0 },
      },
    });

    renderWithQuery(<TokenSearch />);

    // Set some filters first
    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    fireEvent.change(searchInput, { target: { value: "TEST" } });

    // Reset filters
    const resetButton = screen.getByText("Reset Filters");
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(searchInput).toHaveValue("");
      expect(backend.token.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: undefined,
          status: undefined,
        })
      );
    });
  });

  test("should toggle feature filters", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      tokens: [],
      total: 0,
      filters: {
        categories: [],
        statusOptions: [],
        supplyRange: { min: 0, max: 0 },
      },
    });

    renderWithQuery(<TokenSearch />);

    // Toggle mintable filter
    const mintableSwitch = screen.getByLabelText("Mintable Only");
    fireEvent.click(mintableSwitch);

    await waitFor(() => {
      expect(backend.token.search).toHaveBeenCalledWith(
        expect.objectContaining({
          isMintable: true,
        })
      );
    });

    // Toggle burnable filter
    const burnableSwitch = screen.getByLabelText("Burnable Only");
    fireEvent.click(burnableSwitch);

    await waitFor(() => {
      expect(backend.token.search).toHaveBeenCalledWith(
        expect.objectContaining({
          isMintable: true,
          isBurnable: true,
        })
      );
    });
  });

  test("should handle loading state", async () => {
    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockImplementation(() => 
      new Promise(resolve => setTimeout(() => resolve({
        tokens: [],
        total: 0,
        filters: { categories: [], statusOptions: [], supplyRange: { min: 0, max: 0 } },
      }), 100))
    );

    renderWithQuery(<TokenSearch />);

    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    fireEvent.change(searchInput, { target: { value: "LOADING" } });

    // Should show loading state
    expect(screen.getByText("Searching tokens...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Searching tokens...")).not.toBeInTheDocument();
    });
  });

  test("should display token status badges correctly", async () => {
    const mockTokens = {
      tokens: [
        {
          id: 1,
          tokenName: "Deployed Token",
          symbol: "DEP",
          totalSupply: 1000000,
          decimals: 8,
          logoUrl: null,
          canisterId: "deployed-canister",
          creatorPrincipal: "creator",
          createdAt: new Date(),
          isMintable: false,
          isBurnable: false,
          status: "deployed",
          rank: 1,
        },
        {
          id: 2,
          tokenName: "Deploying Token",
          symbol: "DEPL",
          totalSupply: 2000000,
          decimals: 8,
          logoUrl: null,
          canisterId: null,
          creatorPrincipal: "creator",
          createdAt: new Date(),
          isMintable: false,
          isBurnable: false,
          status: "deploying",
          rank: 2,
        },
      ],
    };

    vi.mocked(backend.token.getPopular).mockResolvedValue({ tokens: [] });
    vi.mocked(backend.token.search).mockResolvedValue({
      ...mockTokens,
      total: 2,
      filters: { categories: [], statusOptions: [], supplyRange: { min: 0, max: 0 } },
    });

    renderWithQuery(<TokenSearch />);

    const searchInput = screen.getByPlaceholderText("Search by token name or symbol...");
    fireEvent.change(searchInput, { target: { value: "dep" } });

    await waitFor(() => {
      expect(screen.getByText("Deployed")).toBeInTheDocument();
      expect(screen.getByText("Deploying")).toBeInTheDocument();
    });
  });
});
