import { Router } from "express";
import { db, agreementsTable, retailersTable, branchesTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

/**
 * POST /api/formitize/webhook
 *
 * Called by Formitize when a loan agreement form is submitted.
 * Maps Formitize field names to the agreements table.
 *
 * Expected Formitize fields (configurable):
 *   retailer_name, branch_name, customer_name, customer_phone,
 *   loan_product, loan_amount, formitize_job_id, form_url
 *
 * Secured by a shared webhook secret: FORMITIZE_WEBHOOK_SECRET env var.
 */
router.post("/formitize/webhook", async (req, res) => {
  const webhookSecret = process.env.FORMITIZE_WEBHOOK_SECRET;
  if (webhookSecret) {
    const provided = req.headers["x-formitize-secret"] || req.headers["x-webhook-secret"];
    if (provided !== webhookSecret) {
      res.status(401).json({ error: "Invalid webhook secret" });
      return;
    }
  }

  const body = req.body;

  // Only process HukuPlus Loan Agreement forms — ignore everything else from Formitize
  const formName: string = (
    body.form_name || body.FormName || body.formName ||
    body.form_type || body.FormType || body.formType ||
    body.template_name || body.TemplateName || ""
  ).toLowerCase();

  const isHukuPlusAgreement = formName.includes("hukuplus") || formName.includes("huku plus");

  if (!isHukuPlusAgreement) {
    console.log(`[formitize] Ignored form: "${formName || "(unnamed)"}"`);
    res.status(200).json({ ok: true, skipped: true, reason: "Not a HukuPlus Loan Agreement — ignored" });
    return;
  }

  const retailerName = body.retailer_name || body.RetailerName || body.retailerName;
  const branchName   = body.branch_name   || body.BranchName   || body.branchName;
  const customerName = body.customer_name || body.CustomerName || body.customerName;
  const customerPhone = body.customer_phone || body.CustomerPhone || body.customerPhone || null;
  const loanProduct  = "HukuPlus";
  const loanAmount   = parseFloat(body.loan_amount || body.LoanAmount || body.loanAmount || "0");
  const jobId        = body.job_id || body.JobId || body.formitize_job_id || null;
  const formUrl      = body.form_url || body.FormUrl || body.formUrl || null;

  if (!retailerName || !branchName || !customerName) {
    res.status(400).json({ error: "retailer_name, branch_name, customer_name are required" });
    return;
  }

  const [retailer] = await db.select().from(retailersTable).where(ilike(retailersTable.name, `%${retailerName}%`));
  if (!retailer) {
    res.status(422).json({ error: `Retailer not found: ${retailerName}` });
    return;
  }

  const [branch] = await db.select().from(branchesTable).where(
    eq(branchesTable.retailerId, retailer.id)
  ).then(rows => rows.filter(r => r.name.toLowerCase().includes(branchName.toLowerCase())));

  if (!branch) {
    res.status(422).json({ error: `Branch not found: ${branchName} under ${retailerName}` });
    return;
  }

  const signingToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const [agreement] = await db.insert(agreementsTable).values({
    retailerId: retailer.id,
    branchId: branch.id,
    customerName,
    customerPhone,
    loanProduct,
    loanAmount: isNaN(loanAmount) ? 0 : loanAmount,
    formitizeJobId: jobId,
    formitizeFormUrl: formUrl,
    signingToken,
    status: "pending",
    expiresAt,
    createdBy: "formitize",
  }).returning();

  const signingUrl = `${process.env.APP_URL || "https://hukupluscentral.replit.app"}/sign/${signingToken}`;

  res.status(201).json({
    ok: true,
    agreementId: agreement.id,
    signingUrl,
    retailer: retailer.name,
    branch: branch.name,
  });
});

export default router;
