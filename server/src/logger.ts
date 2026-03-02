/**
 * Simple structured logger for API activity.
 * Logs to stdout in JSON format AND persists to SQLite for dashboard.
 * 
 * PRIVACY: Only logs opaque IDs, event types, and timestamps.
 * Does NOT log: IP addresses, user agents, phone numbers, names, or payload data.
 */
import { recordEvent, type EventType } from "./db.ts";

export type LogEvent = {
  timestamp: string;
  event: string;
  [key: string]: unknown;
};

export function log(event: string, data: Record<string, unknown> = {}) {
  const entry: LogEvent = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// Convenience functions for specific events
export const logger = {
  signatureSessionCreated(sessionId: string) {
    log("signature_session_created", { sessionId });
    recordEvent("signature_session_created");
  },

  signatureSessionSubmitted(sessionId: string, hasDriversLicense: boolean) {
    log("signature_session_submitted", { sessionId, hasDriversLicense });
    recordEvent("signature_session_submitted", { hasDriversLicense });
  },

  signatureSessionPolled(sessionId: string, status: string) {
    log("signature_session_polled", { sessionId, status });
    // Don't record polls - too noisy
  },

  faxSent(faxId: string, provider: string) {
    log("fax_sent", { faxId, provider });
    recordEvent("fax_sent");
  },

  faxStatusChanged(faxId: string, status: string) {
    log("fax_status_changed", { faxId, status });
    // Record delivered/failed as separate event types for dashboard
    if (status === "delivered") {
      recordEvent("fax_delivered");
    } else if (status === "failed") {
      recordEvent("fax_failed");
    }
  },

  faxWebhookReceived(matched: boolean, status?: string) {
    log("fax_webhook", { matched, status });
    // Don't record webhooks separately - faxStatusChanged handles it
  },

  skillDownload() {
    log("skill_download", {});
    recordEvent("skill_download");
  },
};
