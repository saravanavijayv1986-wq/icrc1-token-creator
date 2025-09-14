import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from "recharts";
import { Activity, AlertTriangle, CheckCircle, Clock, TrendingDown, TrendingUp, Zap, Server, Bell, Settings } from "lucide-react";
import backend from "~backend/client";

interface MonitoringDashboardProps {
  canisterId?: string;
  tokenId?: number;
}

export default function MonitoringDashboard({ canisterId, tokenId }: MonitoringDashboardProps) {
  const [selectedTimeRange, setSelectedTimeRange] = useState('24h');
  const { toast } = useToast();

  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ["canister-health", canisterId, tokenId],
    queryFn: async () => {
      const params: any = {};
      if (canisterId) params.canisterId = canisterId;
      if (tokenId) params.tokenId = tokenId;
      return await backend.monitoring.getCanisterHealth(params);
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const { data: transactionMetrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["transaction-metrics", canisterId, tokenId, selectedTimeRange],
    queryFn: async () => {
      const params: any = {};
      if (canisterId) params.canisterId = canisterId;
      if (tokenId) params.tokenId = tokenId;
      
      const days = selectedTimeRange === '24h' ? 1 : 
                   selectedTimeRange === '7d' ? 7 : 
                   selectedTimeRange === '30d' ? 30 : 7;
      params.days = days;
      
      return await backend.monitoring.getTransactionMetrics(params);
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts } = useQuery({
    queryKey: ["monitoring-alerts", canisterId],
    queryFn: async () => {
      const params: any = {};
      if (canisterId) params.canisterId = canisterId;
      return await backend.monitoring.getAlerts(params);
    },
    refetchInterval: 15000, // Refresh every 15 seconds
  });

  const { data: performanceMetrics } = useQuery({
    queryKey: ["performance-metrics", canisterId, tokenId, selectedTimeRange],
    queryFn: async () => {
      const params: any = {};
      if (canisterId) params.canisterId = canisterId;
      if (tokenId) params.tokenId = tokenId;
      
      const hours = selectedTimeRange === '24h' ? 24 : 
                    selectedTimeRange === '7d' ? 168 : 
                    selectedTimeRange === '30d' ? 720 : 24;
      params.hours = hours;
      
      return await backend.monitoring.getPerformanceMetrics(params);
    },
    refetchInterval: 60000,
  });

  const acknowledgeAlert = async (alertId: number) => {
    try {
      await backend.monitoring.acknowledgeAlert({
        alertId,
        acknowledgedBy: "dashboard-user" // In a real app, this would be the current user
      });
      toast({
        title: "Alert Acknowledged",
        description: "The alert has been marked as acknowledged.",
      });
      refetchAlerts();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to acknowledge alert.",
        variant: "destructive",
      });
    }
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

  const formatMemory = (memory: string | number) => {
    const bytes = typeof memory === 'string' ? parseInt(memory) : memory;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) {
      return `${(mb / 1024).toFixed(2)}GB`;
    }
    return `${mb.toFixed(2)}MB`;
  };

  const getHealthStatus = (canister: any) => {
    if (canister.status !== 'running') return 'critical';
    if (canister.alertCount > 0) return 'warning';
    if (canister.uptimePercentage < 95) return 'warning';
    return 'healthy';
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'text-green-600 bg-green-100';
      case 'warning': return 'text-yellow-600 bg-yellow-100';
      case 'critical': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-500';
      case 'warning': return 'bg-yellow-500';
      case 'info': return 'bg-blue-500';
      default: return 'bg-gray-500';
    }
  };

  // Prepare chart data
  const transactionChartData = transactionMetrics?.metrics.map(metric => ({
    date: new Date(metric.date).toLocaleDateString(),
    success: metric.successfulTransactions,
    failed: metric.failedTransactions,
    successRate: metric.successRate,
    responseTime: metric.averageResponseTime,
  })) || [];

  const performanceChartData = performanceMetrics?.metrics
    .filter(m => m.metricType === 'response_time')
    .map(metric => ({
      time: new Date(metric.measurementTime).toLocaleTimeString(),
      responseTime: metric.metricValue,
    })) || [];

  return (
    <div className="space-y-6">
      {/* Health Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Canisters</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{healthData?.summary.totalCanisters || 0}</div>
            <div className="flex items-center space-x-2 text-xs text-muted-foreground mt-1">
              <span className="text-green-600">{healthData?.summary.healthyCanisters || 0} healthy</span>
              <span className="text-red-600">{healthData?.summary.unhealthyCanisters || 0} unhealthy</span>
            </div>
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
            <Progress 
              value={healthData?.summary.averageUptimePercentage || 0} 
              className="h-2 mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cycles</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCycles(healthData?.summary.totalCyclesBalance || "0")}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Across all canisters</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {alerts?.summary.totalAlerts || 0}
            </div>
            <div className="flex items-center space-x-2 text-xs text-muted-foreground mt-1">
              <span className="text-red-600">{alerts?.summary.criticalAlerts || 0} critical</span>
              <span className="text-yellow-600">{alerts?.summary.warningAlerts || 0} warning</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={selectedTimeRange} onValueChange={setSelectedTimeRange} className="space-y-4">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="24h">24 Hours</TabsTrigger>
            <TabsTrigger value="7d">7 Days</TabsTrigger>
            <TabsTrigger value="30d">30 Days</TabsTrigger>
          </TabsList>
          <Button variant="outline" onClick={() => {
            refetchHealth();
            refetchAlerts();
          }}>
            Refresh Data
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Canister Health */}
          <Card>
            <CardHeader>
              <CardTitle>Canister Health</CardTitle>
              <CardDescription>
                Real-time health status of your token canisters
              </CardDescription>
            </CardHeader>
            <CardContent>
              {healthLoading ? (
                <div className="text-center py-4">Loading health data...</div>
              ) : healthData?.canisters.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  No canisters found
                </div>
              ) : (
                <div className="space-y-4">
                  {healthData?.canisters.map((canister) => {
                    const status = getHealthStatus(canister);
                    return (
                      <div key={canister.canisterId} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <h4 className="font-semibold">{canister.tokenName}</h4>
                            <p className="text-sm text-muted-foreground">{canister.symbol}</p>
                          </div>
                          <Badge className={getStatusColor(status)}>
                            {status}
                          </Badge>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">Cycles</p>
                            <p className="font-medium">{formatCycles(canister.cycleBalance)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Memory</p>
                            <p className="font-medium">{formatMemory(canister.memorySize)}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Uptime</p>
                            <p className="font-medium">{canister.uptimePercentage.toFixed(1)}%</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Response Time</p>
                            <p className="font-medium">{canister.responseTimeMs}ms</p>
                          </div>
                        </div>

                        {canister.alertCount > 0 && (
                          <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded">
                            <p className="text-sm text-yellow-800">
                              {canister.alertCount} active alert{canister.alertCount !== 1 ? 's' : ''}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active Alerts */}
          <Card>
            <CardHeader>
              <CardTitle>Active Alerts</CardTitle>
              <CardDescription>
                Recent alerts that require attention
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <div className="text-center py-4">Loading alerts...</div>
              ) : alerts?.alerts.length === 0 ? (
                <div className="text-center py-4 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                  No active alerts
                </div>
              ) : (
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {alerts?.alerts.slice(0, 10).map((alert) => (
                    <div key={alert.id} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            <div className={`w-2 h-2 rounded-full ${getSeverityColor(alert.severity)}`}></div>
                            <h4 className="font-medium text-sm">{alert.title}</h4>
                            <Badge variant="outline" className="text-xs">
                              {alert.severity}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-2">{alert.message}</p>
                          <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                            <span>{alert.tokenName}</span>
                            <span>•</span>
                            <span>{new Date(alert.createdAt).toLocaleString()}</span>
                          </div>
                        </div>
                        {!alert.acknowledged && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => acknowledgeAlert(alert.id)}
                          >
                            Acknowledge
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Transaction Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>Transaction Success Metrics</CardTitle>
            <CardDescription>
              Transaction success rates and performance over time
            </CardDescription>
          </CardHeader>
          <CardContent>
            {metricsLoading ? (
              <div className="text-center py-8">Loading metrics...</div>
            ) : transactionChartData.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No transaction data available for the selected period
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold text-green-600">
                        {transactionMetrics?.summary.overallSuccessRate.toFixed(1)}%
                      </div>
                      <p className="text-sm text-muted-foreground">Success Rate</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold">
                        {transactionMetrics?.summary.totalTransactions.toLocaleString()}
                      </div>
                      <p className="text-sm text-muted-foreground">Total Transactions</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold">
                        {transactionMetrics?.summary.averageResponseTime.toFixed(0)}ms
                      </div>
                      <p className="text-sm text-muted-foreground">Avg Response Time</p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-2xl font-bold text-red-600">
                        {transactionMetrics?.summary.totalFailed.toLocaleString()}
                      </div>
                      <p className="text-sm text-muted-foreground">Failed Transactions</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h4 className="text-sm font-medium mb-3">Transaction Volume</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={transactionChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="success" stackId="a" fill="#10b981" name="Successful" />
                        <Bar dataKey="failed" stackId="a" fill="#ef4444" name="Failed" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div>
                    <h4 className="text-sm font-medium mb-3">Success Rate Trend</h4>
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={transactionChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={[0, 100]} />
                        <Tooltip formatter={(value) => [`${value}%`, 'Success Rate']} />
                        <Line 
                          type="monotone" 
                          dataKey="successRate" 
                          stroke="#10b981" 
                          strokeWidth={2}
                          name="Success Rate"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Performance Metrics */}
        {performanceChartData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Performance Metrics</CardTitle>
              <CardDescription>
                Response time and performance trends
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">
                      {performanceMetrics?.summary.averageResponseTime.toFixed(0)}ms
                    </div>
                    <p className="text-sm text-muted-foreground">Avg Response Time</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">
                      {performanceMetrics?.summary.averageErrorRate.toFixed(1)}%
                    </div>
                    <p className="text-sm text-muted-foreground">Error Rate</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4">
                    <div className="text-2xl font-bold">
                      {performanceMetrics?.summary.averageThroughput.toFixed(1)}
                    </div>
                    <p className="text-sm text-muted-foreground">Throughput</p>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-3">Response Time Trend</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={performanceChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`${value}ms`, 'Response Time']} />
                    <Line 
                      type="monotone" 
                      dataKey="responseTime" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      name="Response Time"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </Tabs>
    </div>
  );
}
