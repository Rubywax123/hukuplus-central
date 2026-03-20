import { Router } from "express";
import { db, agreementsTable, retailersTable, branchesTable, activityTable } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import crypto from "crypto";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ─── Simple CSV parser ────────────────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (c === "," && !inQuote) {
        result.push(cur.trim()); cur = "";
      } else {
        cur += c;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (values[i] ?? "").trim(); });
    return row;
  }).filter(row => Object.values(row).some(v => v !== ""));
}

// ─── Column name resolver — handles Formitize's various export formats ────────
function getField(row: Record<string, string>, ...candidates: string[]): string {
  for (const key of candidates) {
    // Exact match (case-insensitive)
    const found = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
    if (found && row[found]) return row[found];
    // Partial match — column name contains the candidate
    const partial = Object.keys(row).find(k => k.toLowerCase().includes(key.toLowerCase()));
    if (partial && row[partial]) return row[partial];
  }
  return "";
}

// ─── Check if a string looks like a form template name, not a customer name ──
function isTemplateName(s: string): boolean {
  const upper = s.toUpperCase();
  return (
    upper.includes("LOAN AGREEMENT") ||
    upper.includes("NOVAFEED AGREEMENT") ||
    upper.includes("FINISHER LOAN") ||
    upper.includes("HUKUPLUS") ||
    upper.includes("CHIKWERET") ||
    upper.includes("REVOLVER") ||
    // Placeholder text like [Customer Full Name]
    s.includes("[") ||
    s.includes("]")
  );
}

// ─── POST /api/formitize/import-csv ──────────────────────────────────────────
router.post("/formitize/import-csv", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.file) { res.status(400).json({ error: "No CSV file uploaded" }); return; }

  const text = req.file.buffer.toString("utf-8");
  const rows = parseCSV(text);

  if (rows.length === 0) {
    res.status(400).json({ error: "CSV is empty or could not be parsed" });
    return;
  }

  // Return the detected column names so staff can debug mismatches
  const detectedColumns = Object.keys(rows[0]);

  const appUrl = process.env.APP_URL || "https://huku-plus-central.replit.app";
  const results: { imported: number; skipped: number; errors: string[]; detectedColumns: string[] } = {
    imported: 0, skipped: 0, errors: [], detectedColumns,
  };
  const importedAgreements: { customerName: string; branch: string; signingUrl: string }[] = [];

  // Pre-load all retailers and branches for matching
  const allRetailers = await db.select().from(retailersTable);
  const allBranches = await db.select().from(branchesTable);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-indexed, +1 for header

    try {
      // ── Extract Job ID for dedup ─────────────────────────────────────────
      const jobId = getField(row, "ID", "id", "Job ID", "job_id", "FormId", "form_id");

      if (jobId) {
        const existing = await db.select({ id: agreementsTable.id })
          .from(agreementsTable)
          .where(eq(agreementsTable.formitizeJobId, jobId));
        if (existing.length > 0) { results.skipped++; continue; }
      }

      // ── Extract raw title ────────────────────────────────────────────────
      const title = getField(row, "Title", "title", "Job Title");

      // ── Customer name — dedicated field first, then parse from Title ─────
      let customerName = getField(row,
        "Customer Name", "customer_name", "CustomerName",
        "Full Name", "full_name", "Fullname",
        "Client Name", "client_name",
        "Name", "Customer"
      );

      // Try parsing from Title: format is usually "Branch - Customer Name"
      if (!customerName && title.includes(" - ")) {
        const afterDash = title.split(" - ").slice(1).join(" - ").trim();
        if (afterDash && !isTemplateName(afterDash)) {
          customerName = afterDash;
        }
      }

      // Last resort: use the whole title if it looks like a person's name
      if (!customerName && title && !isTemplateName(title)) {
        customerName = title;
      }

      if (!customerName || isTemplateName(customerName)) {
        results.errors.push(`Row ${rowNum}: Could not determine customer name (title="${title}")`);
        continue;
      }

      // ── Retailer/chain ───────────────────────────────────────────────────
      const retailerRaw = getField(row,
        "Store Chain", "store_chain", "StoreChain",
        "Retailer", "retailer_name", "Chain", "Company",
        "Feed Company", "Feed Store", "Store"
      );

      // ── Branch — try column first, then extract from Title prefix ────────
      let branchRaw = getField(row,
        "Store Branch", "store_branch", "StoreBranch",
        "Branch", "branch_name", "Location", "Site",
        "Store Location", "Shop", "Outlet"
      );

      // If branch is empty, try the part before " - " in the Title
      if (!branchRaw && title.includes(" - ")) {
        const beforeDash = title.split(" - ")[0].trim();
        if (beforeDash && !isTemplateName(beforeDash)) {
          branchRaw = beforeDash;
        }
      }

      // ── Loan amount ──────────────────────────────────────────────────────
      const amountRaw = getField(row,
        "Loan Amount", "loan_amount", "LoanAmount",
        "Amount", "Value", "Total", "Feed Amount",
        "Amount Requested", "Requested Amount"
      );
      const loanAmount = parseFloat(amountRaw.replace(/[^0-9.]/g, "")) || 0;

      // ── Phone ────────────────────────────────────────────────────────────
      const customerPhone = getField(row,
        "Phone", "customer_phone", "CustomerPhone", "Mobile",
        "Cell", "Contact Number", "contact_number", "Tel",
        "Phone Number", "Telephone"
      ) || null;

      // ── Form / PDF URL ───────────────────────────────────────────────────
      const formUrl = getField(row,
        "Form URL", "form_url", "FormUrl", "URL", "Link", "PDF", "PDF URL", "pdf_url"
      ) || null;

      // ── Validate customer name ───────────────────────────────────────────
      if (!branchRaw) {
        results.errors.push(
          `Row ${rowNum} (${customerName}): Could not determine branch — ` +
          `check that your CSV has a "Store Branch" column with a value. ` +
          `Columns found: ${detectedColumns.join(", ")}`
        );
        continue;
      }

      // ── Match retailer ───────────────────────────────────────────────────
      let retailer = allRetailers.find(r =>
        r.name.toLowerCase() === retailerRaw.toLowerCase()
      ) ?? allRetailers.find(r =>
        r.name.toLowerCase().includes(retailerRaw.toLowerCase()) ||
        retailerRaw.toLowerCase().includes(r.name.toLowerCase())
      );

      // If no retailer match, try to find branch directly across all retailers
      if (!retailer) {
        const matchedBranch = allBranches.find(b =>
          b.name.toLowerCase().includes(branchRaw.toLowerCase()) ||
          branchRaw.toLowerCase().includes(b.name.toLowerCase())
        );
        if (matchedBranch) {
          retailer = allRetailers.find(r => r.id === matchedBranch.retailerId);
        }
      }

      if (!retailer) {
        results.errors.push(
          `Row ${rowNum} (${customerName}): Retailer not found — ` +
          `"${retailerRaw || "(blank)"}" — add this retailer in Central first`
        );
        continue;
      }

      // ── Match branch ─────────────────────────────────────────────────────
      const branchesForRetailer = allBranches.filter(b => b.retailerId === retailer!.id);
      const branch = branchesForRetailer.find(b =>
        b.name.toLowerCase() === branchRaw.toLowerCase()
      ) ?? branchesForRetailer.find(b =>
        b.name.toLowerCase().includes(branchRaw.toLowerCase()) ||
        branchRaw.toLowerCase().includes(b.name.toLowerCase())
      );

      if (!branch) {
        const available = branchesForRetailer.map(b => b.name).join(", ");
        results.errors.push(
          `Row ${rowNum} (${customerName}): Branch not found — ` +
          `"${branchRaw}" under ${retailer.name}. Available branches: ${available || "none"}`
        );
        continue;
      }

      // ── Insert agreement ─────────────────────────────────────────────────
      const signingToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      const [agreement] = await db.insert(agreementsTable).values({
        retailerId: retailer.id,
        branchId: branch.id,
        customerName,
        customerPhone,
        loanProduct: "Novafeeds",
        loanAmount,
        formitizeJobId: jobId || null,
        formitizeFormUrl: formUrl,
        signingToken,
        status: "pending",
        expiresAt,
        createdBy: "formitize-csv",
      }).returning();

      await db.insert(activityTable).values({
        type: "agreement_created",
        description: `Agreement imported from Formitize CSV for ${customerName}`,
        retailerName: retailer.name,
        branchName: branch.name,
        loanProduct: "Novafeeds",
        referenceId: agreement.id,
      });

      const signingUrl = formUrl || `${appUrl}/sign/${signingToken}`;
      importedAgreements.push({
        customerName,
        branch: `${retailer.name} / ${branch.name}`,
        signingUrl,
      });
      results.imported++;
    } catch (err: any) {
      results.errors.push(`Row ${rowNum}: ${err.message}`);
    }
  }

  res.json({
    ok: true,
    total: rows.length,
    imported: results.imported,
    skipped: results.skipped,
    errors: results.errors,
    detectedColumns,
    agreements: importedAgreements,
  });
});

// ─── GET /api/formitize/one-click ─────────────────────────────────────────────
// Field agent clicks this URL from the Formitize notification email.
// No login needed — protected by FORMITIZE_IMPORT_KEY env var.
// Usage: configure Formitize notification message to include:
//   https://huku-plus-central.replit.app/api/formitize/one-click
//     ?key=IMPORT_KEY
//     &customer={{CustomerName}}
//     &branch={{StoreBranch}}
//     &retailer={{StoreChain}}
//     &amount={{LoanAmount}}
//     &jobId={{JobID}}
router.get("/formitize/one-click", async (req, res): Promise<void> => {
  const importKey = process.env.FORMITIZE_IMPORT_KEY;
  if (importKey && req.query.key !== importKey) {
    res.status(401).send("Unauthorized — invalid import key.");
    return;
  }

  const customerName  = (req.query.customer as string || "").trim();
  const branchRaw     = (req.query.branch   as string || "").trim();
  const retailerRaw   = (req.query.retailer as string || "").trim();
  const amountRaw     = (req.query.amount   as string || "0");
  const jobId         = (req.query.jobId    as string || "").trim() || null;
  const formUrl       = (req.query.formUrl  as string || "").trim() || null;

  if (!customerName || !branchRaw) {
    res.status(400).send("Missing required fields: customer, branch");
    return;
  }

  const loanAmount = parseFloat(amountRaw.replace(/[^0-9.]/g, "")) || 0;
  const allRetailers = await db.select().from(retailersTable);
  const allBranches  = await db.select().from(branchesTable);

  // Dedup by jobId
  if (jobId) {
    const existing = await db.select({ id: agreementsTable.id })
      .from(agreementsTable).where(eq(agreementsTable.formitizeJobId, jobId));
    if (existing.length > 0) {
      const branch = allBranches.find(b => b.name.toLowerCase().includes(branchRaw.toLowerCase()));
      const appUrl = process.env.APP_URL || "https://huku-plus-central.replit.app";
      const kioskUrl = branch ? `${appUrl}/kiosk/${branch.id}` : appUrl;
      res.redirect(kioskUrl);
      return;
    }
  }

  // Match retailer
  let retailer = allRetailers.find(r => r.name.toLowerCase() === retailerRaw.toLowerCase())
    ?? allRetailers.find(r => r.name.toLowerCase().includes(retailerRaw.toLowerCase()) || retailerRaw.toLowerCase().includes(r.name.toLowerCase()))
    ?? allRetailers.find(r => {
        const b = allBranches.find(b2 => b2.name.toLowerCase().includes(branchRaw.toLowerCase()) || branchRaw.toLowerCase().includes(b2.name.toLowerCase()));
        return b && r.id === b.retailerId;
      });

  if (!retailer) {
    res.status(422).send(`Retailer not found: "${retailerRaw}". Please add it in HukuPlus Central.`);
    return;
  }

  // Match branch
  const branchesForRetailer = allBranches.filter(b => b.retailerId === retailer!.id);
  const branch = branchesForRetailer.find(b => b.name.toLowerCase() === branchRaw.toLowerCase())
    ?? branchesForRetailer.find(b => b.name.toLowerCase().includes(branchRaw.toLowerCase()) || branchRaw.toLowerCase().includes(b.name.toLowerCase()));

  if (!branch) {
    const available = branchesForRetailer.map(b => b.name).join(", ");
    res.status(422).send(`Branch not found: "${branchRaw}" under ${retailer.name}. Available: ${available}`);
    return;
  }

  const signingToken = crypto.randomBytes(32).toString("hex");
  const expiresAt    = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const appUrl       = process.env.APP_URL || "https://huku-plus-central.replit.app";

  const [agreement] = await db.insert(agreementsTable).values({
    retailerId: retailer.id, branchId: branch.id,
    customerName, loanProduct: "Novafeeds", loanAmount,
    formitizeJobId: jobId, formitizeFormUrl: formUrl,
    signingToken, status: "pending", expiresAt, createdBy: "formitize-one-click",
  }).returning();

  await db.insert(activityTable).values({
    type: "agreement_created",
    description: `Agreement auto-imported via one-click link for ${customerName}`,
    retailerName: retailer.name, branchName: branch.name, loanProduct: "Novafeeds",
    referenceId: agreement.id,
  });

  console.log(`[formitize:one-click] Imported: ${customerName} @ ${retailer.name}/${branch.name}`);

  // Redirect to the kiosk screen for that branch — it will now show the agreement
  res.redirect(`${appUrl}/kiosk/${branch.id}`);
});

// ─── POST /api/formitize/webhook ──────────────────────────────────────────────
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
  console.log("[formitize] Received webhook payload:", JSON.stringify(body, null, 2));

  const formName: string = (
    body.form_name || body.FormName || body.formName ||
    body.form_type || body.FormType || body.formType ||
    body.template_name || body.TemplateName || ""
  ).toLowerCase();

  if (formName !== "novafeed agreement") {
    console.log(`[formitize] Ignored form: "${formName || "(unnamed)"}"`);
    res.status(200).json({ ok: true, skipped: true, reason: "Not a Novafeed Agreement — ignored" });
    return;
  }

  const retailerName  = body.retailer_name  || body.RetailerName  || body.retailerName;
  const branchName    = body.branch_name    || body.BranchName    || body.branchName;
  const customerName  = body.customer_name  || body.CustomerName  || body.customerName;
  const customerPhone = body.customer_phone || body.CustomerPhone || body.customerPhone || null;
  const loanAmount    = parseFloat(body.loan_amount || body.LoanAmount || body.loanAmount || "0");
  const jobId         = body.job_id || body.JobId || body.formitize_job_id || null;
  const formUrl       = body.form_url || body.FormUrl || body.formUrl || null;

  if (!retailerName || !branchName || !customerName) {
    res.status(400).json({ error: "retailer_name, branch_name, customer_name are required" });
    return;
  }

  const [retailer] = await db.select().from(retailersTable).where(ilike(retailersTable.name, `%${retailerName}%`));
  if (!retailer) { res.status(422).json({ error: `Retailer not found: ${retailerName}` }); return; }

  const [branch] = await db.select().from(branchesTable)
    .where(eq(branchesTable.retailerId, retailer.id))
    .then(rows => rows.filter(r => r.name.toLowerCase().includes(branchName.toLowerCase())));
  if (!branch) { res.status(422).json({ error: `Branch not found: ${branchName} under ${retailerName}` }); return; }

  const signingToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const [agreement] = await db.insert(agreementsTable).values({
    retailerId: retailer.id,
    branchId: branch.id,
    customerName,
    customerPhone,
    loanProduct: "Novafeeds",
    loanAmount: isNaN(loanAmount) ? 0 : loanAmount,
    formitizeJobId: jobId,
    formitizeFormUrl: formUrl,
    signingToken,
    status: "pending",
    expiresAt,
    createdBy: "formitize",
  }).returning();

  const appUrl = process.env.APP_URL || "https://huku-plus-central.replit.app";
  const signingUrl = formUrl || `${appUrl}/sign/${signingToken}`;
  res.status(201).json({ ok: true, agreementId: agreement.id, signingUrl, retailer: retailer.name, branch: branch.name });
});

export default router;
