import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { db, agreementsTable, retailersTable, branchesTable, activityTable } from "@workspace/db";
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

// ADMIN + PORTAL: Download signed agreement as PDF
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

  const pdfDoc = await PDFDocument.create();

  // ── Try to fetch and prepend the original Formitize form PDF ─────────────
  const jobId      = agreement.formitizeJobId;
  const storedUrl  = (agreement as any).formitizeFormUrl as string | null;
  const apiKey     = process.env.FORMITIZE_API_KEY || "";

  const formPdfUrls = [
    storedUrl,
    jobId ? `https://api.formitize.com/v1/jobs/${jobId}/report` : null,
    jobId ? `https://service.formitize.com/report/${jobId}` : null,
  ].filter(Boolean) as string[];

  let formPdfFetched = false;
  for (const url of formPdfUrls) {
    try {
      const resp = await fetch(url, {
        headers: { "X-API-Key": apiKey, "Authorization": `Bearer ${apiKey}` },
      });
      if (resp.ok) {
        const contentType = resp.headers.get("content-type") || "";
        if (contentType.includes("pdf")) {
          const bytes = await resp.arrayBuffer();
          const existing = await PDFDocument.load(bytes);
          const copied = await pdfDoc.copyPagesFrom(existing, existing.getPageIndices());
          copied.forEach(p => pdfDoc.addPage(p));
          formPdfFetched = true;
          break;
        }
      }
    } catch { /* try next URL */ }
  }

  // ── Generate execution certificate page ──────────────────────────────────
  const helvetica     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const PAGE_W = 595, PAGE_H = 841, MARGIN = 50;

  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawText = (text: string, x: number, yPos: number, size: number, bold = false, color = rgb(0,0,0)) => {
    page.drawText(text, { x, y: yPos, size, font: bold ? helveticaBold : helvetica, color });
  };

  // Header
  drawText("LOAN AGREEMENT EXECUTION CERTIFICATE", MARGIN, y, 14, true, rgb(0.07, 0.07, 0.07));
  y -= 18;
  drawText("Tefco Finance (Pvt) Ltd — HukuPlus Central", MARGIN, y, 9, false, rgb(0.4, 0.4, 0.4));
  y -= 6;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;

  // Details grid (2 columns)
  const col1 = MARGIN, col2 = PAGE_W / 2 + 10, rowH = 28;
  const drawField = (label: string, value: string, x: number, yPos: number) => {
    drawText(label.toUpperCase(), x, yPos + 10, 7, false, rgb(0.5, 0.5, 0.5));
    drawText(value || "—", x, yPos, 10, true);
  };

  drawField("Customer", agreement.customerName, col1, y);
  drawField("Loan Product", agreement.loanProduct || "Novafeeds", col2, y);
  y -= rowH;
  drawField("Retailer", retailer?.name ?? "", col1, y);
  drawField("Branch", branch?.name ?? "", col2, y);
  y -= rowH;
  drawField("Loan Amount", `USD ${Number(agreement.loanAmount ?? 0).toFixed(2)}`, col1, y);
  drawField("Status", (agreement.status || "").toUpperCase(), col2, y);
  y -= rowH;
  drawField("Agreement Issued", agreement.createdAt ? new Date(agreement.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—", col1, y);
  drawField("Executed On", agreement.signedAt ? new Date(agreement.signedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—", col2, y);
  y -= rowH + 8;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 18;
  drawText("SIGNATURES", MARGIN, y, 9, true, rgb(0.4, 0.4, 0.4));
  y -= 14;

  // Draw a signature box
  const SIG_W = (PAGE_W - MARGIN * 2 - 16) / 2;
  const SIG_H = 100;
  const drawSigBox = async (label: string, sublabel: string, sigData: string | null, x: number, yPos: number) => {
    // Box border
    page.drawRectangle({ x, y: yPos, width: SIG_W, height: SIG_H, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1, color: rgb(1,1,1) });
    // Label bar
    page.drawRectangle({ x, y: yPos + SIG_H - 22, width: SIG_W, height: 22, color: rgb(0.97, 0.97, 0.97) });
    drawText(label, x + 6, yPos + SIG_H - 13, 7, true, rgb(0.3, 0.3, 0.3));
    drawText(sublabel, x + 6, yPos + SIG_H - 21, 6, false, rgb(0.6, 0.6, 0.6));
    // Signature image
    if (sigData) {
      try {
        const base64 = sigData.replace(/^data:image\/\w+;base64,/, "");
        const imgBytes = Buffer.from(base64, "base64");
        const img = await pdfDoc.embedPng(imgBytes).catch(() => pdfDoc.embedJpg(imgBytes));
        const { width: iw, height: ih } = img.scale(1);
        const scale = Math.min((SIG_W - 12) / iw, (SIG_H - 28) / ih, 1);
        page.drawImage(img, { x: x + 6, y: yPos + 6, width: iw * scale, height: ih * scale });
      } catch { /* skip if corrupt */ }
    } else {
      drawText("Not yet signed", x + SIG_W / 2 - 28, yPos + SIG_H / 2 - 14, 8, false, rgb(0.7, 0.7, 0.7));
    }
  };

  const sigs = {
    c1: agreement.signatureData ?? null,
    c2: (agreement as any).customerSignature2 ?? null,
    c3: (agreement as any).customerSignature3 ?? null,
    mgr: (agreement as any).managerSignature ?? null,
  };

  await drawSigBox("Customer Signature 1 of 3", "Acknowledgement of loan terms", sigs.c1, col1, y - SIG_H);
  await drawSigBox("Customer Signature 2 of 3", "Repayment schedule confirmation", sigs.c2, col2, y - SIG_H);
  y -= SIG_H + 12;
  await drawSigBox("Customer Signature 3 of 3", "Final authorisation", sigs.c1 ? sigs.c3 : null, col1, y - SIG_H);
  await drawSigBox("Store Manager / Supervisor", "Authorised store representative", sigs.mgr, col2, y - SIG_H);
  y -= SIG_H + 20;

  // Footer
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });
  y -= 12;
  drawText(`This certificate was generated by HukuPlus Central · Tefco Finance (Pvt) Ltd`, MARGIN, y, 7, false, rgb(0.6, 0.6, 0.6));
  y -= 10;
  if (!formPdfFetched) {
    drawText("Note: Original Formitize form PDF was not available — this document serves as the execution record.", MARGIN, y, 7, false, rgb(0.6, 0.4, 0.1));
  }

  const pdfBytes = await pdfDoc.save();
  const filename = `${agreement.customerName.replace(/[^a-z0-9 ]/gi, "")} - Signed Agreement.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
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
  res.json({
    retailerName: retailer?.name ?? "",
    branchName: branch?.name ?? "",
    loanProduct: agreement.loanProduct,
    status: agreement.status,
    customerName: agreement.customerName,
    loanAmount: agreement.loanAmount,
    formitizeFormUrl: (agreement as any).formitizeFormUrl ?? null,
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

  res.json({ success: true, signedAt: signedAt.toISOString() });
});

export default router;
