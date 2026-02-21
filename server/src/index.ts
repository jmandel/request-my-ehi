import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { config } from "./config.ts";
import { signatureRoutes } from "./routes/signature.ts";
import { faxRoutes } from "./routes/fax.ts";
import { isSimulatedMode } from "./fax/index.ts";
import { getSession } from "./store.ts";

// Build client-side QR code bundle at startup
const qrBuild = await Bun.build({
  entrypoints: [new URL("./qr-browser.ts", import.meta.url).pathname],
  target: "browser",
  minify: true,
});
const qrBundleJs = await qrBuild.outputs[0].text();

const app = new Hono();

app.use("*", cors());

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// API routes
app.route("/api/signatures", signatureRoutes);
app.route("/api/fax", faxRoutes);

// Serve sign.html for /sign/:sessionId
app.get("/sign/:sessionId", async (c) => {
  const sessionId = c.req.param("sessionId");
  const session = getSession(sessionId);
  if (!session) {
    return c.text("Session not found or expired", 404);
  }
  const html = await Bun.file(new URL("../public/sign.html", import.meta.url).pathname).text();
  return c.html(html);
});

// Serve fax outbox UI (only in simulated mode)
app.get("/fax-outbox", async (c) => {
  if (!isSimulatedMode()) {
    return c.text("Fax outbox is only available in simulated mode", 404);
  }
  const html = await Bun.file(new URL("../public/fax-outbox.html", import.meta.url).pathname).text();
  return c.html(html);
});

// Serve client-side QR code bundle
app.get("/public/qrcode.min.js", (c) => {
  return c.body(qrBundleJs, 200, {
    "Content-Type": "application/javascript",
    "Cache-Control": "public, max-age=86400",
  });
});

// Static files fallback
app.use("/public/*", serveStatic({ root: "./" }));

// Dynamically build skill.zip on request
app.get("/skill.zip", async (c) => {
  const { Glob } = await import("bun");
  const path = await import("path");
  const rootDir = path.resolve(import.meta.dir, "../..");
  
  // Files to include in the zip
  const files: { path: string; content: Uint8Array }[] = [];
  
  // Add individual files
  const individualFiles = ["SKILL.md", "README.md", "LICENSE"];
  for (const file of individualFiles) {
    const filePath = path.join(rootDir, file);
    try {
      const content = await Bun.file(filePath).arrayBuffer();
      files.push({ path: `request-my-ehi/${file}`, content: new Uint8Array(content) });
    } catch (e) {
      // Skip missing files
    }
  }
  
  // Add templates/*.pdf
  const templatesDir = path.join(rootDir, "templates");
  for (const file of ["right-of-access-form.pdf", "appendix.pdf", "cover-letter.pdf", "drivers-license-page.md"]) {
    try {
      const content = await Bun.file(path.join(templatesDir, file)).arrayBuffer();
      files.push({ path: `request-my-ehi/templates/${file}`, content: new Uint8Array(content) });
    } catch (e) {
      // Skip missing files
    }
  }
  
  // Add scripts/*.ts and scripts config files
  const scriptsDir = path.join(rootDir, "scripts");
  const glob = new Glob("*.ts");
  for await (const file of glob.scan(scriptsDir)) {
    const content = await Bun.file(path.join(scriptsDir, file)).arrayBuffer();
    files.push({ path: `request-my-ehi/scripts/${file}`, content: new Uint8Array(content) });
  }
  for (const file of ["package.json", "config.json", "bun.lock"]) {
    try {
      const content = await Bun.file(path.join(scriptsDir, file)).arrayBuffer();
      files.push({ path: `request-my-ehi/scripts/${file}`, content: new Uint8Array(content) });
    } catch (e) {
      // Skip missing files
    }
  }
  
  // Build zip using Bun's native zip writer
  const zipData = Bun.gzipSync(new Uint8Array(0)); // dummy to check if we have compression
  
  // Use a simple zip implementation
  const zip = await buildZip(files);
  
  return new Response(zip, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=skill.zip",
    },
  });
});

// Simple ZIP file builder (store-only, no compression needed for small files)
async function buildZip(files: { path: string; content: Uint8Array }[]): Promise<Uint8Array> {
  const entries: { header: Uint8Array; data: Uint8Array; centralHeader: Uint8Array }[] = [];
  let offset = 0;
  
  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.path);
    const crc = crc32(file.content);
    
    // Local file header
    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); // signature
    hv.setUint16(4, 10, true); // version needed
    hv.setUint16(6, 0, true); // flags
    hv.setUint16(8, 0, true); // compression (store)
    hv.setUint16(10, 0, true); // mod time
    hv.setUint16(12, 0, true); // mod date
    hv.setUint32(14, crc, true); // crc32
    hv.setUint32(18, file.content.length, true); // compressed size
    hv.setUint32(22, file.content.length, true); // uncompressed size
    hv.setUint16(26, nameBytes.length, true); // name length
    hv.setUint16(28, 0, true); // extra length
    header.set(nameBytes, 30);
    
    // Central directory header
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 10, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // compression
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    cv.setUint32(16, crc, true); // crc32
    cv.setUint32(20, file.content.length, true); // compressed size
    cv.setUint32(24, file.content.length, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    
    entries.push({ header, data: file.content, centralHeader: central });
    offset += header.length + file.content.length;
  }
  
  // Calculate total size
  const centralStart = offset;
  let centralSize = 0;
  for (const e of entries) centralSize += e.centralHeader.length;
  
  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // signature
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // central dir disk
  ev.setUint16(8, entries.length, true); // entries on disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, centralSize, true); // central dir size
  ev.setUint32(16, centralStart, true); // central dir offset
  ev.setUint16(20, 0, true); // comment length
  
  // Combine all parts
  const totalSize = offset + centralSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (const e of entries) {
    result.set(e.header, pos); pos += e.header.length;
    result.set(e.data, pos); pos += e.data.length;
  }
  for (const e of entries) {
    result.set(e.centralHeader, pos); pos += e.centralHeader.length;
  }
  result.set(eocd, pos);
  
  return result;
}

// CRC32 implementation
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = getCrc32Table();
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

let crc32Table: Uint32Array | null = null;
function getCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crc32Table[i] = c;
  }
  return crc32Table;
}

// Serve the main site (index.html, etc.) from /site
app.use("/*", serveStatic({ root: "../site" }));

console.log(`EHI Relay server listening on port ${config.port}`);
console.log(`  Base URL: ${config.baseUrl}`);
console.log(`  Signature UI: ${config.baseUrl}/sign/<sessionId>`);
if (isSimulatedMode()) {
  console.log(`  Fax Outbox (simulated): ${config.baseUrl}/fax-outbox`);
} else {
  console.log(`  Fax Provider: Sinch (real faxes)`);
}

export default {
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 120, // Allow long-polling up to 2 minutes
};
