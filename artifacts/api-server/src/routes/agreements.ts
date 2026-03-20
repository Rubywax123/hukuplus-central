import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "crypto";
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
