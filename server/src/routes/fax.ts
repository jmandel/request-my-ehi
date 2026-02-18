import { Hono } from "hono";
import { createFaxJob, getFaxJob, getAllFaxJobs, updateFaxJobStatus } from "../store.ts";
import { getFaxProvider, simulateStatusChange } from "../fax/index.ts";
import { config } from "../config.ts";

export const faxRoutes = new Hono();

const provider = getFaxProvider();

// Send a fax
faxRoutes.post("/send", async (c) => {
  const contentType = c.req.header("content-type") || "";
  
  let to: string;
  let fileBuffer: Buffer;
  let filename = "document.pdf";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    to = formData.get("to") as string;
    const file = formData.get("file") as File;
    if (!to || !file) {
      return c.json({ error: "Missing 'to' or 'file'" }, 400);
    }
    fileBuffer = Buffer.from(await file.arrayBuffer());
    filename = file.name || filename;
  } else {
    // JSON with base64 file
    const body = await c.req.json();
    to = body.to;
    if (!to || !body.fileBase64) {
      return c.json({ error: "Missing 'to' or 'fileBase64'" }, 400);
    }
    fileBuffer = Buffer.from(body.fileBase64, "base64");
    filename = body.filename || filename;
  }

  // Store locally
  const job = createFaxJob({ to, filename, fileBase64: fileBuffer.toString("base64") });

  // Send via provider
  try {
    const result = await provider.send({
      to,
      fileBuffer,
      filename,
      callbackUrl: `${config.baseUrl}/api/fax/webhook`,
    });
    
    // Update job with provider info
    (job as any).providerFaxId = result.providerFaxId;
    (job as any).provider = provider.name;
    
    return c.json({
      faxId: job.id,
      providerFaxId: result.providerFaxId,
      provider: provider.name,
      status: result.status,
    }, 201);
  } catch (err) {
    updateFaxJobStatus(job.id, "failed", err instanceof Error ? err.message : "Unknown error");
    return c.json({ error: err instanceof Error ? err.message : "Failed to send fax" }, 500);
  }
});

// Check fax status
faxRoutes.get("/status/:id", async (c) => {
  const job = getFaxJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "Fax job not found" }, 404);
  }

  // If we have a provider fax ID and it's not terminal, fetch latest
  const providerFaxId = (job as any).providerFaxId;
  if (providerFaxId && !["delivered", "failed"].includes(job.status)) {
    try {
      const status = await provider.getStatus(providerFaxId);
      if (status.status !== job.status) {
        updateFaxJobStatus(job.id, status.status, status.error);
      }
      if (status.pageCount) job.pages = status.pageCount;
    } catch (err) {
      console.error("Failed to fetch provider status:", err);
    }
  }

  return c.json({
    faxId: job.id,
    providerFaxId,
    provider: (job as any).provider || "simulated",
    status: job.status,
    to: job.to,
    filename: job.filename,
    pages: job.pages,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    errorMessage: job.errorMessage,
    events: job.events,
  });
});

// Webhook for Sinch callbacks (multipart/form-data or JSON)
faxRoutes.post("/webhook", async (c) => {
  console.log("[Fax Webhook] Received callback");
  
  let faxData: any;
  const contentType = c.req.header("content-type") || "";
  
  if (contentType.includes("multipart/form-data")) {
    // Sinch sends multipart by default
    const formData = await c.req.formData();
    const faxJson = formData.get("fax");
    if (faxJson && typeof faxJson === "string") {
      faxData = JSON.parse(faxJson);
    }
    console.log("[Fax Webhook] Multipart fax data:", faxData);
  } else {
    // JSON callback
    const body = await c.req.json();
    faxData = body.fax || body;
    console.log("[Fax Webhook] JSON fax data:", faxData);
  }
  
  if (!faxData?.id) {
    console.log("[Fax Webhook] No fax ID in callback");
    return c.json({ received: true, processed: false });
  }

  // Find job by provider fax ID
  const jobs = getAllFaxJobs();
  const job = jobs.find(j => (j as any).providerFaxId === faxData.id);
  
  if (job) {
    // Map Sinch status to our status
    let status: "queued" | "sending" | "delivered" | "failed" = "queued";
    switch (faxData.status) {
      case "QUEUED": status = "queued"; break;
      case "IN_PROGRESS": status = "sending"; break;
      case "COMPLETED": status = "delivered"; break;
      case "FAILURE": status = "failed"; break;
    }
    
    console.log(`[Fax Webhook] Updating job ${job.id} to ${status}`);
    updateFaxJobStatus(job.id, status, faxData.errorMessage);
    
    if (faxData.numberOfPages) {
      job.pages = faxData.numberOfPages;
    }
    
    return c.json({ received: true, processed: true, faxId: job.id });
  }
  
  console.log(`[Fax Webhook] No matching job for provider fax ${faxData.id}`);
  return c.json({ received: true, processed: false });
});

// List all fax jobs (for outbox UI)
faxRoutes.get("/jobs", (c) => {
  const jobs = getAllFaxJobs();
  return c.json(
    jobs.map((j) => ({
      faxId: j.id,
      providerFaxId: (j as any).providerFaxId,
      provider: (j as any).provider || "simulated",
      to: j.to,
      filename: j.filename,
      status: j.status,
      pages: j.pages,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      errorMessage: j.errorMessage,
      events: j.events,
      fileSizeKB: Math.round(Buffer.from(j.fileBase64, "base64").length / 1024),
    }))
  );
});

// Simulate a workflow event (only works for simulated provider)
faxRoutes.post("/jobs/:id/simulate", async (c) => {
  const job = getFaxJob(c.req.param("id"));
  if (!job) {
    return c.json({ error: "Fax job not found" }, 404);
  }

  if ((job as any).provider === "sinch") {
    return c.json({ error: "Cannot simulate Sinch fax - check real status" }, 400);
  }

  const body = await c.req.json();
  const { action, detail } = body;

  const validTransitions: Record<string, string[]> = {
    queued: ["sending", "failed"],
    sending: ["delivered", "failed"],
    delivered: [],
    failed: ["queued"],
  };

  if (!validTransitions[job.status]?.includes(action)) {
    return c.json({ error: `Cannot transition from "${job.status}" to "${action}"` }, 400);
  }

  // Update both our store and simulated provider
  const providerFaxId = (job as any).providerFaxId;
  if (providerFaxId) {
    simulateStatusChange(providerFaxId, action, detail);
  }
  
  const updated = updateFaxJobStatus(job.id, action, detail);
  return c.json({
    faxId: updated!.id,
    status: updated!.status,
    events: updated!.events,
  });
});

// Download the fax PDF
faxRoutes.get("/jobs/:id/download", (c) => {
  const job = getFaxJob(c.req.param("id"));
  if (!job) {
    return c.text("Not found", 404);
  }

  const pdfBytes = Buffer.from(job.fileBase64, "base64");
  return new Response(pdfBytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${job.filename}"`,
    },
  });
});
