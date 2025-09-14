import log from "encore.dev/log";

// This is a mock implementation for Sentry integration.
// In a real production environment, you would use the Sentry SDK.

export interface SentryContext {
  level?: "info" | "warning" | "error" | "fatal" | "debug";
  tags?: Record<string, string>;
  extra?: Record<string, any>;
  fingerprint?: string[];
}

/**
 * Captures an exception and sends it to Sentry (mock implementation).
 * @param error The error to capture.
 * @param context Additional context for the error.
 */
export function captureException(error: Error, context?: SentryContext): void {
  log.error("Sentry Capture Exception (mock)", {
    error: error.message,
    stack: error.stack,
    ...context,
  });
}

/**
 * Adds a breadcrumb to the Sentry context (mock implementation).
 * Breadcrumbs are events that happened prior to an issue.
 * @param message The breadcrumb message.
 * @param category The category of the breadcrumb.
 * @param level The severity level of the breadcrumb.
 * @param data Additional data for the breadcrumb.
 */
export function addBreadcrumb(
  message: string,
  category?: string,
  level?: "info" | "warning" | "error",
  data?: Record<string, any>
): void {
  log.info("Sentry Add Breadcrumb (mock)", {
    message,
    category,
    level,
    data,
  });
}

/**
 * Sets a tag in the Sentry context (mock implementation).
 * Tags are key-value pairs that can be used for filtering events.
 * @param key The tag key.
 * @param value The tag value.
 */
export function setTag(key: string, value: string): void {
  log.info("Sentry Set Tag (mock)", {
    key,
    value,
  });
}
