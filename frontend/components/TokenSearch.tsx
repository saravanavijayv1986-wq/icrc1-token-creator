import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, Filter, SortAsc, SortDesc, TrendingUp, Coins } from "lucide-react";
import { Link } from "react-router-dom";
import backend from "~backend/client";
import type { SearchTokensRequest } from "~backend/token/search";

interface SearchFilters {
  query: string;
  category: string;
  minSupply: number;
  maxSupply: number;
  isMintable?: boolean;
  isBurnable?: boolean;
  status: string;
  sortBy: string;
  sortOrder: string;
}

export default function TokenSearch() {
  const [filters, setFilters] = useState<SearchFilters>({
    query: "",
    category: "all",
    minSupply: 0,
    maxSupply: 1000000000,
    status: "all",
    sortBy: "created_at",
    sortOrder: "desc",
  });

  const [debouncedQuery, setDebouncedQuery] = useState(filters.query);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(filters.query);
    }, 300);

    return () => clearTimeout(timer);
  }, [filters.query]);

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ["token-search", debouncedQuery, filters],
    queryFn: async () => {
      const params: SearchTokensRequest = {
        query: debouncedQuery || undefined,
        status: filters.status !== "all" ? filters.status : undefined,
        minSupply: filters.minSupply > 0 ? filters.minSupply : undefined,
        maxSupply: filters.maxSupply < 1000000000 ? filters.maxSupply : undefined,
        isMintable: filters.isMintable,
        isBurnable: filters.isBurnable,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: 20,
      };
      return await backend.token.search(params);
    },
  });

  const { data: popularTokens } = useQuery({
    queryKey: ["popular-tokens"],
    queryFn: async () => await backend.token.getPopular(),
  });

  const updateFilter = (key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const resetFilters = () => {
    setFilters({
      query: "",
      category: "all",
      minSupply: 0,
      maxSupply: 1000000000,
      status: "all",
      sortBy: "created_at",
      sortOrder: "desc",
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': return 'bg-green-500';
      case 'deploying': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="space-y-6">
      {/* Popular Tokens */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <TrendingUp className="h-5 w-5" />
            <span>Popular Tokens</span>
          </CardTitle>
          <CardDescription>
            Trending tokens based on activity and volume.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {popularTokens?.tokens.slice(0, 6).map((token) => (
              <Link
                key={token.id}
                to={`/tokens/${token.id}`}
                className="block hover:scale-105 transition-transform"
              >
                <Card className="h-full">
                  <CardContent className="p-4">
                    <div className="flex items-center space-x-3">
                      {token.logoUrl ? (
                        <img
                          src={token.logoUrl}
                          alt={token.tokenName}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <Coins className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{token.tokenName}</h3>
                        <p className="text-sm text-muted-foreground">{token.symbol}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        #{token.rank}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Search className="h-5 w-5" />
            <span>Search Tokens</span>
          </CardTitle>
          <CardDescription>
            Find tokens using advanced search and filtering options.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by token name or symbol..."
              value={filters.query}
              onChange={(e) => updateFilter("query", e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={filters.status} onValueChange={(value) => updateFilter("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="deployed">Deployed</SelectItem>
                  <SelectItem value="deploying">Deploying</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Sort By</Label>
              <Select value={filters.sortBy} onValueChange={(value) => updateFilter("sortBy", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="created_at">Date Created</SelectItem>
                  <SelectItem value="token_name">Name</SelectItem>
                  <SelectItem value="symbol">Symbol</SelectItem>
                  <SelectItem value="total_supply">Supply</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Sort Order</Label>
              <Button
                variant="outline"
                onClick={() => updateFilter("sortOrder", filters.sortOrder === "asc" ? "desc" : "asc")}
                className="w-full justify-start"
              >
                {filters.sortOrder === "asc" ? (
                  <>
                    <SortAsc className="mr-2 h-4 w-4" />
                    Ascending
                  </>
                ) : (
                  <>
                    <SortDesc className="mr-2 h-4 w-4" />
                    Descending
                  </>
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <Label>Actions</Label>
              <Button variant="outline" onClick={resetFilters} className="w-full">
                <Filter className="mr-2 h-4 w-4" />
                Reset Filters
              </Button>
            </div>
          </div>

          {/* Supply Range */}
          <div className="space-y-2">
            <Label>Supply Range: {filters.minSupply.toLocaleString()} - {filters.maxSupply.toLocaleString()}</Label>
            <div className="px-3">
              <Slider
                value={[filters.minSupply, filters.maxSupply]}
                onValueChange={([min, max]) => {
                  updateFilter("minSupply", min);
                  updateFilter("maxSupply", max);
                }}
                max={1000000000}
                step={1000}
                className="w-full"
              />
            </div>
          </div>

          {/* Feature Filters */}
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="mintable"
                checked={filters.isMintable === true}
                onCheckedChange={(checked) => updateFilter("isMintable", checked ? true : undefined)}
              />
              <Label htmlFor="mintable">Mintable Only</Label>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="burnable"
                checked={filters.isBurnable === true}
                onCheckedChange={(checked) => updateFilter("isBurnable", checked ? true : undefined)}
              />
              <Label htmlFor="burnable">Burnable Only</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      <Card>
        <CardHeader>
          <CardTitle>Search Results</CardTitle>
          <CardDescription>
            {searchResults ? `${searchResults.total} tokens found` : "Search for tokens above"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">Searching tokens...</div>
          ) : searchResults?.tokens.length === 0 ? (
            <div className="text-center py-8">
              <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No tokens found</h3>
              <p className="text-muted-foreground">Try adjusting your search criteria.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {searchResults?.tokens.map((token) => (
                <div key={token.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center space-x-4">
                    {token.logoUrl ? (
                      <img
                        src={token.logoUrl}
                        alt={token.tokenName}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                        <Coins className="h-6 w-6 text-primary" />
                      </div>
                    )}
                    <div>
                      <h3 className="font-semibold text-lg">{token.tokenName}</h3>
                      <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                        <span>{token.symbol}</span>
                        <span>•</span>
                        <span>{token.totalSupply.toLocaleString()} supply</span>
                        <span>•</span>
                        <Badge variant="outline" className="flex items-center space-x-1">
                          <div className={`w-2 h-2 rounded-full ${getStatusColor(token.status)}`}></div>
                          <span className="capitalize">{token.status}</span>
                        </Badge>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-4">
                    <div className="text-right">
                      <div className="text-sm text-muted-foreground">Rank #{token.rank}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(token.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <Button variant="outline" size="sm" asChild>
                      <Link to={`/tokens/${token.id}`}>View Details</Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
