/**
 * Sinch fax provider
 * https://developers.sinch.com/docs/fax/api-reference/fax/
 */

import type { FaxProvider, FaxSendRequest, FaxResult, FaxStatusResult } from "./types.ts";

const ACCESS_KEY = process.env.SINCH_ACCESS_KEY || '';
const ACCESS_SECRET = process.env.SINCH_ACCESS_SECRET || '';
const PROJECT_ID = process.env.SINCH_PROJECT_ID || '';
const BASE_URL = `https://fax.api.sinch.com/v3/projects/${PROJECT_ID}`;

function getAuthHeader(): string {
  return `Basic ${Buffer.from(`${ACCESS_KEY}:${ACCESS_SECRET}`).toString('base64')}`;
}

function mapStatus(sinchStatus: string): FaxResult["status"] {
  switch (sinchStatus) {
    case "QUEUED": return "queued";
    case "IN_PROGRESS": return "sending";
    case "COMPLETED": return "delivered";
    case "FAILURE": return "failed";
    default: return "queued";
  }
}

export function isConfigured(): boolean {
  return !!(ACCESS_KEY && ACCESS_SECRET && PROJECT_ID);
}

export const sinchProvider: FaxProvider = {
  name: "sinch",

  async send(request: FaxSendRequest): Promise<FaxResult> {
    const to = request.to.startsWith('+') ? request.to : `+${request.to}`;
    const filename = request.filename || 'document.pdf';

    const formData = new FormData();
    formData.append('to', to);
    formData.append('file', new Blob([request.fileBuffer], { type: 'application/pdf' }), filename);
    
    // Only add callback if it looks valid
    if (request.callbackUrl && request.callbackUrl.startsWith('http')) {
      formData.append('callbackUrl', request.callbackUrl);
      formData.append('callbackUrlContentType', 'application/json');
    }

    console.log(`[Sinch] Sending fax to ${to}`);

    const response = await fetch(`${BASE_URL}/faxes`, {
      method: 'POST',
      headers: { 'Authorization': getAuthHeader() },
      body: formData,
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(`[Sinch] Error ${response.status}: ${text}`);
      throw new Error(`Sinch API error: ${text}`);
    }

    const result = JSON.parse(text);
    console.log(`[Sinch] Created fax ${result.id}, status: ${result.status}`);

    return {
      providerFaxId: result.id,
      status: mapStatus(result.status),
      error: result.errorMessage,
    };
  },

  async getStatus(providerFaxId: string): Promise<FaxStatusResult> {
    const response = await fetch(`${BASE_URL}/faxes/${providerFaxId}`, {
      method: 'GET',
      headers: { 'Authorization': getAuthHeader() },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Sinch API error: ${text}`);
    }

    const result = await response.json();
    return {
      status: mapStatus(result.status),
      pageCount: result.numberOfPages,
      completedAt: result.completedTime,
      error: result.errorMessage,
    };
  },
};
