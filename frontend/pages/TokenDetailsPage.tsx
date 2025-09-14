import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Coins, ArrowLeft, Plus, Minus, Send, ExternalLink, Copy, Download, RefreshCw, AlertCircle } from "lucide-react";
import { useBackend } from "../hooks/useBackend";
import AnalyticsDashboard from "../components/AnalyticsDashboard";

export default function TokenDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [mintAmount, setMintAmount] = useState("");
  const [burnAmount, setBurnAmount] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferTo, setTransferTo] = useState("");
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { backend, mintTokens, burnTokens, transferTokens, getTokenBalance, syncTokenWithCanister, isConnected, principal } = useBackend();
  
  const tokenId = parseInt(id || "0");

  const { data: token, isLoading } = useQuery({
    queryKey: ["token", tokenId],
    queryFn: async () => await backend.token.get({ id: tokenId }),
    enabled: !!tokenId,
  });

  const { data: transactions } = useQuery({
    queryKey: ["transactions", tokenId],
    queryFn: async () => await backend.token.getTransactions({ tokenId, limit: 50 }),
    enabled: !!tokenId,
  });

  const { data: balance } = useQuery({
    queryKey: ["balance", tokenId, principal],
    queryFn: async () => {
      if (!principal) return null;
      return await getTokenBalance(tokenId, principal);
    },
    enabled: !!tokenId && !!principal && token?.status === 'deployed',
  });

  const isOwner = isConnected && token && principal === token.creatorPrincipal;

  const mintMutation = useMutation({
    mutationFn: async ({ amount, to }: { amount: number; to: string }) => {
      return await mintTokens(tokenId, amount, to);
    },
    onSuccess: (data) => {
      toast({ 
        title: "Success", 
        description: `Tokens minted successfully! Block index: ${data.blockIndex}` 
      });
      queryClient.invalidateQueries({ queryKey: ["token", tokenId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", tokenId] });
      queryClient.invalidateQueries({ queryKey: ["balance", tokenId, principal] });
      setMintAmount("");
    },
    onError: (error) => {
      console.error("Mint failed:", error);
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to mint tokens", 
        variant: "destructive" 
      });
    },
  });

  const burnMutation = useMutation({
    mutationFn: async ({ amount, from }: { amount: number; from: string }) => {
      return await burnTokens(tokenId, amount, from);
    },
    onSuccess: (data) => {
      toast({ 
        title: "Success", 
        description: `Tokens burned successfully! Block index: ${data.blockIndex}` 
      });
      queryClient.invalidateQueries({ queryKey: ["token", tokenId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", tokenId] });
      queryClient.invalidateQueries({ queryKey: ["balance", tokenId, principal] });
      setBurnAmount("");
    },
    onError: (error) => {
      console.error("Burn failed:", error);
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to burn tokens", 
        variant: "destructive" 
      });
    },
  });

  const transferMutation = useMutation({
    mutationFn: async ({ amount, from, to }: { amount: number; from: string; to: string }) => {
      return await transferTokens(tokenId, amount, from, to);
    },
    onSuccess: (data) => {
      toast({ 
        title: "Success", 
        description: `Transfer completed! Block index: ${data.blockIndex}` 
      });
      queryClient.invalidateQueries({ queryKey: ["transactions", tokenId] });
      queryClient.invalidateQueries({ queryKey: ["balance", tokenId, principal] });
      setTransferAmount("");
      setTransferTo("");
    },
    onError: (error) => {
      console.error("Transfer failed:", error);
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to transfer tokens", 
        variant: "destructive" 
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      return await syncTokenWithCanister(tokenId);
    },
    onSuccess: (data) => {
      toast({ 
        title: "Sync Complete", 
        description: `Updated fields: ${data.updatedFields.join(', ')}` 
      });
      queryClient.invalidateQueries({ queryKey: ["token", tokenId] });
    },
    onError: (error) => {
      console.error("Sync failed:", error);
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to sync with canister", 
        variant: "destructive" 
      });
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Copied to clipboard" });
  };

  const downloadMetadata = () => {
    if (!token) return;
    
    const metadata = {
      name: token.tokenName,
      symbol: token.symbol,
      decimals: token.decimals,
      totalSupply: token.totalSupply,
      canisterId: token.canisterId,
      logoUrl: token.logoUrl,
      isMintable: token.isMintable,
      isBurnable: token.isBurnable,
      createdAt: token.createdAt,
      standard: "ICRC-1",
      icBlockchain: true,
    };

    const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${token.symbol}-metadata.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">Loading token details...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Token Not Found</h1>
          <Button asChild>
            <Link to="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Dashboard
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'deployed': return 'bg-green-500';
      case 'deploying': return 'bg-yellow-500';
      case 'failed': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const formatBalance = (balance: string, decimals: number) => {
    const num = parseInt(balance);
    return (num / Math.pow(10, decimals)).toLocaleString();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-6">
        <Button variant="ghost" asChild className="mb-4">
          <Link to="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>
        
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            {token.logoUrl ? (
              <img
                src={token.logoUrl}
                alt={token.tokenName}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Coins className="h-8 w-8 text-primary" />
              </div>
            )}
            <div>
              <h1 className="text-3xl font-bold">{token.tokenName}</h1>
              <div className="flex items-center space-x-2 mt-1">
                <Badge variant="outline" className="flex items-center space-x-1">
                  <div className={`w-2 h-2 rounded-full ${getStatusColor(token.status)}`}></div>
                  <span className="capitalize">{token.status}</span>
                </Badge>
                <span className="text-muted-foreground">{token.symbol}</span>
                {isOwner && (
                  <Badge variant="default" className="text-xs">Owner</Badge>
                )}
                <Badge variant="secondary" className="text-xs">ICRC-1</Badge>
              </div>
            </div>
          </div>
          
          <div className="flex space-x-2">
            {token.status === 'deployed' && (
              <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                <RefreshCw className={`mr-2 h-4 w-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                Sync with Canister
              </Button>
            )}
            <Button variant="outline" onClick={downloadMetadata}>
              <Download className="mr-2 h-4 w-4" />
              Download Metadata
            </Button>
            {token.canisterId && (
              <Button variant="outline" asChild>
                <a
                  href={`https://dashboard.internetcomputer.org/canister/${token.canisterId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  View Canister
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Token Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Supply</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{token.totalSupply.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{token.decimals} decimals</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Your Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {balance ? formatBalance(balance.balance, balance.decimals) : isConnected ? "Loading..." : "Connect wallet"}
            </div>
            {balance && (
              <p className="text-xs text-muted-foreground mt-1">
                Raw: {parseInt(balance.balance).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Canister ID</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <code className="text-sm bg-muted px-2 py-1 rounded flex-1 truncate">
                {token.canisterId || "Not deployed"}
              </code>
              {token.canisterId && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(token.canisterId!)}
                  data-testid="copy-canister-id"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Features</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col space-y-1">
              <Badge variant={token.isMintable ? "default" : "secondary"} className="w-fit">
                {token.isMintable ? "Mintable" : "Fixed Supply"}
              </Badge>
              <Badge variant={token.isBurnable ? "default" : "secondary"} className="w-fit">
                {token.isBurnable ? "Burnable" : "Non-Burnable"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Warning for non-deployed tokens */}
      {token.status !== 'deployed' && (
        <Card className="mb-6 border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <p className="text-orange-800">
                Token operations are only available for deployed tokens. Status: {token.status}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs for different actions */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {isOwner && token.isMintable && token.status === 'deployed' && <TabsTrigger value="mint">Mint</TabsTrigger>}
          {isOwner && token.isBurnable && token.status === 'deployed' && <TabsTrigger value="burn">Burn</TabsTrigger>}
          {token.status === 'deployed' && <TabsTrigger value="transfer">Transfer</TabsTrigger>}
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Token Overview</CardTitle>
              <CardDescription>
                Complete information about this ICRC-1 token deployed on the Internet Computer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm font-medium">Token Name</Label>
                  <p className="text-sm text-muted-foreground">{token.tokenName}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Symbol</Label>
                  <p className="text-sm text-muted-foreground">{token.symbol}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Creator Principal</Label>
                  <p className="text-sm text-muted-foreground font-mono">{token.creatorPrincipal}</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Standard</Label>
                  <p className="text-sm text-muted-foreground">ICRC-1 (Internet Computer)</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Network</Label>
                  <p className="text-sm text-muted-foreground">Internet Computer Mainnet</p>
                </div>
                <div>
                  <Label className="text-sm font-medium">Created</Label>
                  <p className="text-sm text-muted-foreground">{new Date(token.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isOwner && token.isMintable && token.status === 'deployed' && (
          <TabsContent value="mint">
            <Card>
              <CardHeader>
                <CardTitle>Mint Tokens</CardTitle>
                <CardDescription>
                  Create new tokens and add them to the total supply on the Internet Computer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isConnected && (
                  <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                    <p className="text-yellow-800 text-sm">
                      Please connect your Internet Identity to mint tokens.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="mintAmount">Amount to Mint</Label>
                  <Input
                    id="mintAmount"
                    type="number"
                    placeholder="Enter amount"
                    value={mintAmount}
                    onChange={(e) => setMintAmount(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Amount in smallest unit (considering {token.decimals} decimals)
                  </p>
                </div>
                <Button
                  onClick={() => {
                    const amount = parseInt(mintAmount);
                    if (amount > 0 && principal) {
                      mintMutation.mutate({ amount, to: principal });
                    }
                  }}
                  disabled={!mintAmount || mintMutation.isPending || !isConnected}
                  className="w-full"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {mintMutation.isPending ? "Minting..." : "Mint Tokens"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {isOwner && token.isBurnable && token.status === 'deployed' && (
          <TabsContent value="burn">
            <Card>
              <CardHeader>
                <CardTitle>Burn Tokens</CardTitle>
                <CardDescription>
                  Permanently destroy tokens to reduce the total supply on the Internet Computer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isConnected && (
                  <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                    <p className="text-yellow-800 text-sm">
                      Please connect your Internet Identity to burn tokens.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="burnAmount">Amount to Burn</Label>
                  <Input
                    id="burnAmount"
                    type="number"
                    placeholder="Enter amount"
                    value={burnAmount}
                    onChange={(e) => setBurnAmount(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Amount in smallest unit (considering {token.decimals} decimals)
                  </p>
                </div>
                <Button
                  onClick={() => {
                    const amount = parseInt(burnAmount);
                    if (amount > 0 && principal) {
                      burnMutation.mutate({ amount, from: principal });
                    }
                  }}
                  disabled={!burnAmount || burnMutation.isPending || !isConnected}
                  variant="destructive"
                  className="w-full"
                >
                  <Minus className="mr-2 h-4 w-4" />
                  {burnMutation.isPending ? "Burning..." : "Burn Tokens"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {token.status === 'deployed' && (
          <TabsContent value="transfer">
            <Card>
              <CardHeader>
                <CardTitle>Transfer Tokens</CardTitle>
                <CardDescription>
                  Send tokens to another principal on the Internet Computer.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isConnected && (
                  <div className="p-4 border border-yellow-200 bg-yellow-50 rounded-lg">
                    <p className="text-yellow-800 text-sm">
                      Please connect your Internet Identity to transfer tokens.
                    </p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="transferTo">Recipient Principal</Label>
                  <Input
                    id="transferTo"
                    placeholder="rrkah-fqaaa-aaaah-qcuea-cai"
                    value={transferTo}
                    onChange={(e) => setTransferTo(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="transferAmount">Amount</Label>
                  <Input
                    id="transferAmount"
                    type="number"
                    placeholder="Enter amount"
                    value={transferAmount}
                    onChange={(e) => setTransferAmount(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Amount in smallest unit (considering {token.decimals} decimals). Transfer fee will be deducted automatically.
                  </p>
                </div>
                <Button
                  onClick={() => {
                    const amount = parseInt(transferAmount);
                    if (amount > 0 && transferTo && principal) {
                      transferMutation.mutate({ amount, from: principal, to: transferTo });
                    }
                  }}
                  disabled={!transferAmount || !transferTo || transferMutation.isPending || !isConnected}
                  className="w-full"
                >
                  <Send className="mr-2 h-4 w-4" />
                  {transferMutation.isPending ? "Transferring..." : "Transfer Tokens"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle>Transaction History</CardTitle>
              <CardDescription>
                View all transactions for this token on the Internet Computer.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions?.transactions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">No transactions yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {transactions?.transactions.map((tx) => {
                    const md = (typeof tx.metadata === "string" ? undefined : tx.metadata) as any | undefined;
                    const blockIndex = md?.blockIndex;
                    return (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div>
                          <div className="font-medium capitalize">{tx.transactionType}</div>
                          <div className="text-sm text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleString()}
                          </div>
                          {tx.fromPrincipal && (
                            <div className="text-xs text-muted-foreground">
                              From: {tx.fromPrincipal.slice(0, 10)}...
                            </div>
                          )}
                          {tx.toPrincipal && (
                            <div className="text-xs text-muted-foreground">
                              To: {tx.toPrincipal.slice(0, 10)}...
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          {tx.amount && (
                            <div className="font-medium">{tx.amount.toLocaleString()} {token.symbol}</div>
                          )}
                          {tx.txHash && (
                            <div className="text-sm text-muted-foreground">{tx.txHash}</div>
                          )}
                          {blockIndex && (
                            <div className="text-xs text-green-600">
                              Block: {blockIndex}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <AnalyticsDashboard tokenId={tokenId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
