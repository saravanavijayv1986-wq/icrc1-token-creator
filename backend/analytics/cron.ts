import { analyticsDB } from "./db";
import log from "encore.dev/log";
// NOTE: Cron API for Encore.ts. If the runtime doesn't support cron directly,
// this handler remains a callable function you can wire up later.
import { Cron } from "encore.dev/cron";

// Refresh materialized view with safety: concurrent refresh and error handling
async function refreshTokenMetricsSummary(): Promise<void> {
  try {
    await analyticsDB.rawExec("REFRESH MATERIALIZED VIEW CONCURRENTLY token_metrics_summary");
    log.info("token_metrics_summary refreshed");
  } catch (e) {
    log.error("Failed to refresh token_metrics_summary", { error: e instanceof Error ? e.message : String(e) });
  }
}

// Schedule: every day at 03:00 UTC
export const refreshTokenMetricsSummaryCron = new Cron(
  "refresh-token-metrics-summary",
  { schedule: "0 3 * * *" },
  async () => {
    await refreshTokenMetricsSummary();
  }
);

// Export function for manual triggering if needed
export { refreshTokenMetricsSummary };
