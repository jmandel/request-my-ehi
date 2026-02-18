/**
 * Fax provider factory - returns configured provider based on env
 */

import type { FaxProvider } from "./types.ts";
import { simulatedProvider } from "./simulated.ts";
import { sinchProvider, isConfigured as sinchConfigured } from "./sinch.ts";

export type { FaxProvider, FaxSendRequest, FaxResult, FaxStatusResult } from "./types.ts";
export { simulateStatusChange } from "./simulated.ts";

let _isSimulatedMode: boolean | null = null;

export function isSimulatedMode(): boolean {
  if (_isSimulatedMode === null) {
    _isSimulatedMode = !sinchConfigured();
  }
  return _isSimulatedMode;
}

export function getFaxProvider(): FaxProvider {
  // Use Sinch if configured, otherwise simulated
  if (sinchConfigured()) {
    console.log("[Fax] Using Sinch provider");
    return sinchProvider;
  }
  console.log("[Fax] Using simulated provider");
  return simulatedProvider;
}

// Export for explicit selection
export { simulatedProvider, sinchProvider };
