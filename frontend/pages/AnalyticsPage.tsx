import AnalyticsDashboard from "../components/AnalyticsDashboard";

export default function AnalyticsPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Platform Analytics</h1>
        <p className="text-muted-foreground">
          Comprehensive analytics and insights for the TokenForge platform.
        </p>
      </div>

      <AnalyticsDashboard />
    </div>
  );
}
