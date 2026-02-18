/**
 * Simulated fax provider - for testing/demo
 * Faxes go to in-memory outbox, status changed via UI
 */

import type { FaxProvider, FaxSendRequest, FaxResult, FaxStatusResult } from "./types.ts";

// In-memory store for simulated faxes
const simulatedFaxes = new Map<string, {
  status: FaxResult["status"];
  pageCount?: number;
  completedAt?: string;
}>();

export const simulatedProvider: FaxProvider = {
  name: "simulated",

  async send(request: FaxSendRequest): Promise<FaxResult> {
    const id = crypto.randomUUID();
    
    // Estimate pages from PDF size (~50KB per page)
    const estimatedPages = Math.max(1, Math.round(request.fileBuffer.length / 50000));
    
    simulatedFaxes.set(id, { 
      status: "queued",
      pageCount: estimatedPages,
    });
    
    return {
      providerFaxId: id,
      status: "queued",
    };
  },

  async getStatus(providerFaxId: string): Promise<FaxStatusResult> {
    const fax = simulatedFaxes.get(providerFaxId);
    if (!fax) {
      return { status: "failed", error: "Fax not found" };
    }
    return {
      status: fax.status,
      pageCount: fax.pageCount,
      completedAt: fax.completedAt,
    };
  },
};

// For the simulate endpoint - allows UI to change status
export function simulateStatusChange(
  providerFaxId: string, 
  newStatus: FaxResult["status"],
  error?: string
): boolean {
  const fax = simulatedFaxes.get(providerFaxId);
  if (!fax) return false;
  
  fax.status = newStatus;
  if (newStatus === "delivered" || newStatus === "failed") {
    fax.completedAt = new Date().toISOString();
  }
  return true;
}
