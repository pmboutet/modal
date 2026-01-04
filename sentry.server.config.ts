import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Performance Monitoring
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

  // Debug mode in development
  debug: process.env.NODE_ENV === "development",

  // Environment tag
  environment: process.env.NODE_ENV,

  // Before sending - filter out noise
  beforeSend(event) {
    // Filter out Node.js deprecation warnings from dependencies
    const message = event.message || event.exception?.values?.[0]?.value || "";
    if (message.includes("DeprecationWarning") && message.includes("url.parse")) {
      return null; // Don't send this event
    }
    return event;
  },

  // Capture unhandled promise rejections
  integrations: [
    Sentry.captureConsoleIntegration({
      levels: ["error"],
    }),
  ],
});
