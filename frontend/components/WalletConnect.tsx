import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Wallet, LogOut, Loader2, Shield, Key, Copy, Send } from "lucide-react";
import { useWallet } from "../hooks/useWallet";
import { useBackend } from "../hooks/useBackend";

const wallets = [
  {
    id: "internet-identity",
    name: "Internet Identity",
    description: "Official Internet Computer authentication service",
    icon: "🆔",
    features: ["Secure delegation", "No seed phrases", "Biometric login"],
    recommended: true,
  },
  {
    id: "nfid",
    name: "NFID",
    description: "Alternative Internet Identity provider with enhanced features",
    icon: "🔐",
    features: ["Enhanced security", "Multi-device sync", "Social recovery"],
    recommended: false,
  },
];

function truncatePrincipal(p: string, head: number = 8, tail: number = 3) {
  if (!p) return "";
  return `${p.slice(0, head)}...${p.slice(-tail)}`;
}

export default function WalletConnect() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingWallet, setConnectingWallet] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  
  const { isConnected, principal, delegationIdentity, connect, disconnect } = useWallet();
  const { transferICP } = useBackend();
  const { toast } = useToast();

  const handleConnect = async (walletType: string) => {
    setIsConnecting(true);
    setConnectingWallet(walletType);
    
    try {
      await connect(walletType);
      setDialogOpen(false);
      
      const wallet = wallets.find(w => w.id === walletType);
      toast({
        title: "Wallet Connected",
        description: `Successfully connected to ${wallet?.name}`,
      });
    } catch (error) {
      console.error("Connection failed:", error);
      toast({
        title: "Connection Failed",
        description: error instanceof Error ? error.message : "Failed to connect to wallet. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsConnecting(false);
      setConnectingWallet(null);
    }
  };

  const handleDisconnect = async () => {
    try {
      await disconnect();
      toast({
        title: "Wallet Disconnected",
        description: "Successfully disconnected from wallet",
      });
    } catch (error) {
      console.error("Disconnect failed:", error);
      toast({
        title: "Disconnect Failed",
        description: "Failed to disconnect wallet",
        variant: "destructive",
      });
    }
  };

  const handleCopyPrincipal = async () => {
    try {
      if (!principal) return;
      await navigator.clipboard.writeText(principal);
      toast({
        title: "Principal Copied",
        description: "Your wallet principal has been copied to clipboard.",
      });
    } catch (error) {
      console.error("Copy failed:", error);
      toast({
        title: "Copy Failed",
        description: "Unable to copy principal. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleTransferICP = async () => {
    if (!transferTo || !transferAmount) {
      toast({
        title: "Missing Information",
        description: "Please enter both recipient and amount.",
        variant: "destructive",
      });
      return;
    }

    // Basic principal validation
    const principalPattern = /^[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{3}$/;
    if (!principalPattern.test(transferTo)) {
      toast({
        title: "Invalid Recipient",
        description: "Please enter a valid principal ID.",
        variant: "destructive",
      });
      return;
    }

    const amountNum = Number(transferAmount);
    if (!isFinite(amountNum) || amountNum <= 0) {
      toast({
        title: "Invalid Amount",
        description: "Please enter a positive ICP amount.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsTransferring(true);
      const res = await transferICP(transferAmount, transferTo);
      toast({
        title: "Transfer Submitted",
        description: `Block index: ${res.blockIndex || res.transactionId}`,
      });
      setTransferTo("");
      setTransferAmount("");
      setTransferDialogOpen(false);
    } catch (error) {
      console.error("ICP transfer failed:", error);
      toast({
        title: "Transfer Failed",
        description: error instanceof Error ? error.message : "Failed to transfer ICP. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsTransferring(false);
    }
  };

  if (isConnected && principal) {
    const hasValidDelegation = delegationIdentity !== null;
    const truncated = truncatePrincipal(principal, 10, 3);

    return (
      <div className="flex items-center space-x-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="flex items-center space-x-2">
              <Wallet className="h-4 w-4" />
              <span>Connected: {truncated}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              Connected:
            </DropdownMenuLabel>
            <div className="px-2 py-1.5">
              <div className="flex items-center gap-2">
                <code className="text-xs bg-muted px-2 py-1 rounded flex-1 truncate">
                  {principal}
                </code>
                <Button variant="ghost" size="icon" onClick={handleCopyPrincipal} title="Copy principal">
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="px-2 pb-2">
              {hasValidDelegation ? (
                <div className="flex items-center gap-2 text-green-600 text-xs">
                  <Shield className="h-3.5 w-3.5" />
                  <span>Authenticated</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-600 text-xs">
                  <Shield className="h-3.5 w-3.5" />
                  <span>Not authenticated</span>
                </div>
              )}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setTransferDialogOpen(true);
              }}
              className="cursor-pointer"
            >
              <Send className="mr-2 h-4 w-4" />
              Transfer ICP
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={async (e) => {
                e.preventDefault();
                await handleDisconnect();
              }}
              className="text-red-600 cursor-pointer"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Transfer ICP</DialogTitle>
              <DialogDescription>
                Send ICP from your connected wallet to another principal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recipient">Recipient Principal</Label>
                <Input
                  id="recipient"
                  placeholder="rrkah-fqaaa-aaaah-qcuea-cai"
                  value={transferTo}
                  onChange={(e) => setTransferTo(e.target.value.trim())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (ICP)</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.00000001"
                  min="0"
                  placeholder="0.1"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Amount will be converted to e8s automatically.
                </p>
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setTransferDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleTransferICP} disabled={isTransferring}>
                  {isTransferring ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Transferring...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Transfer
                    </>
                  )}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogTrigger asChild>
        <Button>
          <Wallet className="mr-2 h-4 w-4" />
          Connect Wallet
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect to Internet Computer</DialogTitle>
          <DialogDescription>
            Choose an identity provider to authenticate with the Internet Computer. This will create a secure delegation for token operations.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {wallets.map((wallet) => (
            <Card
              key={wallet.id}
              className={`cursor-pointer hover:bg-muted/50 transition-colors ${
                wallet.recommended ? 'ring-2 ring-primary/20' : ''
              } ${isConnecting && connectingWallet !== wallet.id ? 'opacity-50 pointer-events-none' : ''}`}
              onClick={() => !isConnecting && handleConnect(wallet.id)}
            >
              <CardContent className="p-4">
                <div className="flex items-start space-x-4">
                  <div className="text-2xl">{wallet.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2 mb-1">
                      <CardTitle className="text-sm">{wallet.name}</CardTitle>
                      {wallet.recommended && (
                        <div className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs font-medium">
                          Recommended
                        </div>
                      )}
                    </div>
                    <CardDescription className="text-xs mb-2">
                      {wallet.description}
                    </CardDescription>
                    <div className="flex flex-wrap gap-1">
                      {wallet.features.map((feature, index) => (
                        <span 
                          key={index}
                          className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    {wallet.id === "internet-identity" && (
                      <div className="text-green-500">
                        <Key className="h-4 w-4" />
                      </div>
                    )}
                    {isConnecting && connectingWallet === wallet.id && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
