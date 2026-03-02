/**
 * Simple structured logger for API activity.
 * Logs to stdout in JSON format for easy parsing.
 * 
 * PRIVACY: Only logs opaque IDs, event types, and timestamps.
 * Does NOT log: IP addresses, user agents, phone numbers, names, or payload data.
 */

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
  },

  signatureSessionSubmitted(sessionId: string, hasDriversLicense: boolean) {
    log("signature_session_submitted", { sessionId, hasDriversLicense });
  },

  signatureSessionPolled(sessionId: string, status: string) {
    log("signature_session_polled", { sessionId, status });
  },

  faxSent(faxId: string, provider: string) {
    log("fax_sent", { faxId, provider });
  },

  faxStatusChanged(faxId: string, status: string) {
    log("fax_status_changed", { faxId, status });
  },

  faxWebhookReceived(matched: boolean, status?: string) {
    log("fax_webhook", { matched, status });
  },

  skillDownload() {
    log("skill_download", {});
  },
};
