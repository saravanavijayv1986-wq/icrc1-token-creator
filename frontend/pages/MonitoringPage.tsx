import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Search, Settings, AlertTriangle, TrendingUp, Activity } from "lucide-react";
import MonitoringDashboard from "../components/MonitoringDashboard";
import backend from "~backend/client";

export default function MonitoringPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCanister, setSelectedCanister] = useState<string | undefined>();
  const [selectedToken, setSelectedToken] = useState<number | undefined>();
  const { toast } = useToast();

  const { data: healthData } = useQuery({
    queryKey: ["monitoring-overview"],
    queryFn: async () => await backend.monitoring.getCanisterHealth({}),
    refetchInterval: 30000,
  });

  const { data: alertsSummary } = useQuery({
    queryKey: ["alerts-summary"],
    queryFn: async () => await backend.monitoring.getAlerts({ acknowledged: false }),
    refetchInterval: 15000,
  });

  const filteredCanisters = healthData?.canisters.filter(canister =>
    canister.tokenName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    canister.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
    canister.canisterId.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const handleCanisterSelect = (canister: any) => {
    setSelectedCanister(canister.canisterId);
    setSelectedToken(canister.tokenId);
  };

  const clearSelection = () => {
    setSelectedCanister(undefined);
    setSelectedToken(undefined);
  };

  const getHealthStatusColor = (canister: any) => {
    if (canister.status !== 'running') return 'bg-red-500';
    if (canister.alertCount > 0) return 'bg-yellow-500';
    if (canister.uptimePercentage < 95) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatCycles = (cycles: string | number) => {
    const num = typeof cycles === 'string' ? parseInt(cycles) : cycles;
    if (num >= 1e12) {
      return `${(num / 1e12).toFixed(2)}T`;
    } else if (num >= 1e9) {
      return `${(num / 1e9).toFixed(2)}B`;
    } else if (num >= 1e6) {
      return `${(num / 1e6).toFixed(2)}M`;
    }
    return num.toLocaleString();
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Canister Monitoring</h1>
        <p className="text-muted-foreground">
          Monitor the health, performance, and alerts for your token canisters on the Internet Computer.
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Canisters</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{healthData?.summary.totalCanisters || 0}</div>
            <p className="text-xs text-muted-foreground">
              {healthData?.summary.healthyCanisters || 0} healthy, {healthData?.summary.unhealthyCanisters || 0} unhealthy
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Average Uptime</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(healthData?.summary.averageUptimePercentage || 0).toFixed(1)}%
            </div>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {alertsSummary?.summary.criticalAlerts || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {alertsSummary?.summary.warningAlerts || 0} warnings
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cycles</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCycles(healthData?.summary.totalCyclesBalance || "0")}
            </div>
            <p className="text-xs text-muted-foreground">Across all canisters</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Canister List */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle>Canisters</CardTitle>
              <CardDescription>
                Select a canister to view detailed monitoring information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search canisters..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Clear selection */}
              {selectedCanister && (
                <Button variant="outline" onClick={clearSelection} className="w-full">
                  View All Canisters
                </Button>
              )}

              {/* Canister list */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {filteredCanisters.map((canister) => (
                  <div
                    key={canister.canisterId}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedCanister === canister.canisterId
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => handleCanisterSelect(canister)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-medium text-sm">{canister.tokenName}</h4>
                        <p className="text-xs text-muted-foreground">{canister.symbol}</p>
                      </div>
                      <div className={`w-2 h-2 rounded-full ${getHealthStatusColor(canister)}`}></div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Cycles</p>
                        <p className="font-medium">{formatCycles(canister.cycleBalance)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Uptime</p>
                        <p className="font-medium">{canister.uptimePercentage.toFixed(1)}%</p>
                      </div>
                    </div>

                    {canister.alertCount > 0 && (
                      <Badge variant="destructive" className="text-xs mt-2">
                        {canister.alertCount} alert{canister.alertCount !== 1 ? 's' : ''}
                      </Badge>
                    )}

                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {canister.canisterId}
                    </p>
                  </div>
                ))}

                {filteredCanisters.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-2" />
                    <p>No canisters found</p>
                    {searchQuery && (
                      <p className="text-xs">Try adjusting your search</p>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Monitoring Dashboard */}
        <div className="lg:col-span-2">
          <MonitoringDashboard
            canisterId={selectedCanister}
            tokenId={selectedToken}
          />
        </div>
      </div>
    </div>
  );
}
