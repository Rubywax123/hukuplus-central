import { Router, type IRouter } from "express";
import { eq, and, desc, isNull, isNotNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { generateNovafeedAgreementPdf } from "../lib/novafeed-pdf";
import { db, pool, agreementsTable, retailersTable, branchesTable, activityTable } from "@workspace/db";
import { deleteFromLoanRegister, updateLoanRegisterStatus } from "../lib/syncXeroInvoices";
import {
  CreateAgreementBody,
  GetAgreementParams,
  GetSigningSessionParams,
  VerifySigningIdentityParams,
  VerifySigningIdentityBody,
  SubmitSignatureParams,
  SubmitSignatureBody,
  ListAgreementsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function buildSigningUrl(req: any, token: string): string {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}/sign/${token}`;
}

router.get("/agreements", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const query = ListAgreementsQueryParams.safeParse(req.query);
  const agreements = await db.select().from(agreementsTable).orderBy(desc(agreementsTable.createdAt));
  const retailerMap: Record<number, string> = {};
  const branchMap: Record<number, string> = {};
  const retailers = await db.select({ id: retailersTable.id, name: retailersTable.name }).from(retailersTable);
  const branches = await db.select({ id: branchesTable.id, name: branchesTable.name }).from(branchesTable);
  retailers.forEach((r) => (retailerMap[r.id] = r.name));
  branches.forEach((b) => (branchMap[b.id] = b.name));

  let result = agreements.map((a) => ({
    ...a,
    retailerName: retailerMap[a.retailerId] ?? null,
    branchName: branchMap[a.branchId] ?? null,
    signingUrl: buildSigningUrl(req, a.signingToken),
  }));

  if (query.success) {
    if (query.data.retailerId) result = result.filter((a) => a.retailerId === query.data.retailerId);
    if (query.data.branchId) result = result.filter((a) => a.branchId === query.data.branchId);
    if (query.data.status) result = result.filter((a) => a.status === query.data.status);
    if (query.data.loanProduct) result = result.filter((a) => a.loanProduct === query.data.loanProduct);
  }

  res.json(result);
});

router.post("/agreements", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateAgreementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const signingToken = randomBytes(24).toString("hex");
  const expiryHours = parsed.data.expiryHours ?? 72;
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
  const [agreement] = await db
    .insert(agreementsTable)
    .values({
      ...parsed.data,
      signingToken,
      expiresAt,
      createdBy: req.user?.id ?? null,
    })
    .returning();

  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));

  await db.insert(activityTable).values({
    type: "agreement_created",
    description: `Loan agreement created for ${agreement.customerName} (${agreement.loanProduct})`,
    retailerName: retailer?.name ?? null,
    branchName: branch?.name ?? null,
    loanProduct: agreement.loanProduct,
    referenceId: agreement.id,
  });

  res.status(201).json({
    ...agreement,
    retailerName: retailer?.name ?? null,
    branchName: branch?.name ?? null,
    signingUrl: buildSigningUrl(req, signingToken),
  });
});

router.get("/agreements/:agreementId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = GetAgreementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [agreement] = await db.select().from(agreementsTable).where(eq(agreementsTable.id, params.data.agreementId));
  if (!agreement) {
    res.status(404).json({ error: "Agreement not found" });
    return;
  }
  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));
  res.json({
    ...agreement,
    retailerName: retailer?.name ?? null,
    branchName: branch?.name ?? null,
    signingUrl: buildSigningUrl(req, agreement.signingToken),
  });
});

// ADMIN: Update agreement status
router.patch("/agreements/:id/status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const { status } = req.body;
  const allowed = ["pending", "signed", "disbursed", "expired", "application"];
  if (!allowed.includes(status)) {
    res.status(400).json({ error: `Status must be one of: ${allowed.join(", ")}` });
    return;
  }
  const [updated] = await db
    .update(agreementsTable)
    .set({ status, ...(status === "signed" ? { signedAt: new Date() } : {}) })
    .where(eq(agreementsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Agreement not found" }); return; }
  res.json({ ok: true, id: updated.id, status: updated.status });
});

// ADMIN: Bulk update agreement status
router.post("/agreements/bulk-status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { ids, status } = req.body;
  const allowed = ["pending", "signed", "disbursed", "expired", "application"];
  if (!Array.isArray(ids) || ids.length === 0) { res.status(400).json({ error: "ids must be a non-empty array" }); return; }
  if (!allowed.includes(status)) { res.status(400).json({ error: `Status must be one of: ${allowed.join(", ")}` }); return; }
  const { inArray } = await import("drizzle-orm");
  await db
    .update(agreementsTable)
    .set({ status, ...(status === "signed" ? { signedAt: new Date() } : {}) })
    .where(inArray(agreementsTable.id, ids.map(Number)));
  res.json({ ok: true, updated: ids.length });
});

// ADMIN: Get full executed agreement with all signatures
router.get("/agreements/:id/execution", async (req, res): Promise<void> => {
  const isAdmin      = req.isAuthenticated();
  const portalUser   = (req.session as any)?.portalUser ?? null;
  if (!isAdmin && !portalUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [agreement] = await db.select().from(agreementsTable).where(eq(agreementsTable.id, id));
  if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }

  // Portal users may only view agreements that belong to their retailer
  if (!isAdmin && portalUser && agreement.retailerId !== portalUser.retailerId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));

  res.json({
    id: agreement.id,
    customerName: agreement.customerName,
    loanProduct: agreement.loanProduct,
    loanAmount: agreement.loanAmount,
    status: agreement.status,
    signedAt: agreement.signedAt?.toISOString() ?? null,
    createdAt: agreement.createdAt.toISOString(),
    formitizeJobId: agreement.formitizeJobId,
    formitizeFormUrl: (agreement as any).formitizeFormUrl ?? null,
    retailerName: retailer?.name ?? "",
    branchName: branch?.name ?? "",
    signatures: {
      customer1: agreement.signatureData ?? null,
      customer2: (agreement as any).customerSignature2 ?? null,
      customer3: (agreement as any).customerSignature3 ?? null,
      manager:   (agreement as any).managerSignature ?? null,
    },
  });
});

// ADMIN + PORTAL: Download complete signed Novafeed Agreement as PDF
router.get("/agreements/:id/download-pdf", async (req, res): Promise<void> => {
  const isAdmin    = req.isAuthenticated();
  const portalUser = (req.session as any)?.portalUser ?? null;
  if (!isAdmin && !portalUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [agreement] = await db.select().from(agreementsTable).where(eq(agreementsTable.id, id));
  if (!agreement) { res.status(404).json({ error: "Agreement not found" }); return; }
  if (!isAdmin && portalUser && agreement.retailerId !== portalUser.retailerId) {
    res.status(403).json({ error: "Access denied" }); return;
  }

  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch]   = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));

  const pdfBytes = await generateNovafeedAgreementPdf({
    id: agreement.id,
    customerName: agreement.customerName,
    customerPhone: agreement.customerPhone ?? null,
    loanAmount: agreement.loanAmount ?? null,
    loanProduct: agreement.loanProduct ?? null,
    status: agreement.status,
    createdAt: agreement.createdAt ?? null,
    signedAt: agreement.signedAt ?? null,
    formitizeJobId: agreement.formitizeJobId ?? null,
    signatureData: agreement.signatureData ?? null,
    customerSignature2: (agreement as any).customerSignature2 ?? null,
    customerSignature3: (agreement as any).customerSignature3 ?? null,
    managerSignature:   (agreement as any).managerSignature   ?? null,
    formData: (agreement as any).formData ?? null,
    retailerName: retailer?.name ?? "",
    branchName: branch?.name ?? "",
  });

  const filename = `${agreement.customerName.replace(/[^a-z0-9 ]/gi, "")} - Novafeed Agreement.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(Buffer.from(pdfBytes));
});

// ─── Delivery helpers ─────────────────────────────────────────────────────────

const APP_URL = (process.env.APP_URL ?? "https://huku-plus-central.replit.app").replace(/\/$/, "");
const WATI_API_URL   = (process.env.WATI_API_URL ?? "").replace(/\/$/, "");
const WATI_API_TOKEN = process.env.WATI_API_TOKEN ?? "";
const FORMITIZE_API_KEY = process.env.FORMITIZE_API_KEY ?? "";
const FORMITIZE_BASES = [
  "https://service.formitize.com/api/v1",
  "https://app.formitize.com/api/v2",
];

function cleanPhone(phone: string): string {
  return phone.replace(/^\+/, "").replace(/[\s\-()]/g, "");
}

async function sendSignedPdfViaWhatsApp(
  phone: string,
  customerName: string,
  pdfBytes: Uint8Array,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!WATI_API_URL || !WATI_API_TOKEN) {
    return { ok: false, error: "WATI not configured" };
  }
  const cleanedPhone = cleanPhone(phone);
  if (!cleanedPhone) return { ok: false, error: "No phone number" };

  try {
    const pdfUrl = `${APP_URL}/api/sign/${token}/agreement.pdf`;
    // Try URL-based send first (WATI sendSessionFile with URL body)
    const urlRes = await fetch(`${WATI_API_URL}/api/v1/sendSessionFile/${cleanedPhone}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WATI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: pdfUrl,
        mimeType: "application/pdf",
        fileName: `${customerName} - Novafeed Agreement.pdf`,
      }),
    });
    if (urlRes.ok) return { ok: true };

    // Fall back to multipart binary upload
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([pdfBytes], { type: "application/pdf" }),
      `${customerName} - Novafeed Agreement.pdf`,
    );
    const binaryRes = await fetch(`${WATI_API_URL}/api/v1/sendSessionFile/${cleanedPhone}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WATI_API_TOKEN}` },
      body: formData,
    });
    if (binaryRes.ok) return { ok: true };
    const errText = await binaryRes.text().catch(() => "unknown");
    return { ok: false, error: `WATI ${binaryRes.status}: ${errText.slice(0, 200)}` };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

async function attachPdfToFormitize(
  jobId: string,
  customerName: string,
  pdfBytes: Uint8Array,
): Promise<{ ok: boolean; error?: string }> {
  if (!FORMITIZE_API_KEY) return { ok: false, error: "FORMITIZE_API_KEY not set" };
  // Try several known Formitize attachment endpoint patterns
  const endpointPatterns = [
    `/forms/${jobId}/attachment`,
    `/jobs/${jobId}/attachment`,
    `/submissions/${jobId}/attachment`,
  ];
  for (const base of FORMITIZE_BASES) {
    for (const path of endpointPatterns) {
      try {
        const formData = new FormData();
        formData.append(
          "file",
          new Blob([pdfBytes], { type: "application/pdf" }),
          `${customerName} - Novafeed Agreement Signed.pdf`,
        );
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${FORMITIZE_API_KEY}` },
          body: formData,
        });
        if (res.status >= 200 && res.status < 300) {
          console.log(`[agreements] Formitize attach OK: ${base}${path}`);
          return { ok: true };
        }
        if (res.status !== 404 && res.status !== 405) {
          const text = await res.text().catch(() => "");
          console.log(`[agreements] Formitize attach ${res.status} at ${base}${path}: ${text.slice(0, 100)}`);
        }
      } catch { /* try next */ }
    }
  }
  return { ok: false, error: "All Formitize attachment endpoints failed" };
}

// ─── PUBLIC: Download agreement as PDF (uses signing token for auth) ──────────
// Accessible without staff auth — token acts as the credential.
// Returns the PDF in its current state (unsigned if pending, signed if executed).
router.get("/sign/:token/agreement.pdf", async (req, res): Promise<void> => {
  const token = req.params.token;
  if (!token || token.length < 20) { res.status(400).send("Invalid token"); return; }

  const [agreement] = await db.select().from(agreementsTable)
    .where(eq(agreementsTable.signingToken, token));
  if (!agreement) { res.status(404).send("Agreement not found"); return; }

  const [retailer] = await db.select().from(retailersTable)
    .where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable)
    .where(eq(branchesTable.id, agreement.branchId));

  const pdfBytes = await generateNovafeedAgreementPdf({
    id: agreement.id,
    customerName: agreement.customerName,
    customerPhone: agreement.customerPhone ?? null,
    loanAmount: agreement.loanAmount ?? null,
    loanProduct: agreement.loanProduct ?? null,
    status: agreement.status,
    createdAt: agreement.createdAt ?? null,
    signedAt: agreement.signedAt ?? null,
    formitizeJobId: agreement.formitizeJobId ?? null,
    signatureData: agreement.signatureData ?? null,
    customerSignature2: (agreement as any).customerSignature2 ?? null,
    customerSignature3: (agreement as any).customerSignature3 ?? null,
    managerSignature: (agreement as any).managerSignature ?? null,
    formData: (agreement as any).formData ?? null,
    retailerName: retailer?.name ?? "",
    branchName: branch?.name ?? "",
  });

  const filename = `${agreement.customerName.replace(/[^a-z0-9 ]/gi, "")} - Novafeed Agreement.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.send(Buffer.from(pdfBytes));
});

// PUBLIC: Get signing session info (no auth required)
router.get("/sign/:token", async (req, res): Promise<void> => {
  const params = GetSigningSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }
  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.signingToken, params.data.token));
  if (!agreement) {
    res.status(404).json({ error: "Signing link not found" });
    return;
  }
  const now = new Date();
  if (agreement.status === "pending" && agreement.expiresAt < now) {
    await db.update(agreementsTable).set({ status: "expired" }).where(eq(agreementsTable.id, agreement.id));
    agreement.status = "expired";
  }
  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));
  // For agreements that pre-date the disbursement/repayment columns, fall back to formData
  const fd = (agreement.formData ?? {}) as Record<string, string>;
  const disbursementDate = agreement.disbursementDate
    ?? fd["applieddisbursement"] ?? null;
  const repaymentDate = agreement.repaymentDate
    ?? fd["appliedsettlement"] ?? null;
  const repaymentAmount = agreement.repaymentAmount ?? null;

  res.json({
    retailerName: retailer?.name ?? "",
    branchName: branch?.name ?? "",
    loanProduct: agreement.loanProduct,
    status: agreement.status,
    customerName: agreement.customerName,
    loanAmount: agreement.loanAmount,
    formitizeFormUrl: (agreement as any).formitizeFormUrl ?? null,
    disbursementDate,
    repaymentDate,
    repaymentAmount,
  });
});

// PUBLIC: Verify identity before showing agreement
router.post("/sign/:token/verify", async (req, res): Promise<void> => {
  const params = VerifySigningIdentityParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }
  const parsed = VerifySigningIdentityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.signingToken, params.data.token));
  if (!agreement) {
    res.status(404).json({ error: "Signing link not found" });
    return;
  }
  if (agreement.status !== "pending") {
    res.status(400).json({ error: agreement.status === "signed" ? "This agreement has already been signed" : "This signing link has expired" });
    return;
  }
  if (new Date() > agreement.expiresAt) {
    await db.update(agreementsTable).set({ status: "expired" }).where(eq(agreementsTable.id, agreement.id));
    res.status(400).json({ error: "This signing link has expired" });
    return;
  }
  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));

  const normalize = (s: string) => s.trim().toLowerCase();
  if (
    normalize(parsed.data.retailerName) !== normalize(retailer?.name ?? "") ||
    normalize(parsed.data.branchName) !== normalize(branch?.name ?? "") ||
    normalize(parsed.data.customerName) !== normalize(agreement.customerName)
  ) {
    res.status(400).json({ error: "Identity verification failed. Please check the details and try again." });
    return;
  }

  res.json({
    agreementId: agreement.id,
    customerName: agreement.customerName,
    loanProduct: agreement.loanProduct,
    loanAmount: agreement.loanAmount,
    formitizeFormUrl: agreement.formitizeFormUrl,
    expiresAt: agreement.expiresAt.toISOString(),
  });
});

// PUBLIC: Submit signature
router.post("/sign/:token/submit", async (req, res): Promise<void> => {
  const params = SubmitSignatureParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid token" });
    return;
  }
  const parsed = SubmitSignatureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.signingToken, params.data.token));
  if (!agreement) {
    res.status(404).json({ error: "Signing link not found" });
    return;
  }
  if (agreement.status !== "pending") {
    res.status(400).json({ error: agreement.status === "signed" ? "Already signed" : "Link expired" });
    return;
  }
  if (new Date() > agreement.expiresAt) {
    await db.update(agreementsTable).set({ status: "expired" }).where(eq(agreementsTable.id, agreement.id));
    res.status(400).json({ error: "This signing link has expired" });
    return;
  }
  const signedAt = new Date();
  await db
    .update(agreementsTable)
    .set({
      status: "signed",
      signedAt,
      signatureData: parsed.data.signatureData,
      customerSignature2: parsed.data.customerSignature2,
      customerSignature3: parsed.data.customerSignature3,
      managerSignature: parsed.data.managerSignature,
    })
    .where(eq(agreementsTable.id, agreement.id));

  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, agreement.retailerId));
  const [branch] = await db.select().from(branchesTable).where(eq(branchesTable.id, agreement.branchId));

  await db.insert(activityTable).values({
    type: "agreement_signed",
    description: `${agreement.customerName} signed a ${agreement.loanProduct} agreement`,
    retailerName: retailer?.name ?? null,
    branchName: branch?.name ?? null,
    loanProduct: agreement.loanProduct,
    referenceId: agreement.id,
  });

  // Respond immediately — delivery runs in background
  res.json({ success: true, signedAt: signedAt.toISOString() });

  // ── Background: generate signed PDF and deliver ───────────────────────────
  setImmediate(async () => {
    try {
      const pdfBytes = await generateNovafeedAgreementPdf({
        id: agreement.id,
        customerName: agreement.customerName,
        customerPhone: agreement.customerPhone ?? null,
        loanAmount: agreement.loanAmount ?? null,
        loanProduct: agreement.loanProduct ?? null,
        status: "signed",
        createdAt: agreement.createdAt ?? null,
        signedAt,
        formitizeJobId: agreement.formitizeJobId ?? null,
        signatureData: parsed.data.signatureData,
        customerSignature2: parsed.data.customerSignature2 ?? null,
        customerSignature3: parsed.data.customerSignature3 ?? null,
        managerSignature: parsed.data.managerSignature ?? null,
        formData: (agreement as any).formData ?? null,
        retailerName: retailer?.name ?? "",
        branchName: branch?.name ?? "",
      });

      // WhatsApp delivery
      if (agreement.customerPhone) {
        const waResult = await sendSignedPdfViaWhatsApp(
          agreement.customerPhone,
          agreement.customerName,
          pdfBytes,
          params.data.token,
        );
        console.log(`[agreements] WhatsApp delivery for agreement ${agreement.id}: ${waResult.ok ? "OK" : waResult.error}`);
      }

      // Formitize attachment
      if (agreement.formitizeJobId) {
        const fmResult = await attachPdfToFormitize(
          agreement.formitizeJobId,
          agreement.customerName,
          pdfBytes,
        );
        console.log(`[agreements] Formitize attach for agreement ${agreement.id}: ${fmResult.ok ? "OK" : fmResult.error}`);
      }
    } catch (err) {
      console.error(`[agreements] Post-sign delivery error for agreement ${agreement.id}:`, err);
    }
  });
});

// ─── POST /agreements/:id/mark-done — toggle kiosk "done" flag ───────────────
router.post("/agreements/:id/mark-done", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const userName: string = (req.user as any)?.name ?? (req.user as any)?.email ?? "staff";
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT marked_done_at FROM agreements WHERE id = $1",
      [id]
    );
    if (rows.length === 0) { res.status(404).json({ error: "Agreement not found" }); return; }

    const isDone = !!rows[0].marked_done_at;
    if (isDone) {
      await client.query(
        "UPDATE agreements SET marked_done_at = NULL, marked_done_by = NULL WHERE id = $1",
        [id]
      );
    } else {
      await client.query(
        "UPDATE agreements SET marked_done_at = NOW(), marked_done_by = $2 WHERE id = $1",
        [id, userName]
      );
    }
    res.json({ ok: true, id, markedDone: !isDone });
  } finally {
    client.release();
  }
});

// ─── GET /loan-register — HukuPlus loan agreements (Formitize + Xero sync) ────
router.get("/loan-register", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const client2 = await pool.connect();
  try {
    const result = await client2.query(`
      SELECT
        a.id,
        a.customer_id,
        a.customer_name,
        a.customer_phone,
        a.loan_product,
        a.loan_amount,
        a.facility_fee_amount,
        a.interest_amount,
        a.repayment_amount,
        COALESCE(a.status, 'pending') AS status,
        a.form_type,
        COALESCE(a.source, 'formitize') AS source,
        COALESCE(a.dismissed, FALSE)    AS dismissed,
        a.xero_invoice_id,
        a.loan_register_id,
        a.disbursement_date,
        a.repayment_date,
        a.created_at,
        b.name AS branch_name,
        r.name AS retailer_name
      FROM agreements a
      LEFT JOIN branches  b ON b.id = a.branch_id
      LEFT JOIN retailers r ON r.id = a.retailer_id
      WHERE (a.loan_product = 'HukuPlus' OR COALESCE(a.source,'formitize') = 'xero_sync')
      ORDER BY a.created_at DESC
    `);
    res.json(result.rows);
  } finally {
    client2.release();
  }
});

// ─── PUT /agreements/:id/dismiss — soft-hide a Xero-synced erroneous entry ────
router.put("/agreements/:id/dismiss", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const dismiss: boolean = req.body.dismissed !== false;

  const client2 = await pool.connect();
  try {
    const result = await client2.query(
      "UPDATE agreements SET dismissed = $1 WHERE id = $2 RETURNING id, dismissed, loan_register_id, source",
      [dismiss, id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Agreement not found" });
      return;
    }
    const row = result.rows[0];

    // If dismissing a Xero-synced entry that has a Loan Register record, remove it there too
    if (dismiss && row.source === "xero_sync" && row.loan_register_id) {
      try {
        await deleteFromLoanRegister(row.loan_register_id);
        console.log(`[dismiss] Removed Loan Register entry #${row.loan_register_id} for agreement #${id}`);
      } catch (err: any) {
        console.warn(`[dismiss] Could not remove from Loan Register: ${err.message}`);
        // Non-fatal — local dismissal still applies
      }
    }

    res.json({ success: true, id, dismissed: dismiss });
  } finally {
    client2.release();
  }
});

// ─── PUT /loan-register/:lrId/status — manually flip Loan Register status ─────
router.put("/loan-register/:lrId/status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const lrId = parseInt(req.params.lrId, 10);
  if (!lrId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status } = req.body as { status?: string };
  if (status !== "completed" && status !== "active") {
    res.status(400).json({ error: "status must be 'completed' or 'active'" });
    return;
  }

  const ok = await updateLoanRegisterStatus(lrId, status);
  if (!ok) {
    res.status(502).json({ error: "Loan Register did not confirm the update" });
    return;
  }

  // Mirror the status in our local agreements table
  const client2 = await pool.connect();
  try {
    await client2.query(
      `UPDATE agreements SET status = $1, updated_at = NOW() WHERE loan_register_id = $2`,
      [status, lrId]
    );
  } finally {
    client2.release();
  }

  res.json({ ok: true, lrId, status });
});

export default router;

