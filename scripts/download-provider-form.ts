#!/usr/bin/env bun
/**
 * Download a provider's PDF form from a URL.
 *
 * Usage:
 *   bun download-provider-form.ts --url <url> --output <path>
 *
 * Example:
 *   bun download-provider-form.ts \
 *     --url https://example.com/medical-records-release.pdf \
 *     --output /tmp/provider_form.pdf
 *
 * Follows redirects automatically. Verifies the response is a PDF
 * (or at least starts with %PDF). Exits with code 1 on failure.
 */

const args = Bun.argv.slice(2);

function flag(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

const url = flag("--url");
const output = flag("--output");

if (!url || !output) {
  console.error("Usage: bun download-provider-form.ts --url <url> --output <path>");
  console.error("  --url     URL of the PDF form to download");
  console.error("  --output  Local path to save the file (e.g., /tmp/provider_form.pdf)");
  process.exit(1);
}

try {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; request-my-ehi/1.0)",
      Accept: "application/pdf,*/*",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    console.error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length < 100) {
    console.error(`Response too small (${buf.length} bytes) — probably not a PDF`);
    process.exit(1);
  }

  const header = buf.subarray(0, 5).toString("ascii");
  if (header !== "%PDF-") {
    const contentType = res.headers.get("content-type") ?? "unknown";
    console.error(
      `Warning: response does not start with %PDF- (content-type: ${contentType}).`
    );
    console.error(`Saving anyway — verify the file manually.`);
  }

  await Bun.write(output, buf);
  console.log(`Saved ${buf.length} bytes to ${output}`);
} catch (e: any) {
  console.error(`Failed to download: ${e.message}`);
  process.exit(1);
}
