import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { Stepper } from "../components/Stepper";
import { DeploySuccess } from "../components/DeploySuccess";
import { Sidebar } from "../components/Sidebar";
import { useBackend } from "../hooks/useBackend";

export default function CreateTokenPage() {
  const { createToken, principal, isConnected } = useBackend();
  const { toast } = useToast();

  const [current, setCurrent] = useState(0);
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    decimals: "8",
    supply: "",
    fee: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState(0);
  const [resultId, setResultId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      return await createToken({
        tokenName: form.name,
        symbol: form.symbol,
        totalSupply: Number(form.supply),
        decimals: Number(form.decimals)
      });
    },
    onSuccess: (data: any) => {
      setResultId(data.canisterId || data.tokenId || "");
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message || "Deployment failed", variant: "destructive" });
      setCurrent(2); // back to review
    }
  });

  // progress animation
  useEffect(() => {
    if (current === 3 && mutation.isPending) {
      setProgress(10);
      const t = setInterval(() => {
        setProgress(p => (p < 90 ? p + 10 : p));
      }, 500);
      return () => clearInterval(t);
    }
    if (mutation.isSuccess) setProgress(100);
  }, [current, mutation.isPending, mutation.isSuccess]);

  const validateStep = () => {
    const errs: Record<string, string> = {};
    if (current === 0) {
      if (!form.name || form.name.length < 2 || form.name.length > 64) errs.name = "Name 2-64 chars";
      if (!/^[A-Z0-9]{2,10}$/.test(form.symbol)) errs.symbol = "Symbol 2-10 A-Z0-9";
      const dec = Number(form.decimals);
      if (isNaN(dec) || dec < 0 || dec > 18) errs.decimals = "Decimals 0-18";
    } else if (current === 1) {
      if (!form.supply || Number(form.supply) <= 0) errs.supply = "Enter supply";
      if (!form.fee || Number(form.fee) < 0) errs.fee = "Enter fee";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const next = () => {
    if (validateStep()) setCurrent(c => c + 1);
  };
  const back = () => setCurrent(c => Math.max(0, c - 1));

  const startDeploy = () => {
    setCurrent(3);
    mutation.mutate();
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 p-4 md:p-8">
        <Stepper current={current} />
        {current === 0 && (
          <Card className="max-w-xl mx-auto">
            <CardHeader>
              <CardTitle>Token Info</CardTitle>
              <CardDescription>Basic details for your token</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Token Name</Label>
                <Input id="name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={errors.name ? "border-red-500" : ""} />
                {errors.name && <p className="text-red-600 text-sm">{errors.name}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="symbol">Token Symbol</Label>
                <Input id="symbol" value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} className={errors.symbol ? "border-red-500" : ""} />
                {errors.symbol && <p className="text-red-600 text-sm">{errors.symbol}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="decimals">Decimals</Label>
                <Input id="decimals" type="number" value={form.decimals} onChange={e => setForm({ ...form, decimals: e.target.value })} className={errors.decimals ? "border-red-500" : ""} />
                <p className="text-xs text-gray-500">Most ICP tokens use 8</p>
                {errors.decimals && <p className="text-red-600 text-sm">{errors.decimals}</p>}
              </div>
              <div className="flex justify-end space-x-2">
                <Button onClick={next}>Next</Button>
              </div>
            </CardContent>
          </Card>
        )}
        {current === 1 && (
          <Card className="max-w-xl mx-auto">
            <CardHeader>
              <CardTitle>Supply & Fees</CardTitle>
              <CardDescription>Define initial supply and transfer fee</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="supply">Initial Supply</Label>
                <Input id="supply" type="number" value={form.supply} onChange={e => setForm({ ...form, supply: e.target.value })} className={errors.supply ? "border-red-500" : ""} />
                {errors.supply && <p className="text-red-600 text-sm">{errors.supply}</p>}
                <p className="text-xs text-gray-500">{form.supply ? Number(form.supply).toLocaleString() : 0} tokens</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fee">Transfer Fee</Label>
                <Input id="fee" type="number" value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} className={errors.fee ? "border-red-500" : ""} />
                {errors.fee && <p className="text-red-600 text-sm">{errors.fee}</p>}
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={back}>Back</Button>
                <Button onClick={next}>Next</Button>
              </div>
            </CardContent>
          </Card>
        )}
        {current === 2 && (
          <Card className="max-w-xl mx-auto">
            <CardHeader>
              <CardTitle>Review & Deploy</CardTitle>
              <CardDescription>Confirm details before deploying</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-gray-100 rounded p-4 text-sm space-y-2">
                <div className="flex justify-between"><span>Name</span><span>{form.name}</span></div>
                <div className="flex justify-between"><span>Symbol</span><span>{form.symbol}</span></div>
                <div className="flex justify-between"><span>Decimals</span><span>{form.decimals}</span></div>
                <div className="flex justify-between"><span>Initial Supply</span><span>{form.supply}</span></div>
                <div className="flex justify-between"><span>Fee</span><span>{form.fee}</span></div>
                <div className="flex justify-between"><span>Minting Account</span><span className="truncate max-w-[160px]">{principal || "-"}</span></div>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setCurrent(0)}>Edit Info</Button>
                <Button variant="outline" onClick={() => setCurrent(1)}>Edit Supply</Button>
              </div>
              <div className="flex justify-between mt-4">
                <Button variant="outline" onClick={back}>Back</Button>
                <Button onClick={startDeploy} disabled={!isConnected}>Deploy</Button>
              </div>
              {!isConnected && <p className="text-center text-sm text-red-600">Connect your wallet to deploy</p>}
            </CardContent>
          </Card>
        )}
        {current === 3 && (
          <Card className="max-w-xl mx-auto">
            <CardHeader>
              <CardTitle>Deploying...</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {mutation.isSuccess && resultId ? (
                <DeploySuccess canisterId={resultId} />
              ) : (
                <>
                  <Progress value={progress} className="w-full" />
                  <p className="text-center text-sm">Creating your token on ICP, please wait...</p>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
