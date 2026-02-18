/**
 * Fax provider interface - implement for any backend
 */

export interface FaxSendRequest {
  to: string;
  fileBuffer: Buffer;
  filename?: string;
  callbackUrl?: string;
}

export interface FaxResult {
  providerFaxId: string;
  status: "queued" | "sending" | "delivered" | "failed";
  error?: string;
}

export interface FaxStatusResult {
  status: "queued" | "sending" | "delivered" | "failed";
  pageCount?: number;
  completedAt?: string;
  error?: string;
}

export interface FaxProvider {
  readonly name: string;
  send(request: FaxSendRequest): Promise<FaxResult>;
  getStatus(providerFaxId: string): Promise<FaxStatusResult>;
}
