import log from "encore.dev/log";

// Minimal Sentry wrapper to avoid tight coupling and leaking sensitive data.
let sentry: any = null;

export function initSentry(dsn?: string): void {
  if (!dsn) return;
  try {
    // Lazy import so builds work even if Sentry isn't configured.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require("@sentry/node");
    Sentry.init({
      dsn,
      tracesSampleRate: 0.1,
      maxBreadcrumbs: 50,
      attachStacktrace: true,
      beforeSend(event: any) {
        // Scrub potentially sensitive request data
        if (event.request) {
          delete event.request.headers;
          delete event.request.cookies;
          delete event.request.data;
        }
        return event;
      },
    });
    sentry = Sentry;
    log.info("Sentry initialized");
  } catch (e) {
    log.warn("Failed to initialize Sentry", { error: e instanceof Error ? e.message : String(e) });
  }
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  if (!sentry) return;
  try {
    sentry.withScope((scope: any) => {
      if (context) {
        for (const [k, v] of Object.entries(context)) {
          scope.setExtra(k, v as any);
        }
      }
      sentry.captureException(err);
    });
  } catch (e) {
    log.warn("Failed to capture exception", { error: e instanceof Error ? e.message : String(e) });
  }
}
