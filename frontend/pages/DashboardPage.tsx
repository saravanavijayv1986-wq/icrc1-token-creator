import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Coins, Plus, Search, Filter, ExternalLink, Copy } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useWallet } from "../hooks/useWallet";
import backend from "~backend/client";
import AnalyticsDashboard from "../components/AnalyticsDashboard";

function truncate(text: string, head: number = 8, tail: number = 4) {
  if (!text) return "";
  if (text.length <= head + tail + 3) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

export default function DashboardPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const { isConnected, principal } = useWallet();
  const { toast } = useToast();

  const { data: tokensData, isLoading } = useQuery({
    queryKey: ["dashboard-tokens", searchQuery, statusFilter, isConnected, principal],
    queryFn: async () => {
      const params: any = { limit: 50 };
      if (statusFilter !== "all") {
        params.status = statusFilter;
      }
      if (isConnected && principal) {
        params.creatorPrincipal = principal;
      }
      return await backend.token.list(params);
    },
  });

  const filteredTokens = tokensData?.tokens.filter(token => 
    token.tokenName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    token.symbol.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': return 'bg-green-500';
      case 'deploying': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const handleCopy = async (text?: string) => {
    try {
      if (!text) return;
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Canister ID copied to clipboard" });
    } catch (e) {
      console.error("Copy failed", e);
      toast({ title: "Copy failed", description: "Unable to copy canister ID", variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold mb-2">
            {isConnected ? "My Token Dashboard" : "Token Dashboard"}
          </h1>
          <p className="text-muted-foreground">
            {isConnected 
              ? "Manage your ICRC-1 tokens and view their performance."
              : "Explore ICRC-1 tokens on the platform. Connect your wallet to create and manage tokens."}
          </p>
        </div>
        <Button asChild>
          <Link to="/create">
            <Plus className="mr-2 h-4 w-4" />
            Create New Token
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="tokens" className="space-y-6">
        <TabsList>
          <TabsTrigger value="tokens">Tokens</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="tokens" className="space-y-6">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tokens by name or symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tokens</SelectItem>
                <SelectItem value="deployed">Deployed</SelectItem>
                <SelectItem value="deploying">Deploying</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tokensData?.total || 0}</div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Deployed</CardTitle>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {tokensData?.tokens.filter(t => t.status === 'deployed').length || 0}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Deploying</CardTitle>
                <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {tokensData?.tokens.filter(t => t.status === 'deploying').length || 0}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Supply</CardTitle>
                <Coins className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {tokensData?.tokens.reduce((sum, token) => sum + token.totalSupply, 0).toLocaleString() || 0}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tokens List */}
          <Card>
            <CardHeader>
              <CardTitle>{isConnected ? "Your Tokens" : "Platform Tokens"}</CardTitle>
              <CardDescription>
                {isConnected 
                  ? "View and manage all your created tokens."
                  : "Browse all tokens created on the platform."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8">Loading tokens...</div>
              ) : filteredTokens.length === 0 ? (
                <div className="text-center py-8">
                  <Coins className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No tokens found</h3>
                  <p className="text-muted-foreground mb-4">
                    {searchQuery 
                      ? "Try adjusting your search or filters." 
                      : isConnected 
                        ? "Create your first token to get started."
                        : "No tokens match your criteria."}
                  </p>
                  {isConnected && (
                    <Button asChild>
                      <Link to="/create">Create Your First Token</Link>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredTokens.map((token) => (
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
                          <div className="flex items-center flex-wrap gap-2 text-sm text-muted-foreground">
                            <span>{token.symbol}</span>
                            <span>•</span>
                            <span>{token.totalSupply.toLocaleString()} supply</span>
                            <span>•</span>
                            <span>{token.decimals} decimals</span>
                            <span>•</span>
                            <Badge variant="outline" className="flex items-center space-x-1">
                              <div className={`w-2 h-2 rounded-full ${getStatusColor(token.status)}`}></div>
                              <span className="capitalize">{token.status}</span>
                            </Badge>
                          </div>
                          {token.canisterId && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Canister:</span>
                              <code className="text-xs bg-muted px-2 py-0.5 rounded">
                                {truncate(token.canisterId, 10, 3)}
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleCopy(token.canisterId)}
                                title="Copy Canister ID"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        <div className="flex space-x-2">
                          {token.canisterId && (
                            <Button variant="outline" size="sm" asChild>
                              <a
                                href={`https://ic.rocks/principal/${token.canisterId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/tokens/${token.id}`}>
                              View Details
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
