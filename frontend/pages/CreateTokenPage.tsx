import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { Loader2, Upload, Coins, Shield, Info, AlertTriangle, CheckCircle, Wallet, DollarSign } from "lucide-react";
import { useBackend } from "../hooks/useBackend";
import { tokenConfig } from "../config";
import { validateTokenCreation } from "../utils/validation";
import { withErrorHandling } from "../utils/errorHandling";

const friendlyErrorMessages: Record<string, string> = {
  "network_error": "Network error fetching balance. Please check your connection and try again.",
  "invalid_principal": "Invalid wallet principal format. Please reconnect your wallet.",
  "timeout": "Request timed out. The IC network might be busy. Please try again.",
  "auth_error": "Authentication error. Please reconnect your wallet.",
  "rate_limit": "Too many requests. Please wait and try again.",
  "network_unavailable": "The Internet Computer network is temporarily unavailable. Please try again in a moment.",
  "service_unavailable": "Service is temporarily unavailable. Please try again.",
  "unknown_error": "Unable to fetch ICP balance. Please check your connection and try again.",
  "invalid_response": "Received an invalid response from the network.",
  "principal_required": "Wallet principal not found. Please connect your wallet.",
};

function icpToE8s(amount: string | number): bigint {
  const str = String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error("Invalid ICP amount");
  }
  const [intPart, fracPart = ""] = str.split(".");
  const fracPadded = (fracPart + "00000000").slice(0, 8);
  return BigInt(intPart) * 100000000n + BigInt(fracPadded);
}

export default function CreateTokenPage() {
  const [formData, setFormData] = useState({
    tokenName: "",
    symbol: "",
    totalSupply: "",
    decimals: tokenConfig.defaults.decimals.toString(),
    isMintable: tokenConfig.defaults.isMintable,
    isBurnable: tokenConfig.defaults.isBurnable,
    logoFile: "",
  });
  const [logoPreview, setLogoPreview] = useState<string>("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  
  const navigate = useNavigate();
  const { toast } = useToast();
  const { createToken, getICPBalance, isConnected, principal } = useBackend();
  const queryClient = useQueryClient();

  const { data: icpBalance, isFetching: balanceLoading, refetch: refetchBalance } = useQuery({
    queryKey: ["icp-balance", principal],
    queryFn: async () => {
      if (!principal) return null;
      return await getICPBalance(principal);
    },
    enabled: !!principal && isConnected,
    refetchInterval: 30000,
    retry: false,
  });

  const createTokenMutation = useMutation({
    mutationFn: withErrorHandling(createToken),
    onSuccess: (data) => {
      toast({
        title: "Token Created Successfully!",
        description: `Your ICRC-1 token has been deployed to canister: ${data.canisterId}`,
      });
      queryClient.invalidateQueries({ queryKey: ["dashboard-tokens"] });
      navigate(`/tokens/${data.tokenId}`);
    },
    onError: (error) => {
      console.error("Token creation failed:", error);
    },
  });

  const formatICPBalance = (balance: string) => {
    try {
      const balanceE8s = BigInt(balance);
      const icpPart = balanceE8s / 100000000n;
      const fracPart = balanceE8s % 100000000n;
      return `${icpPart}.${fracPart.toString().padStart(8, '0')}`;
    } catch (e) {
      return "0.00000000";
    }
  };

  const isBalanceSufficient = !icpBalance || icpBalance.error ? true : (
    icpBalance.balance && BigInt(icpBalance.balance) >= icpToE8s(tokenConfig.fees.creationFeeICP)
  );

  const handleInputChange = (field: string, value: string | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    if (validationErrors.length > 0) {
      setValidationErrors([]);
    }
  };

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!tokenConfig.validation.allowedImageTypes.includes(file.type)) {
        toast({
          title: "Invalid File Type",
          description: "Please upload a PNG, JPEG, or WebP image.",
          variant: "destructive",
        });
        return;
      }

      if (file.size > tokenConfig.validation.maxLogoSize) {
        toast({
          title: "File Too Large",
          description: `Image must be smaller than ${tokenConfig.validation.maxLogoSize / (1024 * 1024)}MB.`,
          variant: "destructive",
        });
        return;
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setLogoPreview(result);
        const base64Data = result.split(',')[1];
        setFormData(prev => ({ ...prev, logoFile: base64Data }));
      };
      reader.readAsDataURL(file);
    } catch (error) {
      toast({
        title: "Upload Failed",
        description: "Failed to process the image file.",
        variant: "destructive",
      });
    }
  };

  const validateForm = async () => {
    setIsValidating(true);
    
    try {
      const validation = validateTokenCreation({
        tokenName: formData.tokenName,
        symbol: formData.symbol,
        totalSupply: formData.totalSupply,
        decimals: formData.decimals,
      });

      if (!validation.isValid) {
        setValidationErrors(validation.errors);
        return false;
      }

      const totalSupply = parseInt(formData.totalSupply);
      const decimals = parseInt(formData.decimals);

      if (totalSupply > Math.pow(10, 15)) {
        setValidationErrors(["Total supply is unreasonably large"]);
        return false;
      }

      if (decimals > 8 && totalSupply < Math.pow(10, decimals)) {
        setValidationErrors(["High decimal places with low supply may cause precision issues"]);
        return false;
      }

      setValidationErrors([]);
      return true;
    } catch (error) {
      setValidationErrors(["Validation failed. Please check your inputs."]);
      return false;
    } finally {
      setIsValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!isConnected || !principal) {
      toast({
        title: "Wallet Required",
        description: "Please connect your Internet Identity to create a token.",
        variant: "destructive",
      });
      return;
    }

    if (icpBalance && !icpBalance.error) {
      const requiredE8s = icpToE8s(tokenConfig.fees.creationFeeICP);
      if (BigInt(icpBalance.balance) < requiredE8s) {
        toast({
          title: "Insufficient Balance",
          description: `You need at least ${tokenConfig.fees.creationFeeICP} ICP to create a token. Current balance: ${formatICPBalance(icpBalance.balance)} ICP`,
          variant: "destructive",
        });
        return;
      }
    } else if (icpBalance && icpBalance.error) {
      toast({
        title: "Balance Check Failed",
        description: "Could not verify your ICP balance, but you can still attempt to create a token. It may fail if your balance is insufficient.",
        variant: "default",
      });
    }


    const isValid = await validateForm();
    if (!isValid) {
      toast({
        title: "Validation Error",
        description: validationErrors[0] || "Please fix the errors and try again.",
        variant: "destructive",
      });
      return;
    }

    const totalSupply = parseInt(formData.totalSupply);
    const decimals = parseInt(formData.decimals);

    createTokenMutation.mutate({
      tokenName: formData.tokenName.trim(),
      symbol: formData.symbol.trim().toUpperCase(),
      totalSupply,
      decimals,
      isMintable: formData.isMintable,
      isBurnable: formData.isBurnable,
      logoFile: formData.logoFile || undefined,
    });
  };

  const getBalanceDisplay = () => {
    if (balanceLoading) {
      return <Loader2 className="h-6 w-6 animate-spin inline" />;
    }
    
    if (icpBalance?.error) {
      const errorMessage = friendlyErrorMessages[icpBalance.error] || "An unknown error occurred.";
      return (
        <div className="flex items-center space-x-2">
          <span className="text-red-600 text-sm">{errorMessage}</span>
          <Button variant="ghost" size="sm" onClick={() => refetchBalance()}>
            Retry
          </Button>
        </div>
      );
    }
    
    if (icpBalance && icpBalance.balance) {
      return `${formatICPBalance(icpBalance.balance)} ICP`;
    }
    
    return "0.00000000 ICP";
  };

  const isButtonDisabled = createTokenMutation.isPending || 
                           !isConnected || 
                           isValidating || 
                           balanceLoading ||
                           (icpBalance && !icpBalance.error && !isBalanceSufficient);

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold mb-4">Create ICRC-1 Token</h1>
        <p className="text-lg text-muted-foreground">
          Deploy a production-ready, compliant fungible token on the Internet Computer blockchain.
        </p>
      </div>

      {!isConnected ? (
        <Card className="mb-6 border-yellow-200 bg-yellow-50" data-testid="connection-warning">
          <CardContent className="p-4">
            <div className="flex items-center space-x-2">
              <Info className="h-5 w-5 text-yellow-600" />
              <p className="text-yellow-800">
                Please connect your Internet Identity to create and deploy a real ICRC-1 token on the IC blockchain.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6 border-blue-200 bg-blue-50">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center space-x-2 text-blue-800">
                <Wallet className="h-5 w-5" />
                <span>Wallet Balance &amp; Fees</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-blue-800">Your ICP Balance</Label>
                  <div className="flex items-center space-x-2">
                    <DollarSign className="h-4 w-4 text-blue-600" />
                    <span className="text-2xl font-bold text-blue-900">
                      {getBalanceDisplay()}
                    </span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-blue-800">Creation Fee</Label>
                  <div className="flex items-center space-x-2">
                    <Coins className="h-4 w-4 text-blue-600" />
                    <span className="text-2xl font-bold text-blue-900">
                      {tokenConfig.fees.creationFeeICP} ICP
                    </span>
                  </div>
                  <p className="text-xs text-blue-700">
                    + {parseInt(tokenConfig.fees.estimatedCycles).toLocaleString()} cycles for deployment
                  </p>
                </div>
              </div>

              {icpBalance?.error && (
                <div className="p-3 rounded-lg bg-yellow-100 border border-yellow-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="h-5 w-5 text-yellow-600" />
                      <span className="text-yellow-800 font-medium">
                        {friendlyErrorMessages[icpBalance.error] || "Unable to fetch ICP balance. You can still proceed with token creation."}
                      </span>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => refetchBalance()}>
                      Retry
                    </Button>
                  </div>
                </div>
              )}

              {icpBalance && icpBalance.balance && !icpBalance.error && (
                <div className={`p-3 rounded-lg flex items-center space-x-2 ${
                  isBalanceSufficient 
                    ? 'bg-green-100 border border-green-200' 
                    : 'bg-red-100 border border-red-200'
                }`}>
                  {isBalanceSufficient ? (
                    <>
                      <CheckCircle className="h-5 w-5 text-green-600" />
                      <span className="text-green-800 font-medium">
                        Sufficient balance to create token
                      </span>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      <span className="text-red-800 font-medium">
                        Insufficient balance. You need {tokenConfig.fees.creationFeeICP} ICP to create a token.
                      </span>
                    </>
                  )}
                </div>
              )}

              <div className="text-xs text-blue-700 space-y-1">
                <p>• Creation fee goes to platform treasury for infrastructure costs</p>
                <p>• Cycles are provided automatically for canister deployment</p>
                <p>• Your wallet will be the controller of the deployed token canister</p>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6 border-green-200 bg-green-50">
            <CardContent className="p-4">
              <div className="flex items-center space-x-2">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <p className="text-green-800">
                  <strong>Ready to deploy!</strong> Your token will be created as a production ICRC-1 canister on the Internet Computer.
                </p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card className="mb-6 border-orange-200 bg-orange-50">
        <CardContent className="p-4">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
            <div className="text-orange-800">
              <p className="font-medium mb-1">Production Blockchain Deployment</p>
              <p className="text-sm">
                This will create an actual ICRC-1 token canister on the Internet Computer mainnet. 
                All data is permanent and immutable. Ensure all details are correct before deployment.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {validationErrors.length > 0 && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-start space-x-2">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
              <div className="text-red-800">
                <p className="font-medium mb-2">Please fix the following errors:</p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {validationErrors.map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Coins className="h-6 w-6" />
            <span>Token Configuration</span>
          </CardTitle>
          <CardDescription>
            Configure your ICRC-1 token parameters. This will deploy a production canister on the Internet Computer.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tokenName">Token Name *</Label>
                <Input
                  id="tokenName"
                  data-testid="token-name"
                  placeholder="e.g., My Awesome Token"
                  value={formData.tokenName}
                  onChange={(e) => handleInputChange("tokenName", e.target.value)}
                  maxLength={tokenConfig.validation.maxNameLength}
                  required
                  disabled={createTokenMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  {tokenConfig.validation.minNameLength}-{tokenConfig.validation.maxNameLength} characters, letters, numbers, spaces, hyphens, underscores
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol *</Label>
                <Input
                  id="symbol"
                  data-testid="token-symbol"
                  placeholder="e.g., MAT"
                  value={formData.symbol}
                  onChange={(e) => handleInputChange("symbol", e.target.value.toUpperCase())}
                  maxLength={tokenConfig.validation.maxSymbolLength}
                  required
                  disabled={createTokenMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  {tokenConfig.validation.minSymbolLength}-{tokenConfig.validation.maxSymbolLength} characters, uppercase letters and numbers only
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalSupply">Total Supply *</Label>
                <Input
                  id="totalSupply"
                  data-testid="total-supply"
                  type="number"
                  placeholder="e.g., 1000000"
                  value={formData.totalSupply}
                  onChange={(e) => handleInputChange("totalSupply", e.target.value)}
                  min={tokenConfig.validation.minSupply}
                  max={tokenConfig.validation.maxSupply}
                  required
                  disabled={createTokenMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  {tokenConfig.validation.minSupply.toLocaleString()} - {tokenConfig.validation.maxSupply.toLocaleString()} tokens
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="decimals">Decimals</Label>
                <Input
                  id="decimals"
                  data-testid="decimals"
                  type="number"
                  value={formData.decimals}
                  onChange={(e) => handleInputChange("decimals", e.target.value)}
                  min={tokenConfig.validation.minDecimals}
                  max={tokenConfig.validation.maxDecimals}
                  disabled={createTokenMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  {tokenConfig.validation.minDecimals}-{tokenConfig.validation.maxDecimals} decimal places (8 is standard)
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="logo">Token Logo (Optional)</Label>
              <div className="flex items-center space-x-4">
                <Input
                  id="logo"
                  type="file"
                  data-testid="logo-upload"
                  accept={tokenConfig.validation.allowedImageTypes.join(',')}
                  onChange={handleLogoUpload}
                  className="flex-1"
                  disabled={createTokenMutation.isPending}
                />
                {logoPreview && (
                  <img
                    src={logoPreview}
                    alt="Logo preview"
                    className="w-12 h-12 rounded-full object-cover border-2 border-border"
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Upload a square image (PNG, JPEG, WebP) max {tokenConfig.validation.maxLogoSize / (1024 * 1024)}MB
              </p>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Token Features</h3>
              
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="mintable" className="font-medium">Mintable</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow creating new tokens after deployment (increases total supply)
                  </p>
                </div>
                <Switch
                  id="mintable"
                  data-testid="mintable-switch"
                  checked={formData.isMintable}
                  onCheckedChange={(checked) => handleInputChange("isMintable", checked)}
                  disabled={createTokenMutation.isPending}
                />
              </div>

              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-1">
                  <Label htmlFor="burnable" className="font-medium">Burnable</Label>
                  <p className="text-sm text-muted-foreground">
                    Allow destroying tokens to reduce supply (permanent removal)
                  </p>
                </div>
                <Switch
                  id="burnable"
                  data-testid="burnable-switch"
                  checked={formData.isBurnable}
                  onCheckedChange={(checked) => handleInputChange("isBurnable", checked)}
                  disabled={createTokenMutation.isPending}
                />
              </div>
            </div>

            <div className="border rounded-lg p-4 bg-muted">
              <h4 className="font-semibold mb-3">Deployment Information</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="flex justify-between">
                  <span>Network:</span>
                  <span className="font-semibold text-green-600">Internet Computer Mainnet</span>
                </div>
                <div className="flex justify-between">
                  <span>Standard:</span>
                  <span className="font-semibold">ICRC-1</span>
                </div>
                <div className="flex justify-between">
                  <span>Controller:</span>
                  <span className="font-semibold">Your Internet Identity</span>
                </div>
                <div className="flex justify-between">
                  <span>Creation Fee:</span>
                  <span className="font-semibold">{tokenConfig.fees.creationFeeICP} ICP</span>
                </div>
                <div className="flex justify-between">
                  <span>Estimated Cycles:</span>
                  <span className="font-semibold">{parseInt(tokenConfig.fees.estimatedCycles).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Deploy Time:</span>
                  <span className="font-semibold">2-3 minutes</span>
                </div>
                <div className="flex justify-between">
                  <span>Immutable:</span>
                  <span className="font-semibold text-orange-600">Yes</span>
                </div>
                <div className="flex justify-between">
                  <span>Balance After:</span>
                  <span className="font-semibold">
                    {icpBalance && icpBalance.balance && !icpBalance.error ? 
                      (() => {
                        const balanceE8s = BigInt(icpBalance.balance);
                        const feeE8s = icpToE8s(tokenConfig.fees.creationFeeICP);
                        const afterBalance = balanceE8s - feeE8s;
                        return `${afterBalance < 0n ? '0.00000000' : formatICPBalance(afterBalance.toString())} ICP`;
                      })() : 
                      "Calculate after connection"
                    }
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Your Internet Identity will be the controller of the deployed token canister. 
                Token data and transactions are permanently stored on the blockchain.
              </p>
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isButtonDisabled}
            >
              {createTokenMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deploying to Internet Computer...
                </>
              ) : isValidating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Deploy Production ICRC-1 Token ({tokenConfig.fees.creationFeeICP} ICP)
                </>
              )}
            </Button>

            {!isConnected && (
              <p className="text-center text-sm text-muted-foreground">
                Connect your Internet Identity to enable token creation
              </p>
            )}

            {isConnected && icpBalance && !icpBalance.error && !isBalanceSufficient && (
              <p className="text-center text-sm text-red-600">
                Insufficient ICP balance. You need {tokenConfig.fees.creationFeeICP} ICP to create a token.
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
