import { Router } from "express";
import { db, pool, agreementsTable, retailersTable, branchesTable, activityTable, customersTable } from "@workspace/db";
import { eq, ilike, desc } from "drizzle-orm";
import crypto from "crypto";
import multer from "multer";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";
import { createXeroInvoice } from "../lib/createXeroInvoice";
import { getXeroAuth, xeroHeaders } from "../lib/xeroAuth";

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
router.post("/formitize/import-csv", requireStaffAuth, requireSuperAdmin, upload.single("file"), async (req, res): Promise<void> => {
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

// ─── GET /formitize/status ────────────────────────────────────────────────────
router.get("/formitize/status", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const webhookUrl = `${process.env.APP_URL ?? "https://huku-plus-central.replit.app"}/api/formitize/webhook`;

  // Find the most recent webhook activity (any formitize_ type in the activity log)
  const result = await pool.query(
    `SELECT timestamp FROM activity WHERE type LIKE 'formitize_%' OR type LIKE 'agreement_%' OR type = 'application_received'
     ORDER BY timestamp DESC LIMIT 1`
  );
  const lastRow = result.rows[0];
  const lastWebhook: string | null = lastRow?.timestamp ?? null;

  // "Connected" = a webhook arrived in the last 14 days
  const connected = lastWebhook
    ? (Date.now() - new Date(lastWebhook).getTime()) < 14 * 24 * 60 * 60 * 1000
    : false;

  res.json({
    connected,
    lastWebhook,
    webhookUrl,
    apiKeyConfigured: Boolean(process.env.FORMITIZE_API_KEY),
  });
});

// ─── Form context detection ────────────────────────────────────────────────────
function parseFormContext(formName: string, trackingCategory?: string): {
  product: "HukuPlus" | "ChikweretiOne" | "Revolver";
  formType: "agreement" | "application" | "reapplication" | "drawdown" | "payment" | "upload" | "approval" | "undertaking" | "unknown";
} {
  const n = formName.toLowerCase();
  const tc = (trackingCategory ?? "").toLowerCase();

  let product: "HukuPlus" | "ChikweretiOne" | "Revolver" = "HukuPlus";

  if (n.includes("chikweret")) product = "ChikweretiOne";
  else if (n.includes("revolver")) product = "Revolver";
  // Salary / payroll deduction → ChikweretiOne
  // Form names: "Payroll Deduction Application", "Salary Deduction Application", etc.
  // Tracking category: "Tefco Salary Deduction"
  else if (
    n.includes("payroll deduction") ||
    n.includes("salary deduction") ||
    n.includes("payroll / salary") ||
    tc.includes("salary deduction") ||
    tc.includes("payroll deduction") ||
    tc.includes("tefco salary")
  ) product = "ChikweretiOne";
  // HukuPlus catches: "hukuplus", "novafeed", "new customer", "drawdown approval", "payment receipt"

  let formType: "agreement" | "application" | "reapplication" | "drawdown" | "payment" | "upload" | "approval" | "undertaking" | "unknown" = "unknown";
  if (n.includes("agreement")) formType = "agreement";
  else if (n.includes("re-application") || n.includes("reapplication") || n.includes("re application")) formType = "reapplication";
  // Explicitly match known non-loan form names BEFORE the generic "application" catch-all,
  // so expense claims / HR forms / other misc submissions that contain "application"
  // in their title are not mistaken for loan applications.
  else if (
    n.includes("expense") ||
    n.includes("leave application") ||
    n.includes("hr application") ||
    n.includes("staff application") ||
    n.includes("claim")
  ) formType = "unknown";
  else if (n.includes("application") && (
    n.includes("new customer") ||
    n.includes("hukuplus") ||
    n.includes("novafeed") ||
    n.includes("novafeeds") ||
    n.includes("chikweret") ||
    n.includes("revolver") ||
    n.includes("salary deduction") ||
    n.includes("payroll deduction") ||
    n.includes("loan application")
  )) formType = "application";
  else if (n.includes("application") && !n.includes("expense") && !n.includes("claim")) formType = "application";
  else if (n.includes("drawdown")) formType = "drawdown";
  else if (n.includes("payment") || n.includes("receipt") || n.includes("payment notice")) formType = "payment";
  else if (n.includes("upload") || n.includes("document") || n.includes("docs") || n.includes("loan doc")) formType = "upload";
  else if (n.includes("approval")) formType = "approval";
  else if (n.includes("undertaking")) formType = "undertaking";

  return { product, formType };
}

// ─── Delinquency check — cached LR fetch + name matching ─────────────────────
const LR_URL = process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
const LR_KEY = process.env.HUKUPLUS_API_KEY;

let _delinquentCache: { names: Array<{ full: string; words: string[] }>; fetchedAt: number } | null = null;
const DELINQUENT_TTL_MS = 15 * 60 * 1000; // 15 minutes

async function fetchDelinquentNames(): Promise<Array<{ full: string; words: string[] }>> {
  const now = Date.now();
  if (_delinquentCache && now - _delinquentCache.fetchedAt < DELINQUENT_TTL_MS) {
    return _delinquentCache.names;
  }
  if (!LR_KEY) return [];
  try {
    const res = await fetch(`${LR_URL}/api/central/loans`, {
      headers: { Authorization: `Bearer ${LR_KEY}` },
    });
    if (!res.ok) return _delinquentCache?.names ?? [];
    const raw = await res.json();
    const loans: any[] = Array.isArray(raw) ? raw : (raw?.loans ?? raw?.data ?? []);
    const delinquent = loans.filter(l => String(l.status ?? "").toLowerCase() === "delinquent");
    const names: Array<{ full: string; words: string[] }> = [];
    for (const l of delinquent) {
      const given   = String(l.clientGivenName   ?? "").trim();
      const surname = String(l.clientSurname      ?? "").trim();
      if (!given && !surname) continue;
      // Store both orderings so reversed-name entries still match
      for (const full of [`${given} ${surname}`, `${surname} ${given}`]) {
        const norm  = full.toLowerCase().trim();
        const words = norm.split(/\s+/).filter(w => w.length > 2);
        if (words.length) names.push({ full: norm, words });
      }
    }
    _delinquentCache = { names, fetchedAt: now };
    console.log(`[delinquency] Cache refreshed — ${delinquent.length} delinquent loans indexed`);
    return names;
  } catch (err: any) {
    console.warn(`[delinquency] Fetch failed: ${err.message}`);
    return _delinquentCache?.names ?? [];
  }
}

/** Returns the matched delinquent name (as stored in LR) or null if no match. */
function checkDelinquent(
  formName: string,
  delinquentNames: Array<{ full: string; words: string[] }>
): string | null {
  const norm      = formName.toLowerCase().trim();
  const formWords = norm.split(/\s+/).filter(w => w.length > 2);
  if (formWords.length === 0) return null;
  for (const entry of delinquentNames) {
    const common = formWords.filter(w => entry.words.includes(w));
    if (common.length >= 2) return entry.full;
    // Also catch single-surname match if both names only have one meaningful word
    if (formWords.length === 1 && entry.words.length === 1 && formWords[0] === entry.words[0]) {
      return entry.full;
    }
  }
  return null;
}

// ─── Upsert a notification record for every inbound Formitize submission ──────
async function upsertNotification(params: {
  jobId: string | null;
  formName: string;
  taskType: string;
  product: string;
  customerName: string;
  customerId?: number | null;
  customerPhone?: string | null;
  branchName?: string | null;
  retailerName?: string | null;
  paymentAmount?: number | null;
  status?: "new" | "actioned";
  isDelinquentWarning?: boolean;
  delinquentMatch?: string | null;
}) {
  try {
    // Detect near-duplicate payments: same customer + amount + product within 72h
    let isDuplicateWarning = false;
    if (params.taskType === "payment" && params.customerName && params.paymentAmount) {
      const dupeCheck = await pool.query(
        `SELECT id FROM formitize_notifications
         WHERE task_type = 'payment'
           AND product = $1
           AND LOWER(TRIM(customer_name)) = LOWER(TRIM($2))
           AND payment_amount = $3
           AND created_at > NOW() - INTERVAL '72 hours'
         LIMIT 1`,
        [params.product, params.customerName, params.paymentAmount]
      );
      if (dupeCheck.rows.length > 0) {
        isDuplicateWarning = true;
        console.warn(`[formitize:webhook] Potential duplicate payment detected for ${params.customerName} — $${params.paymentAmount}`);
      }
    }

    const initialStatus       = params.status ?? "new";
    const isDelinquent        = params.isDelinquentWarning ?? false;
    const delinquentMatch     = params.delinquentMatch ?? null;

    let isNewNotification = false;

    if (params.jobId) {
      // ON CONFLICT DO NOTHING — the unique index on formitize_job_id prevents duplicates.
      // customer_id is included in the initial INSERT so it's captured on first arrival.
      const res = await pool.query(
        `INSERT INTO formitize_notifications
           (formitize_job_id, form_name, task_type, product, customer_name, customer_id, customer_phone, branch_name, retailer_name, payment_amount, is_duplicate_warning, is_delinquent_warning, delinquent_match, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (formitize_job_id) WHERE formitize_job_id IS NOT NULL DO NOTHING`,
        [params.jobId, params.formName, params.taskType, params.product,
         params.customerName, params.customerId ?? null,
         params.customerPhone ?? null,
         params.branchName ?? null, params.retailerName ?? null,
         params.paymentAmount ?? null, isDuplicateWarning,
         isDelinquent, delinquentMatch, initialStatus]
      );
      isNewNotification = (res.rowCount ?? 0) > 0;
      // If the row already existed (conflict skipped), backfill customer_id if it was missing
      if (!isNewNotification && params.customerId) {
        await pool.query(
          `UPDATE formitize_notifications SET customer_id = $1 WHERE formitize_job_id = $2 AND customer_id IS NULL`,
          [params.customerId, params.jobId]
        );
      }
    } else {
      await pool.query(
        `INSERT INTO formitize_notifications
           (form_name, task_type, product, customer_name, customer_id, customer_phone, branch_name, retailer_name, payment_amount, is_duplicate_warning, is_delinquent_warning, delinquent_match, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [params.formName, params.taskType, params.product,
         params.customerName, params.customerId ?? null,
         params.customerPhone ?? null,
         params.branchName ?? null, params.retailerName ?? null,
         params.paymentAmount ?? null, isDuplicateWarning,
         isDelinquent, delinquentMatch, initialStatus]
      );
      isNewNotification = true;
    }

    // Auto-convert leads + sync contact to Wati when a new application arrives
    if (isNewNotification && (params.taskType === "application" || params.taskType === "reapplication")) {
      await autoConvertMatchingLead({
        customerName: params.customerName ?? null,
        customerId:   params.customerId   ?? null,
        formName:     params.formName     ?? null,
      });
      await upsertWatiContact({
        customerName: params.customerName  ?? null,
        formPhone:    params.customerPhone ?? null,
        customerId:   params.customerId    ?? null,
        product:      params.product       ?? null,
        taskType:     params.taskType      ?? null,
        branchName:   params.branchName    ?? null,
      });
    }
  } catch (err) {
    console.error("[formitize:webhook] Failed to upsert notification:", err);
  }
}

// ─── Auto-convert leads when an application / re-application arrives ─────────
// Runs after a notification is saved. Matches open leads by normalised phone or
// exact name, and flips their status to 'converted' automatically.

// Jaccard token-overlap score between two name strings (0–1).
// Tokens are lowercased and sorted so "Alex Chikwanda" == "Chikwanda Alex" == 1.0
function nameScore(a: string, b: string): number {
  const tA = new Set(a.trim().toLowerCase().split(/\s+/));
  const tB = new Set(b.trim().toLowerCase().split(/\s+/));
  const common = [...tA].filter(t => tB.has(t)).length;
  const union  = new Set([...tA, ...tB]).size;
  return union === 0 ? 0 : common / union;
}

async function autoConvertMatchingLead(params: {
  customerName: string | null;
  customerId: number | null;
  formName: string | null;
}) {
  const { customerName, customerId, formName } = params;
  if (!customerName) return;

  try {
    // Fetch all unconverted leads and score them by name similarity.
    // Phone is deliberately excluded — re-application forms often contain the
    // store's phone, not the customer's, making phone an unreliable signal.
    const { rows: leads } = await pool.query(
      `SELECT id, customer_name FROM leads WHERE status != 'converted' ORDER BY created_at DESC`
    );

    let bestId:    number | null = null;
    let bestScore: number        = 0;

    for (const lead of leads) {
      const score = nameScore(customerName, lead.customer_name ?? "");
      if (score > bestScore) { bestScore = score; bestId = lead.id; }
    }

    // Require at least 0.6 Jaccard similarity (60% token overlap).
    // Handles exact, reversed, and middle-name variations without false-positives.
    const THRESHOLD = 0.6;
    if (!bestId || bestScore < THRESHOLD) {
      console.log(`[formitize:leads] No lead match for "${customerName}" (best score=${bestScore.toFixed(2)})`);
      return;
    }

    const leadId = bestId;
    console.log(`[formitize:leads] Matched lead #${leadId} for "${customerName}" (score=${bestScore.toFixed(2)})`);

    const autoNote = `Auto-converted from Formitize application${formName ? ` (${formName})` : ""}.`;
    await pool.query(
      `UPDATE leads
       SET status               = 'converted',
           converted_at         = NOW(),
           converted_customer_id = $2,
           notes                = CASE
                                    WHEN notes IS NULL OR notes = '' THEN $3
                                    ELSE notes || ' ' || $3
                                  END,
           updated_at           = NOW()
       WHERE id = $1`,
      [leadId, customerId ?? null, autoNote]
    );
    console.log(`[formitize:leads] Auto-converted lead #${leadId} → ${customerName ?? customerPhone}`);
  } catch (err: any) {
    console.warn(`[formitize:leads] Auto-convert failed: ${err.message}`);
  }
}

// ─── Sync application/re-application to Wati contact list ────────────────────
// Pushes the customer's name + phone to Wati so the number is available for
// future WhatsApp broadcasts, templates, and campaigns.
// For re-applications the form phone is often the store's — we prefer the phone
// stored against the customer record in Central if a customerId is available.

async function upsertWatiContact(params: {
  customerName:  string | null;
  formPhone:     string | null;   // may be store phone for re-apps
  customerId:    number | null;
  product:       string | null;
  taskType:      string | null;
  branchName:    string | null;
}) {
  const WATI_URL   = (process.env.WATI_API_URL   ?? "").replace(/\/$/, "");
  const WATI_TOKEN = process.env.WATI_API_TOKEN  ?? "";
  if (!WATI_URL || !WATI_TOKEN || !params.customerName) return;

  // ── 1. Resolve best phone — prefer customer DB record ─────────────────────
  let rawPhone = params.formPhone;
  if (params.customerId) {
    try {
      const { rows } = await pool.query(
        `SELECT phone FROM customers WHERE id = $1 LIMIT 1`,
        [params.customerId]
      );
      if (rows[0]?.phone) rawPhone = rows[0].phone;
    } catch { /* fall back to form phone */ }
  }
  if (!rawPhone) return;

  // ── 2. Normalise to Wati international format (digits, Zimbabwe +263) ─────
  const digits = rawPhone.replace(/\D/g, "");
  let watiPhone: string;
  if (digits.length === 12 && digits.startsWith("263")) {
    watiPhone = digits;                        // already full international
  } else if (digits.length === 10 && digits.startsWith("0")) {
    watiPhone = "263" + digits.slice(1);       // 07xxxxxxxx → 2637xxxxxxxx
  } else if (digits.length === 9) {
    watiPhone = "263" + digits;                // 7xxxxxxxx  → 2637xxxxxxxx
  } else {
    console.warn(`[formitize:wati] Cannot normalise phone "${rawPhone}" — skipping`);
    return;
  }

  // ── 3. POST to Wati addContact ─────────────────────────────────────────────
  try {
    const body = {
      name: params.customerName,
      customParams: [
        { name: "product",  value: params.product   ?? "" },
        { name: "type",     value: params.taskType  ?? "" },
        { name: "branch",   value: params.branchName ?? "" },
      ],
    };

    const r = await fetch(`${WATI_URL}/api/v1/addContact/${watiPhone}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WATI_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (r.ok) {
      console.log(`[formitize:wati] Contact upserted — ${params.customerName} (${watiPhone})`);
    } else {
      const text = await r.text();
      console.warn(`[formitize:wati] addContact ${r.status}: ${text.slice(0, 200)}`);
    }
  } catch (err: any) {
    console.warn(`[formitize:wati] addContact error: ${err.message}`);
  }
}

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
  const rawFormName: string = body.formTitle || body.title || body.form_name || body.FormName || body.formName || "";
  // Tracking category — Formitize sends this as trackingCategory, tracking_category, or inside trackingCategories array
  const rawTrackingCategory: string = (
    body.trackingCategory ||
    body.tracking_category ||
    body.TrackingCategory ||
    (Array.isArray(body.trackingCategories) ? body.trackingCategories[0] : "") ||
    ""
  );
  console.log(`[formitize:webhook] Hit — form="${rawFormName}" trackingCategory="${rawTrackingCategory}" submittedFormID=${body.submittedFormID} jobID=${body.jobID}`);

  const formName = rawFormName.toLowerCase().trim();
  if (!formName) {
    res.status(400).json({ error: "No form name in payload" });
    return;
  }

  const { product, formType } = parseFormContext(formName, rawTrackingCategory);
  console.log(`[formitize:webhook] Detected — product="${product}" formType="${formType}"`);

  // ── Extract all field values from Formitize payload ────────────────────────
  // Handles both Simplified format ({ fieldName: { "0": "value" } })
  // and Full format ({ fieldName: { value: "...", label: "..." } })
  const fieldMap: Record<string, string> = {};
  function extractFields(obj: any) {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj)) {
      const node = obj[key];
      if (node === null || node === undefined) continue;

      if (typeof node !== "object") {
        if (String(node).trim()) fieldMap[key.toLowerCase()] = String(node).trim();
        continue;
      }

      const nodeKeys = Object.keys(node);
      // Simplified format: { fieldId: { "0": "value" } }
      if (nodeKeys.length === 1 && nodeKeys[0] === "0" && typeof node["0"] === "string" && node["0"].trim()) {
        fieldMap[key.toLowerCase()] = node["0"].trim();
        continue;
      }

      // Full format: { fieldId: { value: "...", name/label: "...", ... } }
      if (node.value !== undefined && node.value !== null && typeof node.value !== "object" && String(node.value).trim()) {
        const val = String(node.value).trim();
        const internalKey = key.toLowerCase();
        const resolvedKey = (node.name || node.label || key).toString().toLowerCase();

        // Always store under internal field ID — this is always unique and never collides
        fieldMap[internalKey] = val;
        // Store under human-readable label only if not already set (first-occurrence-wins
        // prevents "Cellphone Number" in the NOK section from overwriting the customer's)
        if (resolvedKey !== internalKey && !fieldMap[resolvedKey]) {
          fieldMap[resolvedKey] = val;
        }
      }

      if (node.children && typeof node.children === "object") extractFields(node.children);
      else extractFields(node);
    }
  }
  extractFields(body.content || {});

  const normalise = (s: string) => s.toLowerCase().replace(/[\s_\-]/g, "");
  const findField = (...needles: string[]): string | undefined => {
    for (const needle of needles) {
      const normNeedle = normalise(needle);
      for (const [label, value] of Object.entries(fieldMap)) {
        if (normalise(label).includes(normNeedle) && value) return value;
      }
    }
    return undefined;
  };

  console.log("[formitize:webhook] Fields:", JSON.stringify(fieldMap));

  // ── Activity-only form types (no agreement record needed) ──────────────────
  // Drawdowns, payments, uploads, approvals, undertakings are events against
  // existing agreements — store as activity log and return.
  // "unknown" also goes here: if we can't classify the form (e.g. expense claims,
  // survey forms) we must not create a spurious booking record.
  const activityOnly = ["drawdown", "payment", "upload", "approval", "undertaking", "unknown"];

  // ── Job ID dedup (agreement forms only) ────────────────────────────────────
  // Skip dedup for activity-only types — they legitimately share the same
  // jobID as the parent loan agreement (e.g. a document upload submitted
  // against the same Formitize job) and must not be silently rejected.
  const rawJobId = body.jobID || body.jobId || body.job_id || null;
  const jobId = (rawJobId && String(rawJobId) !== "0")
    ? String(rawJobId)
    : (body.submittedFormID ? String(body.submittedFormID) : null);

  if (jobId && !activityOnly.includes(formType)) {
    const existing = await db.select({ id: agreementsTable.id })
      .from(agreementsTable).where(eq(agreementsTable.formitizeJobId, jobId));
    if (existing.length > 0) {
      console.log(`[formitize:webhook] Duplicate jobId ${jobId} — skipped`);
      res.status(200).json({ ok: true, skipped: true, reason: "Already imported" });
      return;
    }
  }
  if (activityOnly.includes(formType)) {
    const customerName = findField(
      "formcrm_1", "borrowername", "clientname", "customername", "employeename",
      "applicantname", "applicant name",
      "fullname", "name",
      "formtext_3",  // Revolver activity forms: applicant name slot
      "formtext_1", "formtext_2"
    ) || rawFormName;

    // Extract payment amount for payment-type notifications
    let paymentAmount: number | null = null;
    if (formType === "payment") {
      const amtRaw = findField(
        "amount", "payment amount", "paid amount", "total paid", "totalamount",
        "paymentamount", "paidamount", "amountpaid", "amount paid", "receipt amount",
        "formcurrency_1", "formcurrency", "currency", "receiptamount"
      );
      if (amtRaw) {
        const parsed = parseFloat(amtRaw.replace(/[^0-9.]/g, ""));
        if (!isNaN(parsed) && parsed > 0) paymentAmount = parsed;
      }
    }

    // Extract branch and retailer for payment receipts
    // Payment receipt layout: formtext_1=customer, formtext_2=branch, "0"=retailer/product
    const branchName = findField(
      "branchname", "branch name", "branch", "storename", "store name", "store",
      "formtext_2"
    ) || null;
    const retailerName = findField(
      "retailername", "retailer name", "retailer", "dealername", "dealer",
      "formtext_3", "formtext_4"
    ) || fieldMap["0"] || null;

    // Best-effort customer ID lookup so the "View Profile" link works on activity notifications
    let activityCustomerId: number | null = null;
    if (customerName && customerName !== rawFormName) {
      try {
        // Search by name (case-insensitive), then by phone if available
        const nameHits = await db.select({ id: customersTable.id })
          .from(customersTable).where(ilike(customersTable.fullName, customerName));
        if (nameHits.length === 1) activityCustomerId = nameHits[0].id;
        if (!activityCustomerId) {
          const actPhone = findField(
            "applicanttelephone", "applicantphone", "applicantmobile",
            "mobile", "cell", "cellphone", "contactnumber", "formtel_2", "formtel_1"
          );
          if (actPhone) {
            const normActPhone = actPhone.replace(/\D/g, "");
            const phoneHit = await db.select({ id: customersTable.id })
              .from(customersTable).where(ilike(customersTable.phone, `%${normActPhone.slice(-9)}%`));
            if (phoneHit.length === 1) activityCustomerId = phoneHit[0].id;
          }
        }
      } catch { /* non-fatal */ }
    }

    await db.insert(activityTable).values({
      type: `formitize_${formType}`,
      description: `${rawFormName} received for ${customerName}`,
      loanProduct: product,
      referenceId: jobId ? parseInt(jobId) || null : null,
    });

    // Document uploads: extract file URLs (numeric keys) and save to customer's latest agreement
    if (formType === "upload" && activityCustomerId) {
      try {
        // Numeric keys like "0", "1", "2"... are file attachment URLs
        const docs: Array<{ url: string; name: string }> = [];
        for (const [key, val] of Object.entries(fieldMap)) {
          if (/^\d+$/.test(key) && typeof val === "string" && val.startsWith("http")) {
            // Derive a display name from the URL filename
            const urlName = val.split("/").pop()?.split("?")[0] || `file_${key}`;
            docs.push({ url: val, name: urlName });
          }
        }
        if (docs.length > 0) {
          // Find the customer's most recent agreement
          const [latestAgreement] = await db
            .select({ id: agreementsTable.id, existing: agreementsTable.signedDocuments })
            .from(agreementsTable)
            .where(eq(agreementsTable.customerId, activityCustomerId))
            .orderBy(desc(agreementsTable.createdAt))
            .limit(1);
          if (latestAgreement) {
            const existing: Array<{ url: string; name: string }> = (latestAgreement.existing as any) ?? [];
            const merged = [
              ...existing,
              ...docs.filter(d => !existing.some((e: { url: string }) => e.url === d.url)),
            ];
            await db.update(agreementsTable)
              .set({ signedDocuments: merged })
              .where(eq(agreementsTable.id, latestAgreement.id));
            console.log(`[formitize:webhook] Saved ${docs.length} signed doc(s) to agreement #${latestAgreement.id}`);
          }
        }
      } catch (err) {
        console.error("[formitize:webhook] Failed to save signed documents:", err);
      }
    }

    // Document uploads appear in Activity queue so staff can review and action them.
    const notifStatus = "new";

    // Delinquency check — flag if the applicant is a known delinquent customer
    const delinquentNamesActivity = await fetchDelinquentNames();
    const delinqMatchActivity     = checkDelinquent(customerName, delinquentNamesActivity);
    if (delinqMatchActivity) {
      console.warn(`[delinquency] MATCH on form "${rawFormName}" — customer "${customerName}" matches delinquent record "${delinqMatchActivity}"`);
    }

    await upsertNotification({
      jobId, formName: rawFormName, taskType: formType, product, customerName,
      customerId: activityCustomerId, paymentAmount, branchName, retailerName, status: notifStatus,
      isDelinquentWarning: !!delinqMatchActivity,
      delinquentMatch: delinqMatchActivity ? `Applicant: ${delinqMatchActivity}` : null,
    });

    console.log(`[formitize:webhook] Stored as activity (status=${notifStatus}) — ${rawFormName}`);
    res.status(200).json({ ok: true, stored: "activity", product, formType });
    return;
  }

  // ── Agreement and Application forms — create a record ─────────────────────
  // "New Customer Application" forms use a different field layout:
  //   formtext_1 = store/branch name
  //   formtext_2 = store MANAGER name (NOT the customer)
  //   formtext_6 = actual borrower/customer name
  // All other forms use the standard layout where named semantic fields come first.
  const isNewCustomerForm = formName.includes("new customer");
  const isReApplication   = formType === "reapplication";

  // Extract customer identity fields (broad search across all product field names)
  //
  // HukuPlus New Customer Application layout:
  //   formRadio_3 = Retail Company (retailer)
  //   formText_1  = Store Branch
  //   formText_6  = Full Name and Surname (customer)
  //   formDate_2  = Expected Date of Stock Collection
  //
  // HukuPlus Re-Application layout:
  //   formRadio_4 = Retailer
  //   formText_3  = Branch
  //   formText_1  = Customer Name
  //   formDate_3  = Collection Date
  //
  // HukuPlus Loan Agreement layout:
  //   formcrm_1  = the BORROWER selected from the Formitize CRM lookup
  //   formtext_3 = branch staff member (NOT the customer)
  //   formtext_4 = same staff name repeated
  //   borrowerid = borrower's national ID card number
  const isHukuPlusAgreement = product === "HukuPlus" && formType === "agreement" && !isNewCustomerForm;

  const customerName = isNewCustomerForm
    ? (findField(
        "formtext_6",              // New Customer Application: Full Name and Surname
        "formcrm_1", "borrowername", "clientname", "customername",
        "fullname", "full name", "name"
      ) || findField("formtext_2"))
    : isReApplication
    ? findField(
        "formtext_1",              // Re-Application: Customer Name
        "formcrm_1", "borrowername", "clientname", "customername",
        "fullname", "full name", "name"
      )
    : findField(
        "formcrm_1", "borrowername", "clientname", "customername",
        "employeename", "employee name", "debtorname", "debtor name",
        "applicantname", "applicant name", "revolverName",
        "fullname", "full name", "name",
        "formtext_1", "formtext_2", "formtext_3"
        // NOTE: borrowerid deliberately excluded — it contains the national ID number, not a name
      );

  if (!customerName) {
    console.log(`[formitize:webhook] Missing customer name. Fields: ${Object.keys(fieldMap).join(", ")}`);
    res.status(400).json({ error: "Missing customer name", availableFields: Object.keys(fieldMap) });
    return;
  }

  // Phone — "Applicant Telephone Number" (Revolver: formTel_2) must come BEFORE generic
  // "phonenumber" because "Store Telephone Number" (formTel_1) also contains "phonenumber"
  // and would otherwise shadow the applicant's number.
  const customerPhone = findField(
    "applicanttelephone", "applicantphone", "applicantmobile",
    "borrowermobile", "employeemobile", "mobile",
    "cell", "cellphone", "contact number", "contactnumber",
    "formtel_2",  // Revolver applicant phone (before formtel_1 which is store phone)
    "phone", "phonenumber",
    "formtel_1"   // fallback: store phone (or only phone on some forms)
  ) || null;

  // National ID — label-based first, then form-specific internal IDs as fallback.
  // formtext_4 deliberately NOT listed here: in ChikweretiOne it's the customer's cellphone.
  // Revolver's "Applicant ID" is caught by the "applicantid" label needle.
  // borrowerid = HukuPlus Loan Agreement field containing the borrower's national ID card number.
  const nationalIdRaw = findField(
    "applicantid", "applicant id",
    "nationalid", "national_id", "idnumber", "id number", "national id",
    "employeeid", "employee id", "debtornid", "nid",
    "borrowerid",  // HukuPlus Loan Agreement: borrower's national ID card
    "formtext_7"   // HukuPlus new-customer form slot
  ) || null;

  // Email — "Applicant Email" (formEmail_2) must come BEFORE generic "email"/"formemail_1"
  // because "Store Email" (formEmail_1) also matches "email" and would shadow the applicant.
  const isNa = (v: string | undefined) =>
    !v || ["na", "n/a", "none", "nil", "-"].includes(v.toLowerCase().trim());
  const customerEmailRaw = findField(
    "applicantemail", "applicant email",
    "borroweremail", "employeeemail",
    "formemail_2",  // Revolver applicant email (before formemail_1 which is store email)
    "email", "emailaddress", "email address",
    "formemail_1"   // fallback: store email
  );
  const customerEmail = isNa(customerEmailRaw) ? null : (customerEmailRaw || null);

  // Address — "Applicant Address" (Revolver) first, then generic; formlocation_1 = new-customer
  const customerAddressRaw = findField(
    "applicantaddress", "applicant address",
    "address", "homeaddress", "home address", "residentialaddress",
    "residential address", "formlocation_1"
  );
  const customerAddress = isNa(customerAddressRaw) ? null : (customerAddressRaw || null);

  // Amount may be in standard named fields OR in formtext_1/formtext_2 as "$620.00"
  const stripCurrency = (s: string) => s.replace(/[$,ZW\s]/g, "").trim();
  const loanAmountRaw = findField(
    "loanamount", "loan amount", "creditlimit", "credit limit",
    "revolveramount", "revolver amount", "deductionamount", "deduction amount", "amount"
  ) || stripCurrency(fieldMap["formtext_1"] || "") || stripCurrency(fieldMap["formtext_2"] || "");
  const loanAmount = parseFloat(stripCurrency(loanAmountRaw || "") || "0");

  // Disbursement / collection date — form-specific field IDs take priority.
  // New Customer Application : formDate_2 = "Expected Date of Stock Collection"
  // Re-Application           : formDate_3 = "Collection Date"
  // All other forms          : standard Novafeeds field names
  const disbursementDate = (
    isNewCustomerForm
      ? findField(
          "formdate_2",
          "collectiondate", "collection date", "stockcollectiondate",
          "applieddisbursement", "disbursementdate", "disbursement date"
        )
      : isReApplication
      ? findField(
          "formdate_3",            // Re-Application: Collection Date
          "collectiondate", "collection date", "stockcollectiondate",
          "applieddisbursement", "disbursementdate", "disbursement date"
        )
      : findField("applieddisbursement", "disbursementdate", "disbursement date", "disbursement")
  ) || null;
  const repaymentDate    = findField("appliedsettlement", "settlementdate", "settlement date", "repaymentdate", "repayment date") || null;
  const repaymentAmountRaw = findField("weeklyrepayment", "monthly repayment", "repaymentamount", "repayment amount", "installment") || null;
  const repaymentAmount = repaymentAmountRaw ? parseFloat(stripCurrency(repaymentAmountRaw)) : null;

  // ── Retailer / branch resolution (product-specific) ────────────────────────
  let retailerId: number | null = null;
  let branchId: number | null = null;
  let resolvedRetailerName = "";
  let resolvedBranchName = "";

  if (product === "HukuPlus" && isNewCustomerForm) {
    // "New Customer Application"
    // formRadio_3 = Retail Company (direct retailer name — most reliable signal)
    // formText_1  = Store Branch name
    // formText_3  = Store email (domain used to narrow retailer as fallback)
    const explicitRetailerRaw = (fieldMap["formradio_3"] || "").trim();
    const storeName = (fieldMap["formtext_1"] || "").trim();
    const newCustStoreEmail = (fieldMap["formtext_3"] || "").trim();

    if (explicitRetailerRaw || storeName) {
      const allRetailers = await db.select().from(retailersTable);
      const allBranches = await db.select().from(branchesTable);

      // ── Step 0: match retailer directly from formRadio_3 ──────────────────
      if (explicitRetailerRaw && !retailerId) {
        const normExplicit = explicitRetailerRaw.toLowerCase();
        const directRetailer = allRetailers.find(r =>
          r.name.toLowerCase().includes(normExplicit) ||
          normExplicit.includes(r.name.toLowerCase())
        );
        if (directRetailer) {
          retailerId = directRetailer.id;
          resolvedRetailerName = directRetailer.name;
          console.log(`[formitize] New-cust: retailer matched via formRadio_3 "${explicitRetailerRaw}" → "${directRetailer.name}"`);
        }
      }

      // Strip generic noise words so "Chivhu branch" → ["chivhu"]
      const NC_NOISE = new Set(["branch", "store", "shop", "main", "outlet", "centre", "center", "unit", "site", "head"]);
      const searchWords = storeName.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !NC_NOISE.has(w));

      // Edit-distance-1 helper (same as the other HukuPlus path)
      const editDist1 = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (Math.abs(a.length - b.length) > 1) return false;
        if (a.length === b.length) {
          let diffs = 0;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
          return diffs <= 1;
        }
        const [long, short] = a.length > b.length ? [a, b] : [b, a];
        for (let i = 0; i < long.length; i++) {
          if (long.slice(0, i) + long.slice(i + 1) === short) return true;
        }
        return false;
      };

      // Narrow branch candidates:
      // 1) If we already resolved a retailer from formRadio_3, restrict to that retailer's branches
      // 2) Otherwise fall back to email-domain narrowing
      let candidates = allBranches;
      if (retailerId) {
        const narrowed = allBranches.filter(b => b.retailerId === retailerId);
        if (narrowed.length > 0) candidates = narrowed;
      } else if (newCustStoreEmail.includes("@")) {
        const emailDomain = newCustStoreEmail.split("@")[1] ?? "";
        const retailerHintNC = emailDomain.split(".")[0]?.toLowerCase() ?? "";
        if (retailerHintNC.length > 2) {
          const hintRetailers = allRetailers.filter(r => r.name.toLowerCase().includes(retailerHintNC));
          if (hintRetailers.length === 1) {
            const narrowed = allBranches.filter(b => b.retailerId === hintRetailers[0].id);
            if (narrowed.length > 0) {
              candidates = narrowed;
              console.log(`[formitize] New-cust: retailer narrowed via email domain "${retailerHintNC}" → ${hintRetailers[0].name}`);
            }
          }
        }
      }

      // 1. Exact name match
      let matchedBranch = candidates.find(b => b.name.toLowerCase() === storeName.toLowerCase());

      // 2. Word-scored match (after noise-word stripping)
      if (!matchedBranch && searchWords.length > 0) {
        const scored = candidates.map(b => {
          const bn = b.name.toLowerCase();
          const score = searchWords.filter(w => bn.includes(w)).reduce((s, w) => s + w.length, 0);
          return { branch: b, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        if (scored.length > 0) matchedBranch = scored[0].branch;
      }

      // 3. Edit-distance-1 fuzzy fallback
      if (!matchedBranch && searchWords.length > 0) {
        const fuzzy = candidates.map(b => {
          const branchWords = b.name.toLowerCase().split(/\s+/);
          const score = searchWords.reduce((s, sw) => s + (branchWords.some(bw => editDist1(sw, bw)) ? sw.length : 0), 0);
          return { branch: b, score };
        }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
        if (fuzzy.length > 0) {
          matchedBranch = fuzzy[0].branch;
          console.log(`[formitize] New-cust: fuzzy-matched "${storeName}" → "${matchedBranch.name}" (edit-distance-1)`);
        }
      }

      if (matchedBranch) {
        branchId = matchedBranch.id;
        resolvedBranchName = matchedBranch.name;
        const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, matchedBranch.retailerId));
        if (retailer) { retailerId = retailer.id; resolvedRetailerName = retailer.name; }
      } else if (searchWords.length > 0) {
        // Last resort: match retailer name directly from the first meaningful word
        const [retailer] = await db.select().from(retailersTable).where(ilike(retailersTable.name, `%${searchWords[0]}%`));
        if (retailer) {
          retailerId = retailer.id;
          resolvedRetailerName = retailer.name;
          const [firstBranch] = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, retailer.id));
          if (firstBranch) { branchId = firstBranch.id; resolvedBranchName = firstBranch.name; }
        }
      }
    }
  } else if (isReApplication) {
    // Re-Application form
    // formRadio_4 = Retailer (direct name — most reliable)
    // formText_3  = Branch name
    const reAppRetailerRaw = (fieldMap["formradio_4"] || "").trim();
    const reAppBranchRaw   = (fieldMap["formtext_3"]  || "").trim();

    if (reAppRetailerRaw || reAppBranchRaw) {
      const allRetailers = await db.select().from(retailersTable);
      const allBranches  = await db.select().from(branchesTable);

      // Step 1: match retailer directly from formRadio_4
      if (reAppRetailerRaw) {
        const normR = reAppRetailerRaw.toLowerCase();
        const matched = allRetailers.find(r =>
          r.name.toLowerCase().includes(normR) || normR.includes(r.name.toLowerCase())
        );
        if (matched) {
          retailerId = matched.id;
          resolvedRetailerName = matched.name;
          console.log(`[formitize] Re-App: retailer matched via formRadio_4 "${reAppRetailerRaw}" → "${matched.name}"`);
        }
      }

      // Step 2: match branch from formText_3, narrowed to resolved retailer's branches if known
      if (reAppBranchRaw) {
        const candidates = retailerId
          ? allBranches.filter(b => b.retailerId === retailerId)
          : allBranches;
        const normB = reAppBranchRaw.toLowerCase();
        const RA_NOISE = new Set(["branch", "store", "shop", "main", "outlet", "centre", "center"]);
        const searchWords = normB.split(/\s+/).filter(w => w.length > 2 && !RA_NOISE.has(w));

        let matchedBranch = candidates.find(b => b.name.toLowerCase() === normB);
        if (!matchedBranch && searchWords.length > 0) {
          const scored = candidates.map(b => {
            const bn = b.name.toLowerCase();
            const score = searchWords.filter(w => bn.includes(w)).reduce((s, w) => s + w.length, 0);
            return { branch: b, score };
          }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
          if (scored.length > 0) matchedBranch = scored[0].branch;
        }

        if (matchedBranch) {
          branchId = matchedBranch.id;
          resolvedBranchName = matchedBranch.name;
          if (!retailerId) {
            const [r] = await db.select().from(retailersTable).where(eq(retailersTable.id, matchedBranch.retailerId));
            if (r) { retailerId = r.id; resolvedRetailerName = r.name; }
          }
          console.log(`[formitize] Re-App: branch matched "${reAppBranchRaw}" → "${matchedBranch.name}"`);
        }
      }
    }
  } else if (product === "HukuPlus") {
    // Standard HukuPlus agreement — formtext_5 is the store/branch name (e.g. "Lupane").
    // The store email (storeemail_1 / sendemail) can identify the retailer from its domain
    // (e.g. "lupane@profeeds.co.zw" → retailer "profeeds").
    // Search ALL retailers' branches for the correct match; fall back to Novafeeds if nothing found.
    // formtext_3 is used by the re-application form for store name; formtext_5 for standard agreements
    // formtext_1 is used by the New Customer Application form for store/branch name
    const storeBranchName = findField(
      "formtext_5", "formtext_3", "storebranch", "store branch", "branchname",
      "storebranch", "formtext_1"
    );

    // Direct retailer name from form — most reliable signal (e.g. "Retail Company: Profeeds")
    const explicitRetailerFromForm = findField(
      "retailcompany", "retail company", "retailercompany", "retailer company",
      "retailchain", "retail chain", "feedcompany", "feed company",
      "storechain", "store chain", "company"
    );

    // Extract retailer hint from store email — field name differs between form types:
    // storeemail_1 / sendemail (standard), sendmail / formemail_1 (re-application)
    // Also try generic "store email" / "storeemail" variants used by some forms
    const storeEmailRaw = (
      fieldMap["storeemail_1"] || fieldMap["sendemail"] ||
      fieldMap["sendmail"]     || fieldMap["formemail_1"] ||
      findField("storeemail", "store email", "storemail", "shopmail", "retaileremail") || ""
    ).trim();
    const emailDomain = storeEmailRaw.includes("@") ? storeEmailRaw.split("@")[1] : "";
    const retailerHint = emailDomain.split(".")[0]?.toLowerCase() || ""; // e.g. "profeeds" from "lupane@profeeds.co.zw"

    const fallbackToNovafeeds = async () => {
      const [nf] = await db.select().from(retailersTable).where(ilike(retailersTable.name, "%novafeed%"));
      if (nf) {
        retailerId = nf.id; resolvedRetailerName = nf.name;
        const branches = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, nf.id));
        if (branches[0]) { branchId = branches[0].id; resolvedBranchName = branches[0].name; }
      }
    };

    if (storeBranchName) {
      const allBranches = await db.select().from(branchesTable);
      // Strip generic noise words that appear in raw form values but never in branch names
      const NOISE_WORDS = new Set(["branch", "store", "shop", "main", "outlet", "centre", "center", "unit", "site", "head"]);
      const searchWords = storeBranchName.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !NOISE_WORDS.has(w));

      // Edit-distance-1 helper: handles single-character typos ("chivhu" ≈ "chivu")
      const editDist1 = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (Math.abs(a.length - b.length) > 1) return false;
        if (a.length === b.length) {
          let diffs = 0;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
          return diffs <= 1;
        }
        const [long, short] = a.length > b.length ? [a, b] : [b, a];
        for (let i = 0; i < long.length; i++) {
          if (long.slice(0, i) + long.slice(i + 1) === short) return true;
        }
        return false;
      };

      // Narrow candidates — priority order:
      // 1. Explicit "Retail Company" field from the form (most reliable)
      // 2. Retailer hint from store email domain
      // 3. All branches (widest search, highest risk of ambiguous match)
      let candidates = allBranches;

      if (explicitRetailerFromForm && explicitRetailerFromForm.length > 2) {
        const explicitRetailers = await db.select().from(retailersTable)
          .where(ilike(retailersTable.name, `%${explicitRetailerFromForm}%`));
        if (explicitRetailers.length === 1) {
          const narrowed = allBranches.filter(b => b.retailerId === explicitRetailers[0].id);
          if (narrowed.length > 0) {
            candidates = narrowed;
            console.log(`[formitize] Retailer narrowed via explicit form field "${explicitRetailerFromForm}" → ${explicitRetailers[0].name}`);
          }
        }
      } else if (retailerHint.length > 2) {
        // Narrow candidates by retailer hint from email domain (reduces false matches)
        const hintRetailers = await db.select().from(retailersTable)
          .where(ilike(retailersTable.name, `%${retailerHint}%`));
        if (hintRetailers.length === 1) {
          const narrowed = allBranches.filter(b => b.retailerId === hintRetailers[0].id);
          if (narrowed.length > 0) candidates = narrowed;
        }
      }

      // Fold repeated consecutive chars for fuzzy match: "blufhill" ≈ "bluff hill"
      const fold = (s: string) => s.toLowerCase().replace(/\s+/g, "").replace(/(.)\1+/g, "$1");

      // Exact → scored word-contains → fold-normalized match
      // Scoring: prefer branches that match MORE words AND longer/more-distinctive words.
      // "Kwekwe Main" should match "Kwekwe" (7-char word) over "Main Branch" (4-char "main" only).
      let matched = candidates.find(b => b.name.toLowerCase() === storeBranchName.toLowerCase());

      if (!matched && searchWords.length > 0) {
        // Score each candidate: sum of lengths of all matched search words
        const scored = candidates.map(b => {
          const bn = b.name.toLowerCase();
          const matchedWords = searchWords.filter(w => bn.includes(w));
          const score = matchedWords.reduce((sum, w) => sum + w.length, 0);
          return { branch: b, score };
        }).filter(x => x.score > 0);

        if (scored.length > 0) {
          scored.sort((a, b) => b.score - a.score);
          matched = scored[0].branch;
          if (scored.length > 1 && scored[0].score === scored[1].score) {
            // Tie-break: prefer the candidate whose name is most similar in length to the search term
            const tiedCandidates = scored.filter(x => x.score === scored[0].score);
            const searchLen = storeBranchName.length;
            tiedCandidates.sort((a, b) =>
              Math.abs(a.branch.name.length - searchLen) - Math.abs(b.branch.name.length - searchLen)
            );
            matched = tiedCandidates[0].branch;
          }
        }
      }

      if (!matched && searchWords.length > 0) {
        // Fold-normalised fallback (handles "blufhill" ≈ "bluff hill" etc.)
        const foldScored = candidates.map(b => {
          const foldedBranch = fold(b.name);
          const matchedWords = searchWords.filter(w => foldedBranch.includes(fold(w)) || fold(w).includes(foldedBranch));
          const score = matchedWords.reduce((sum, w) => sum + w.length, 0);
          return { branch: b, score };
        }).filter(x => x.score > 0);

        if (foldScored.length > 0) {
          foldScored.sort((a, b) => b.score - a.score);
          matched = foldScored[0].branch;
        }
      }

      // Edit-distance-1 fuzzy fallback — catches single-char typos/extra chars
      // e.g. "chivhu" in the form vs "chivu" in the DB
      if (!matched && searchWords.length > 0) {
        const fuzzyScored = candidates.map(b => {
          const branchWords = b.name.toLowerCase().split(/\s+/);
          const score = searchWords.reduce((sum, sw) => {
            const hit = branchWords.some(bw => editDist1(sw, bw));
            return sum + (hit ? sw.length : 0);
          }, 0);
          return { branch: b, score };
        }).filter(x => x.score > 0);
        if (fuzzyScored.length > 0) {
          fuzzyScored.sort((a, b) => b.score - a.score);
          matched = fuzzyScored[0].branch;
          console.log(`[formitize] Fuzzy-matched branch "${storeBranchName}" → "${matched.name}" (edit-distance-1)`);
        }
      }

      if (matched) {
        branchId = matched.id;
        resolvedBranchName = matched.name;
        const [ret] = await db.select().from(retailersTable).where(eq(retailersTable.id, matched.retailerId));
        if (ret) { retailerId = ret.id; resolvedRetailerName = ret.name; }
      } else {
        await fallbackToNovafeeds();
      }
    } else if (retailerHint.length > 2) {
      // No branch name but retailer identifiable from store email
      const [ret] = await db.select().from(retailersTable).where(ilike(retailersTable.name, `%${retailerHint}%`));
      if (ret) {
        retailerId = ret.id; resolvedRetailerName = ret.name;
        const branches = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, ret.id));
        if (branches[0]) { branchId = branches[0].id; resolvedBranchName = branches[0].name; }
      } else {
        await fallbackToNovafeeds();
      }
    } else {
      // Last resort: check if customer email looks like a store email
      // (e.g. chivu@profeeds.co.zw → retailer "profeeds", branch "chivu")
      const custEmail = (customerEmailRaw || "").trim();
      if (custEmail.includes("@")) {
        const custDomain    = custEmail.split("@")[1] ?? "";
        const custRetHint   = custDomain.split(".")[0]?.toLowerCase() ?? "";
        const custBranchHint = custEmail.split("@")[0]?.toLowerCase() ?? "";
        if (custRetHint.length > 2) {
          const hintRetailers = await db.select().from(retailersTable)
            .where(ilike(retailersTable.name, `%${custRetHint}%`));
          if (hintRetailers.length === 1) {
            const branches = await db.select().from(branchesTable)
              .where(eq(branchesTable.retailerId, hintRetailers[0].id));
            // Try to match branch by local-part of email (e.g. "chivu")
            const branchMatch = branches.find(b => b.name.toLowerCase() === custBranchHint)
              ?? branches.find(b => b.name.toLowerCase().includes(custBranchHint) || custBranchHint.includes(b.name.toLowerCase()));
            const chosenBranch = branchMatch ?? branches[0];
            if (chosenBranch) {
              branchId          = chosenBranch.id;
              resolvedBranchName = chosenBranch.name;
              retailerId        = hintRetailers[0].id;
              resolvedRetailerName = hintRetailers[0].name;
            } else { await fallbackToNovafeeds(); }
          } else { await fallbackToNovafeeds(); }
        } else { await fallbackToNovafeeds(); }
      } else {
        await fallbackToNovafeeds();
      }
    }
  } else if (product === "Revolver") {
    // Revolver → look for store name in form; search synced Revolver retailers
    const storeName = findField("storename", "store name", "store", "branch", "branchname", "formtext_5");
    if (storeName) {
      const [retailer] = await db.select().from(retailersTable).where(ilike(retailersTable.name, `%${storeName}%`));
      if (retailer) {
        retailerId = retailer.id;
        resolvedRetailerName = retailer.name;
        const allBranches = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, retailer.id));
        if (allBranches[0]) { branchId = allBranches[0].id; resolvedBranchName = allBranches[0].name; }
      }
    }
  }
  // ChikweretiOne: no retailer/branch — employer details live in form_data

  // ── Find or create unified customer record ─────────────────────────────────
  const normalisePhone = (p: string) => {
    if (!p) return null;
    let s = p.replace(/[\s\-\(\)\.]/g, "");
    if (s.startsWith("+")) return s || null;
    if (s.startsWith("263") && s.length >= 12) return "+" + s;
    if (s.startsWith("0")) return "+263" + s.slice(1);
    if (/^7[0-9]{8}$/.test(s)) return "+263" + s;
    return s || null;
  };
  const normPhone = normalisePhone(customerPhone || "");

  let formitizeCrmId: string | null = null;
  for (const key of Object.keys(body.content || {})) {
    if (key.toLowerCase().startsWith("formcrm")) {
      const node = (body.content as any)[key];
      if (node && typeof node === "object") {
        const crmid = node.crmid || node.id || node.contactId || node.contact_id || node.crm_id;
        if (crmid) { formitizeCrmId = String(crmid); break; }
      }
    }
  }

  // ── Extract extended customer profile fields ──────────────────────────────
  const isNaVal = (v: string | null | undefined) =>
    !v || ["na", "n/a", "none", "nil", "-", "not applicable"].includes(v.toLowerCase().trim());

  const strOrNull = (v: string | undefined) => (!v || isNaVal(v)) ? null : v;

  const gender         = strOrNull(findField("applicantgender", "gender"));
  const dateOfBirth    = strOrNull(findField("applicantdateofbirth", "dateofbirth", "date of birth", "dob"));
  const maritalStatus  = strOrNull(findField("maritalstatus", "marital status"));
  const isEmployed     = strOrNull(findField("areyouemployed", "employed", "earnsalary"));
  // "employercompany" catches ChikweretiOne's "Employer Company" field specifically
  const employerName   = strOrNull(findField("employercompany", "nameofemployer", "employername", "employer", "placeofwork"));
  // Extension Officer = the store employee/manager who dealt with the customer at the branch.
  // For HukuPlus Loan Agreements: formtext_3/4 holds the branch staff member's name.
  // For all other forms: use standard named fields ("nameofsalesrepresentative" etc.).
  // NOTE: "Sales Rep" is reserved for a future Marishoma internal rep role — not captured here.
  const extensionOfficerName = strOrNull(
    findField("nameofsalesrepresentative", "salesrepresentative", "salesrep", "salesrepname",
              "extensionofficer", "extension officer", "fieldofficer", "field officer") ||
    (isHukuPlusAgreement ? (findField("formtext_3") || findField("formtext_4")) : "")
  );
  const retailerRef    = strOrNull(findField("retailerreferencenumber", "retailerreference", "referencenumber", "retailerref"));
  const marketType     = strOrNull(findField("wheredoesthecustomersell", "sellchickens", "markettype", "sellbirds"));

  // Next-of-Kin — now that extractFields stores under internal field IDs too, we can use
  // formtext_5 (NOK name, same slot in Revolver + ChikweretiOne),
  // formtext_6 (NOK ID/Passport, same slot in Revolver + ChikweretiOne),
  // formtext_8 (NOK cellphone in ChikweretiOne, unique to that form).
  // Label-based needles (nextofkinname, etc.) are tried first; internal IDs are fallbacks.
  const nokName         = strOrNull(findField(
    "nextofkinfullname", "nextofkinname", "nextofkinnamesurname",
    "nokname", "nokfullname", "kinname",
    "formtext_5"  // Revolver + ChikweretiOne NOK name slot
  ));
  const nokRelationship = strOrNull(findField(
    "relationshiptoborrower", "relationshiptoaccount",
    "nokrelationship", "relationship", "kinrelationship",
    "formtext_7"  // ChikweretiOne: plain text field for relationship
  ));
  const nokNationalId   = strOrNull(findField(
    "nextofkinid", "nextofkinpassport", "nokid", "nokpassport", "kinid",
    "formtext_6"  // Revolver + ChikweretiOne NOK ID slot
  ));
  // "nextofkintelephone" catches Revolver's "Next-of-Kin Telephone Number";
  // "formtext_8" catches ChikweretiOne's NOK "Cellphone Number" by internal ID
  // (label-based search would return customer's cellphone due to first-wins).
  const nokPhone        = strOrNull(findField(
    "nextofkintelephone", "nextofkinmobile",
    "nokmobile", "nokphone", "kinmobile", "nextofkinphone",
    "formtext_8"  // ChikweretiOne NOK cellphone (internal ID — unique to NOK section)
  ));
  const nokEmail        = strOrNull(findField("nextofkinemail", "nokemail", "kinemail", "nextofkinemail"));
  const nokAddress      = strOrNull(findField("nextofkinaddress", "nokaddress", "kinaddress"));

  let customerId: number | null = null;
  if (formitizeCrmId) {
    const [hit] = await db.select({ id: customersTable.id })
      .from(customersTable).where(eq(customersTable.formitizeCrmId, formitizeCrmId));
    if (hit) customerId = hit.id;
  }
  if (!customerId && normPhone) {
    const [hit] = await db.select({ id: customersTable.id, fullName: customersTable.fullName })
      .from(customersTable).where(eq(customersTable.phone, normPhone));
    if (hit) {
      // Require at least one meaningful word in common to avoid mis-linking
      // (e.g. "Onias Chirambwi" vs "Clement Nherera" share no words — skip).
      const hitWords   = (hit.fullName ?? "").toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const formWords  = customerName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const nameMatch  = hitWords.some(w => formWords.includes(w));
      if (nameMatch) {
        customerId = hit.id;
      } else {
        console.warn(`[formitize:webhook] Phone ${normPhone} matches customer "${hit.fullName}" but form name is "${customerName}" — skipping phone match to avoid mis-link`);
      }
    }
  }
  if (!customerId && nationalIdRaw) {
    const [hit] = await db.select({ id: customersTable.id })
      .from(customersTable).where(eq(customersTable.nationalId, nationalIdRaw));
    if (hit) customerId = hit.id;
  }
  if (!customerId) {
    const allByName = await db.select({ id: customersTable.id })
      .from(customersTable).where(ilike(customersTable.fullName, customerName));
    if (allByName.length === 1) customerId = allByName[0].id;
  }

  const extendedFields = {
    ...(normPhone        ? { phone:             normPhone        } : {}),
    ...(nationalIdRaw    ? { nationalId:         nationalIdRaw    } : {}),
    ...(customerEmail    ? { email:              customerEmail    } : {}),
    ...(customerAddress  ? { address:            customerAddress  } : {}),
    ...(formitizeCrmId   ? { formitizeCrmId:     formitizeCrmId   } : {}),
    ...(gender           ? { gender                               } : {}),
    ...(dateOfBirth      ? { dateOfBirth                         } : {}),
    ...(maritalStatus    ? { maritalStatus                        } : {}),
    ...(isEmployed       ? { isEmployed                          } : {}),
    ...(employerName     ? { employerName                        } : {}),
    ...(extensionOfficerName ? { extensionOfficer: extensionOfficerName } : {}),
    ...(retailerRef      ? { retailerReference: retailerRef       } : {}),
    ...(marketType       ? { marketType                          } : {}),
    ...(nokName          ? { nokName                             } : {}),
    ...(nokRelationship  ? { nokRelationship                     } : {}),
    ...(nokNationalId    ? { nokNationalId                       } : {}),
    ...(nokPhone         ? { nokPhone                            } : {}),
    ...(nokEmail         ? { nokEmail                            } : {}),
    ...(nokAddress       ? { nokAddress                          } : {}),
    ...(product          ? { loanProduct: product                 } : {}),
    rawApplicationData: fieldMap as any,
  };

  if (!customerId) {
    const [newCustomer] = await db.insert(customersTable).values({
      fullName: customerName,
      ...extendedFields,
    }).returning({ id: customersTable.id });
    customerId = newCustomer.id;
    console.log(`[formitize:webhook] Created customer #${customerId} for "${customerName}"`);
  } else {
    // Enrich existing customer record — COALESCE so we never overwrite real data with nulls
    const colMap: Record<string, string> = {
      phone: normPhone || "", national_id: nationalIdRaw || "", email: customerEmail || "",
      address: customerAddress || "", formitize_crm_id: formitizeCrmId || "",
      gender: gender || "", date_of_birth: dateOfBirth || "", marital_status: maritalStatus || "",
      is_employed: isEmployed || "", employer_name: employerName || "",
      extension_officer: extensionOfficerName || "", retailer_reference: retailerRef || "",
      market_type: marketType || "", nok_name: nokName || "", nok_relationship: nokRelationship || "",
      nok_national_id: nokNationalId || "", nok_phone: nokPhone || "", nok_email: nokEmail || "",
      nok_address: nokAddress || "", loan_product: product || "",
    };
    const entries = Object.entries(colMap).filter(([, v]) => v !== "");
    if (entries.length > 0) {
      const setClauses = entries.map(([k], i) => `${k} = COALESCE(${k}, $${i + 2})`).join(", ");
      await pool.query(
        `UPDATE customers SET ${setClauses}, raw_application_data = COALESCE(raw_application_data, $${entries.length + 2}::jsonb), updated_at = NOW() WHERE id = $1`,
        [customerId, ...entries.map(([, v]) => v), JSON.stringify(fieldMap)]
      );
    }
    // Backfill home store (retailer_id / branch_id) onto the customer record using COALESCE
    // so a manually-corrected store is never overwritten by an incoming webhook
    if (retailerId || branchId) {
      await pool.query(
        `UPDATE customers
         SET retailer_id = COALESCE(retailer_id, $2),
             branch_id   = COALESCE(branch_id, $3),
             updated_at  = NOW()
         WHERE id = $1`,
        [customerId, retailerId ?? null, branchId ?? null]
      );
    }
    console.log(`[formitize:webhook] Enriched customer #${customerId} for "${customerName}"`);
  }

  // ── Attempt Xero contact auto-link (best-effort, non-blocking) ─────────────
  // Only try if the customer doesn't already have a Xero contact linked
  try {
    const existing = await db.select({ xeroContactId: customersTable.xeroContactId })
      .from(customersTable).where(eq(customersTable.id, customerId!));
    if (existing[0] && !existing[0].xeroContactId) {
      const tokenRow = await pool.query("SELECT access_token, refresh_token, tenant_id, expires_at FROM xero_tokens WHERE id = 1");
      const tok = tokenRow.rows[0];
      if (tok) {
        let accessToken = tok.access_token;
        const tenantId = tok.tenant_id;
        // Refresh if needed
        if (new Date(tok.expires_at).getTime() - Date.now() < 5 * 60 * 1000) {
          const rr = await fetch("https://identity.xero.com/connect/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token", refresh_token: tok.refresh_token,
              client_id: process.env.XERO_CLIENT_ID!, client_secret: process.env.XERO_CLIENT_SECRET!,
            }),
          });
          if (rr.ok) {
            const rd = await rr.json();
            accessToken = rd.access_token;
            await pool.query(
              `UPDATE xero_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=NOW() WHERE id=1`,
              [rd.access_token, rd.refresh_token ?? tok.refresh_token, new Date(Date.now() + rd.expires_in * 1000)]
            );
          }
        }
        // Search Xero for this contact by name
        const searchName = encodeURIComponent(customerName);
        const xr = await fetch(
          `https://api.xero.com/api.xro/2.0/Contacts?searchTerm=${searchName}&includeArchived=false`,
          { headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" } }
        );
        if (xr.ok) {
          const xd = await xr.json();
          const contacts: any[] = xd?.Contacts ?? [];
          // Match by name (case-insensitive exact), then optionally by phone/email
          const nameLower = customerName.toLowerCase();
          let match = contacts.find((c: any) => c.Name?.toLowerCase() === nameLower);
          if (!match && contacts.length === 1) match = contacts[0]; // only one result, trust it
          if (match?.ContactID) {
            await pool.query(
              "UPDATE customers SET xero_contact_id = $1, updated_at = NOW() WHERE id = $2",
              [match.ContactID, customerId]
            );
            console.log(`[formitize:webhook] Auto-linked customer #${customerId} → Xero ${match.ContactID}`);
          } else if (contacts.length > 1) {
            console.log(`[formitize:webhook] Multiple Xero contacts for "${customerName}" — manual link needed`);
          } else {
            console.log(`[formitize:webhook] No Xero contact found for "${customerName}"`);
          }
        }
      }
    }
  } catch (xeroErr: any) {
    console.warn(`[formitize:webhook] Xero auto-link failed (non-fatal):`, xeroErr.message);
  }

  // ── Extract financial figures from application form ────────────────────────
  // These are typically in the "For Office Use Only" section of ChikweretiOne / Revolver.
  // We parse them as floats after stripping currency symbols.
  function parseCurrency(raw: string | undefined): number | null {
    if (!raw) return null;
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    return isNaN(n) || n <= 0 ? null : n;
  }
  // formCalculate_2 = facility fee output (Formitize calc field, lowercased in fieldMap)
  // formCalculate_1 = interest output (Formitize calc field, lowercased in fieldMap)
  // NOTE: HukuPlus Loan Agreement sends the facility fee as unnamed field "0"
  //       (Formitize calculated fields are not transmitted in webhooks, but
  //        the fee field is a regular numeric field serialised with key "0").
  const facilityFeeAmount = parseCurrency(
    fieldMap["formcalculate_2"] ||
    findField(
      "facilityfeeamount", "facility fee amount", "facilityfee", "facility fee",
      "arrangementfee", "arrangement fee"
    ) ||
    fieldMap["0"]   // HukuPlus Loan Agreement: facility fee arrives as field "0"
  );

  // HukuPlus charges 108% APR applied to the actual term in days.
  // interest = principal × 1.08 × (days / 365)
  // The form calculates this but Formitize strips calculated fields from webhooks,
  // so we re-derive it from the disbursement and settlement date fields.
  function calcHukuPlusInterest(principal: number, disbStr: string | null, settleStr: string | null): number | null {
    if (!principal || !disbStr || !settleStr) return null;
    const disb   = new Date(disbStr);
    const settle = new Date(settleStr);
    if (isNaN(disb.getTime()) || isNaN(settle.getTime())) return null;
    const days = Math.round((settle.getTime() - disb.getTime()) / (1000 * 60 * 60 * 24));
    if (days <= 0) return null;
    return Math.round(principal * 1.08 * (days / 365) * 100) / 100;
  }

  const interestAmount = parseCurrency(
    fieldMap["formcalculate_1"] ||
    findField(
      "totalinterestpayable", "total interest payable", "totalinterest",
      "interest amount", "interestamount", "total interest"
    )
  ) ?? (product === "HukuPlus"
    ? calcHukuPlusInterest(loanAmount, disbursementDate, repaymentDate)
    : null);
  const monthlyInstalment = parseCurrency(findField(
    "monthlyinstalmentamount", "monthly instalment amount", "monthlyinstalment",
    "monthly instalment", "instalment amount", "instalmentamount",
    "monthlyrepayment", "monthly repayment"
  ));
  const loanTenorRaw = findField(
    "loantenor", "loan tenor", "loanterm", "loan term",
    "tenor", "termonths", "repaymentperiod",
    "formNumber_1"
  );
  const loanTenorMonths = loanTenorRaw ? (parseInt(loanTenorRaw, 10) || null) : null;

  // ── Create agreement record ────────────────────────────────────────────────
  const isAgreement = formType === "agreement";
  const signingToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const [agreement] = await db.insert(agreementsTable).values({
    ...(retailerId ? { retailerId } : {}),
    ...(branchId ? { branchId } : {}),
    customerId,
    customerName,
    customerPhone,
    loanProduct: product,
    formType,
    formName: rawFormName || null,
    loanAmount: isNaN(loanAmount) ? 0 : loanAmount,
    formitizeJobId: jobId,
    formitizeFormUrl: null,
    signingToken,
    status: isAgreement ? "pending" : isReApplication ? "reapplication" : "application",
    expiresAt,
    createdBy: "formitize-webhook",
    ...(disbursementDate ? { disbursementDate } : {}),
    ...(repaymentDate ? { repaymentDate } : {}),
    ...(repaymentAmount !== null && !isNaN(repaymentAmount) ? { repaymentAmount } : {}),
    ...(facilityFeeAmount !== null ? { facilityFeeAmount: String(facilityFeeAmount) } : {}),
    ...(interestAmount !== null ? { interestAmount: String(interestAmount) } : {}),
    ...(monthlyInstalment !== null ? { monthlyInstalment: String(monthlyInstalment) } : {}),
    ...(loanTenorMonths !== null ? { loanTenorMonths } : {}),
    formData: fieldMap as any,
  }).returning();

  await db.insert(activityTable).values({
    type: isAgreement ? "agreement_created" : "application_received",
    description: `${rawFormName} received for ${customerName}${resolvedRetailerName ? ` @ ${resolvedRetailerName}` : ""}`,
    loanProduct: product,
    referenceId: agreement.id,
    ...(resolvedRetailerName ? { retailerName: resolvedRetailerName } : {}),
    ...(resolvedBranchName ? { branchName: resolvedBranchName } : {}),
  });

  const appUrl = process.env.APP_URL || "https://huku-plus-central.replit.app";
  const signingUrl = `${appUrl}/sign/${signingToken}`;

  // ── Delinquency safety check ─────────────────────────────────────────────
  // Flag if the applicant OR the next-of-kin is a known delinquent customer.
  const delinquentNamesApp = await fetchDelinquentNames();
  let isDelinquentWarning  = false;
  let delinquentMatch: string | null = null;

  const applicantDelinq = checkDelinquent(customerName, delinquentNamesApp);
  if (applicantDelinq) {
    isDelinquentWarning = true;
    delinquentMatch     = `Applicant matches delinquent record: "${applicantDelinq}"`;
    console.warn(`[delinquency] APPLICANT MATCH — "${customerName}" → "${applicantDelinq}" on ${rawFormName}`);
  }

  if (!isDelinquentWarning && nokName) {
    const nokDelinq = checkDelinquent(nokName, delinquentNamesApp);
    if (nokDelinq) {
      isDelinquentWarning = true;
      delinquentMatch     = `Next-of-kin "${nokName}" matches delinquent record: "${nokDelinq}"`;
      console.warn(`[delinquency] NOK MATCH — "${nokName}" → "${nokDelinq}" on ${rawFormName} (applicant: ${customerName})`);
    }
  }

  await upsertNotification({
    jobId,
    formName: rawFormName,
    taskType: formType,
    product,
    customerName,
    customerId: customerId ?? null,
    customerPhone: customerPhone ?? null,
    branchName: resolvedBranchName || null,
    retailerName: resolvedRetailerName || null,
    isDelinquentWarning,
    delinquentMatch,
  });

  console.log(`[formitize:webhook] Created ${formType} #${agreement.id} — ${product} — ${customerName}`);

  // ── Auto-raise Xero invoice (HukuPlus agreements only, non-blocking) ──────
  if (isAgreement && loanAmount > 0) {
    // Capture the Marishoma loan number before entering the async closure —
    // calculated fields (formCalculate_*) are NOT sent by Formitize webhooks,
    // so we look up loanRaisingFee + accruedInterest from the Loan Register instead.
    const marishomaLoanNo = fieldMap["marishomaloanno"] || null;

    setImmediate(async () => {
      try {
        let resolvedFacilityFee: number | null = facilityFeeAmount ?? null;
        let resolvedInterest:    number | null = interestAmount    ?? null;

        // Look up fees from the Loan Register if either is missing
        if ((resolvedFacilityFee == null || resolvedInterest == null) && marishomaLoanNo) {
          try {
            const LR_URL = process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
            const LR_KEY = process.env.HUKUPLUS_API_KEY;
            const lrHdrs: Record<string, string> = { "Content-Type": "application/json" };
            if (LR_KEY) {
              lrHdrs["Authorization"]    = `Bearer ${LR_KEY}`;
              lrHdrs["X-Central-System"] = "HukuPlusCentral";
            }
            // Try a direct loanNumber filter first; fall back to scanning the full list
            const lrRes = await fetch(
              `${LR_URL}/api/central/loans?loanNumber=${encodeURIComponent(marishomaLoanNo)}`,
              { headers: lrHdrs },
            );
            if (lrRes.ok) {
              const lrData = await lrRes.json() as any;
              const loans: any[] = Array.isArray(lrData)
                ? lrData
                : (lrData.loans ?? lrData.data ?? []);
              const loan = loans.find(
                (l: any) => String(l.loanNumber) === String(marishomaLoanNo),
              );
              if (loan) {
                if (resolvedFacilityFee == null && loan.loanRaisingFee != null) {
                  resolvedFacilityFee = parseFloat(String(loan.loanRaisingFee)) || null;
                }
                if (resolvedInterest == null && loan.accruedInterest != null) {
                  resolvedInterest = parseFloat(String(loan.accruedInterest)) || null;
                }
                console.log(
                  `[xero-invoice] LR fees for loan #${marishomaLoanNo}: ` +
                  `facilityFee=${resolvedFacilityFee} interest=${resolvedInterest}`,
                );
                // Persist back to the agreement so manual re-raise also sees them
                if (resolvedFacilityFee != null || resolvedInterest != null) {
                  await pool.query(
                    `UPDATE agreements
                        SET facility_fee_amount = COALESCE($1, facility_fee_amount),
                            interest_amount     = COALESCE($2, interest_amount)
                      WHERE id = $3`,
                    [resolvedFacilityFee, resolvedInterest, agreement.id],
                  );
                }
              } else {
                console.warn(`[xero-invoice] LR loan #${marishomaLoanNo} not found — fees will be omitted`);
              }
            } else {
              console.warn(`[xero-invoice] LR fee lookup HTTP ${lrRes.status} for loan #${marishomaLoanNo}`);
            }
          } catch (lrErr: any) {
            console.warn(`[xero-invoice] LR fee lookup failed for loan #${marishomaLoanNo}:`, lrErr.message);
          }
        }

        const result = await createXeroInvoice({
          agreementId: agreement.id,
          customerName,
          customerPhone: customerPhone ?? null,
          loanAmount,
          facilityFeeAmount: resolvedFacilityFee,
          interestAmount:    resolvedInterest,
          retailerName: resolvedRetailerName ?? null,
          branchName:   resolvedBranchName   ?? null,
        });
        if (!result.ok) {
          console.warn(`[formitize:webhook] Xero invoice skipped for #${agreement.id}: ${result.error}`);
          return;
        }

        // ── Background retry: fallback for the rare case dates were missing ─────
        // Normally interest is computed from disbursement/settlement dates at
        // webhook time (108% APR × days). This retry only fires when those dates
        // are absent, which should not happen for standard HukuPlus agreements.
        if (result.xeroInvoiceId && resolvedInterest == null && marishomaLoanNo) {
          const xeroInvId = result.xeroInvoiceId;
          const XERO_BASE = "https://api.xero.com/api.xro/2.0";
          const LR_URL   = process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
          const LR_KEY   = process.env.HUKUPLUS_API_KEY;
          const lrHdrs: Record<string, string> = { "Content-Type": "application/json" };
          if (LR_KEY) { lrHdrs["Authorization"] = `Bearer ${LR_KEY}`; lrHdrs["X-Central-System"] = "HukuPlusCentral"; }

          // LR creates its entry only after it syncs from Xero — which may take hours.
          // Retry at 5 min, 20 min, 1 hr, 2 hr, 4 hr. Anything that still fails gets
          // picked up by the scheduled backfillMissingInterest job every 30 minutes.
          const RETRY_DELAYS_MS = [5*60_000, 20*60_000, 60*60_000, 2*60*60_000, 4*60*60_000];

          const tryAddInterest = async (delays: number[]): Promise<void> => {
            if (delays.length === 0) {
              console.warn(`[xero-invoice] Interest retries exhausted for loan #${marishomaLoanNo} — update ${xeroInvId} manually`);
              return;
            }
            await new Promise<void>(r => setTimeout(r, delays[0]));
            try {
              const lrRes = await fetch(
                `${LR_URL}/api/central/loans?loanNumber=${encodeURIComponent(marishomaLoanNo)}`,
                { headers: lrHdrs },
              );
              if (!lrRes.ok) return tryAddInterest(delays.slice(1));

              const lrData = await lrRes.json() as any;
              const loans: any[] = Array.isArray(lrData) ? lrData : (lrData.loans ?? lrData.data ?? []);
              const loan = loans.find((l: any) => String(l.loanNumber) === String(marishomaLoanNo));
              if (!loan) return tryAddInterest(delays.slice(1));

              const foundInterest = loan.accruedInterest != null ? parseFloat(String(loan.accruedInterest)) || null : null;
              if (!foundInterest) return tryAddInterest(delays.slice(1));

              console.log(`[xero-invoice] Retry found interest $${foundInterest} for loan #${marishomaLoanNo} — patching ${xeroInvId}`);

              // Persist interest to the agreement record
              await pool.query(
                `UPDATE agreements SET interest_amount = $1 WHERE id = $2`,
                [String(foundInterest), agreement.id],
              );

              // Fetch the live Xero invoice to get existing line items
              const auth = await getXeroAuth();
              if (!auth) { console.warn("[xero-invoice] Retry: Xero not connected — cannot patch interest"); return; }

              const getRes = await fetch(`${XERO_BASE}/Invoices/${xeroInvId}`, {
                headers: { ...xeroHeaders(auth), Accept: "application/json" },
              });
              if (!getRes.ok) { console.warn(`[xero-invoice] Retry: GET ${xeroInvId} failed`); return; }

              const getJson = await getRes.json() as any;
              const inv = getJson.Invoices?.[0];
              if (!inv) return;
              if (["PAID", "VOIDED", "DELETED"].includes(inv.Status ?? "")) {
                console.warn(`[xero-invoice] ${xeroInvId} is ${inv.Status} — cannot add interest line`);
                return;
              }

              // Bail if interest line already exists
              const existingLines: any[] = inv.LineItems ?? [];
              if (existingLines.some((l: any) => l.AccountCode === "201" || String(l.Description ?? "").toLowerCase().includes("interest"))) {
                console.log(`[xero-invoice] Interest line already present on ${xeroInvId}`);
                return;
              }

              // Preserve existing line items + add interest
              const updatedLines = [
                ...existingLines.map((l: any) => ({
                  Description: l.Description, Quantity: l.Quantity,
                  UnitAmount: l.UnitAmount, AccountCode: l.AccountCode,
                  ...(l.Tracking?.length > 0 ? { Tracking: l.Tracking } : {}),
                })),
                { Description: "42 days interest", Quantity: 1.0, UnitAmount: foundInterest, AccountCode: "201" },
              ];

              const patchRes = await fetch(`${XERO_BASE}/Invoices/${xeroInvId}`, {
                method: "POST",
                headers: xeroHeaders(auth),
                body: JSON.stringify({ Invoices: [{ InvoiceID: xeroInvId, LineItems: updatedLines }] }),
              });

              if (patchRes.ok) {
                console.log(`[xero-invoice] Interest $${foundInterest} added to ${xeroInvId} (retry after ${Math.round(delays[0]/1000)}s)`);
              } else {
                const errText = await patchRes.text();
                console.warn(`[xero-invoice] Patch interest on ${xeroInvId} failed: ${errText.slice(0, 200)}`);
              }
            } catch (retryErr: any) {
              console.warn(`[xero-invoice] Retry error: ${retryErr.message}`);
              return tryAddInterest(delays.slice(1));
            }
          };

          setImmediate(() => tryAddInterest(RETRY_DELAYS_MS));
        }
      } catch (err: any) {
        console.error(`[formitize:webhook] Xero invoice error for #${agreement.id}:`, err.message);
      }
    });
  }

  res.status(201).json({
    ok: true,
    agreementId: agreement.id,
    product,
    formType,
    status: agreement.status,
    ...(isAgreement ? { signingUrl } : {}),
    ...(resolvedRetailerName ? { retailer: resolvedRetailerName, branch: resolvedBranchName } : {}),
  });
});

// ─── GET /api/formitize/notifications ────────────────────────────────────────
router.get("/formitize/notifications", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  try {
    const { product, task_type, status } = req.query;
    const params: any[] = [];
    const conditions: string[] = [];
    if (product && product !== "all") { params.push(product); conditions.push(`fn.product = $${params.length}`); }
    if (task_type && task_type !== "all") { params.push(task_type); conditions.push(`fn.task_type = $${params.length}`); }
    if (status && status !== "all") { params.push(status); conditions.push(`fn.status = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT
         fn.*,
         a.id                   AS agreement_id,
         a.loan_amount,
         a.facility_fee_amount,
         a.interest_amount,
         a.xero_invoice_id,
         -- Resolved collection date — type-specific field IDs to avoid cross-form
         -- contamination (new app uses formdate_2; re-app uses formdate_3).
         COALESCE(
           NULLIF(TRIM(a.disbursement_date), ''),
           CASE COALESCE(NULLIF(a.form_type, 'unknown'), fn.task_type)
             WHEN 'application' THEN COALESCE(
               a.form_data->>'formdate_2',
               a.form_data->>'collection date',
               a.form_data->>'collectiondate',
               a.form_data->>'expected date of stock collection',
               a.form_data->>'stockcollectiondate',
               a.form_data->>'expectedcollectiondate'
             )
             WHEN 'reapplication' THEN COALESCE(
               a.form_data->>'formdate_3',
               a.form_data->>'collection date',
               a.form_data->>'collectiondate',
               a.form_data->>'expected date of stock collection',
               a.form_data->>'stockcollectiondate',
               a.form_data->>'expectedcollectiondate'
             )
           END
         )                      AS resolved_collection_date,
         -- Bookings pipeline status (only meaningful for application/reapplication)
         CASE
           WHEN fn.task_type NOT IN ('application', 'reapplication') THEN NULL
           WHEN a.id IS NULL THEN 'no_agreement'
           WHEN COALESCE(
             NULLIF(TRIM(a.disbursement_date), ''),
             CASE COALESCE(NULLIF(a.form_type, 'unknown'), fn.task_type)
               WHEN 'application' THEN COALESCE(
                 a.form_data->>'formdate_2',
                 a.form_data->>'collection date',
                 a.form_data->>'collectiondate',
                 a.form_data->>'expected date of stock collection',
                 a.form_data->>'stockcollectiondate',
                 a.form_data->>'expectedcollectiondate'
               )
               WHEN 'reapplication' THEN COALESCE(
                 a.form_data->>'formdate_3',
                 a.form_data->>'collection date',
                 a.form_data->>'collectiondate',
                 a.form_data->>'expected date of stock collection',
                 a.form_data->>'stockcollectiondate',
                 a.form_data->>'expectedcollectiondate'
               )
             END
           ) IS NOT NULL THEN 'booked'
           ELSE 'no_date'
         END                    AS booking_status
       FROM formitize_notifications fn
       LEFT JOIN agreements a
         ON a.formitize_job_id = fn.formitize_job_id
         AND fn.formitize_job_id IS NOT NULL
       ${where}
       ORDER BY fn.created_at DESC
       LIMIT 500`,
      params
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error("[formitize] notifications list error:", err.message);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// ─── GET /api/formitize/notifications/counts ──────────────────────────────────
router.get("/formitize/notifications/counts", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT product, task_type, status, COUNT(*) AS count
       FROM formitize_notifications
       GROUP BY product, task_type, status`
    );
    const newTotal = await pool.query(
      `SELECT COUNT(*) AS count FROM formitize_notifications WHERE status = 'new'`
    );
    res.json({ breakdown: result.rows, newTotal: parseInt(newTotal.rows[0].count) });
  } catch (err: any) {
    console.error("[formitize] notifications counts error:", err.message);
    res.status(500).json({ error: "Failed to load counts" });
  }
});

// ─── PUT /api/formitize/notifications/:id/status ──────────────────────────────
router.put("/formitize/notifications/:id/status", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  if (!["new", "actioned"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  if (notes !== undefined) {
    await pool.query(
      "UPDATE formitize_notifications SET status = $1, notes = $2, updated_at = NOW() WHERE id = $3",
      [status, notes, id]
    );
  } else {
    await pool.query(
      "UPDATE formitize_notifications SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, id]
    );
  }
  res.json({ ok: true });
});

// ─── Formitize API helper ─────────────────────────────────────────────────────
// Tries both known base URLs for Formitize accounts.
const FORMITIZE_BASES = [
  "https://service.formitize.com/api/v1",
  "https://app.formitize.com/api/v2",
];

async function formitizeGet(path: string): Promise<{ ok: boolean; base: string; data: any }> {
  const apiKey = process.env.FORMITIZE_API_KEY;
  if (!apiKey) return { ok: false, base: "", data: { error: "FORMITIZE_API_KEY not set" } };
  for (const base of FORMITIZE_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
      if (res.status < 500) return { ok: res.ok, base, data };
    } catch { /* try next */ }
  }
  return { ok: false, base: "", data: { error: "All base URLs failed" } };
}

// ─── GET /api/formitize/explore ───────────────────────────────────────────────
// Admin endpoint — discovers live Formitize form templates and field structure.
// Pass ?templateId=NNN to inspect a specific template's fields.
// Pass ?submittedFormId=NNN to inspect a submitted form's data.
router.get("/formitize/explore", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const { templateId, submittedFormId } = req.query as Record<string, string>;
  const results: Record<string, any> = {};

  if (submittedFormId) {
    const r = await formitizeGet(`/forms/${submittedFormId}`);
    results.submittedForm = { base: r.base, ok: r.ok, data: r.data };
  } else if (templateId) {
    const r = await formitizeGet(`/forms/templates/${templateId}`);
    results.template = { base: r.base, ok: r.ok, data: r.data };
  } else {
    // List templates + recent submitted forms
    const [tmpl, recent] = await Promise.all([
      formitizeGet("/forms/templates"),
      formitizeGet("/forms?limit=5"),
    ]);
    results.templates = { base: tmpl.base, ok: tmpl.ok, data: tmpl.data };
    results.recentForms = { base: recent.base, ok: recent.ok, data: recent.data };
  }

  res.json(results);
});

// ─── PATCH /api/formitize/notifications/:id/reassign ─────────────────────────
// Allows staff to correct the retailer/branch on a notification and its linked agreement.
router.patch("/formitize/notifications/:id/reassign", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid notification id" }); return; }

  const { retailerId, branchId, retailerName, branchName } = req.body as {
    retailerId?: number;
    branchId?: number;
    retailerName?: string;
    branchName?: string;
  };

  if (!retailerName) { res.status(400).json({ error: "retailerName is required" }); return; }

  const client = await pool.connect();
  try {
    // Update the notification's display names
    await client.query(
      `UPDATE formitize_notifications
       SET retailer_name = $1, branch_name = $2, updated_at = NOW()
       WHERE id = $3`,
      [retailerName, branchName ?? null, id]
    );

    // Also update the linked agreement if one exists
    if (retailerId || branchId) {
      const notifRow = await client.query(
        `SELECT formitize_job_id FROM formitize_notifications WHERE id = $1`,
        [id]
      );
      const jobId = notifRow.rows[0]?.formitize_job_id;
      if (jobId) {
        const setParts: string[] = [];
        const params: any[] = [];
        if (retailerId) { params.push(retailerId); setParts.push(`retailer_id = $${params.length}`); }
        if (branchId)   { params.push(branchId);   setParts.push(`branch_id = $${params.length}`);   }
        if (setParts.length > 0) {
          params.push(jobId);
          await client.query(
            `UPDATE agreements SET ${setParts.join(", ")} WHERE formitize_job_id = $${params.length}`,
            params
          );
        }
      }
    }

    console.log(`[notifications] Reassigned id=${id} → ${retailerName} / ${branchName ?? "no branch"}`);
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

// ─── POST /api/formitize/notifications/:id/push-to-bookings ──────────────────
// Sets (or creates) an agreement's disbursement_date (collection date) from
// the Activity page, so staff can manually place any application/re-application
// into the correct Bookings pipeline bucket without waiting for the form data
// to be re-parsed automatically.
router.post("/formitize/notifications/:id/push-to-bookings", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const notifId = parseInt(req.params.id, 10);
  if (isNaN(notifId)) { res.status(400).json({ error: "Invalid notification id" }); return; }

  const { collectionDate } = req.body as { collectionDate?: string };
  if (!collectionDate || !/^\d{4}-\d{2}-\d{2}$/.test(collectionDate)) {
    res.status(400).json({ error: "collectionDate must be YYYY-MM-DD" }); return;
  }

  const client = await pool.connect();
  try {
    // Load the notification to get its linked job id and key fields
    const notifRes = await client.query<{
      formitize_job_id: string | null;
      task_type: string;
      product: string;
      customer_name: string | null;
      retailer_name: string | null;
      branch_name: string | null;
    }>(`SELECT formitize_job_id, task_type, product, customer_name, retailer_name, branch_name
        FROM formitize_notifications WHERE id = $1`, [notifId]);

    if (notifRes.rowCount === 0) { res.status(404).json({ error: "Notification not found" }); return; }
    const notif = notifRes.rows[0];

    if (!["application","reapplication"].includes(notif.task_type)) {
      res.status(400).json({ error: "Only application/reapplication notifications can be pushed to Bookings" }); return;
    }

    const jobId = notif.formitize_job_id;

    if (jobId) {
      // Try to update an existing agreement first
      const upd = await client.query(
        `UPDATE agreements SET disbursement_date = $1, dismissed = false
         WHERE formitize_job_id = $2 AND status IN ('application','reapplication')`,
        [collectionDate, jobId]
      );

      if ((upd.rowCount ?? 0) > 0) {
        console.log(`[push-to-bookings] Updated agreement for jobId=${jobId} → ${collectionDate}`);
        res.json({ ok: true, action: "updated" });
        return;
      }
    }

    // No agreement yet — create a minimal one so it appears in Bookings
    const formType = notif.task_type; // 'application' or 'reapplication'

    // Resolve retailer / branch IDs by name (best-effort)
    let retailerId: number | null = null;
    let branchId: number | null = null;
    if (notif.retailer_name) {
      const rRow = await client.query<{ id: number }>(
        `SELECT id FROM retailers WHERE LOWER(name) = LOWER($1) LIMIT 1`, [notif.retailer_name]
      );
      retailerId = rRow.rows[0]?.id ?? null;
    }
    if (retailerId && notif.branch_name) {
      const bRow = await client.query<{ id: number }>(
        `SELECT id FROM branches WHERE retailer_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
        [retailerId, notif.branch_name]
      );
      branchId = bRow.rows[0]?.id ?? null;
    }

    await client.query(
      `INSERT INTO agreements
         (formitize_job_id, status, form_type, customer_name, retailer_id, branch_id,
          retailer_name, branch_name, disbursement_date, form_data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, '{}'::jsonb, NOW())
       ON CONFLICT (formitize_job_id) DO UPDATE
         SET disbursement_date = EXCLUDED.disbursement_date`,
      [
        jobId ?? `manual-${notifId}-${Date.now()}`,
        formType,
        formType,
        notif.customer_name,
        retailerId,
        branchId,
        notif.retailer_name,
        notif.branch_name,
        collectionDate,
      ]
    );

    console.log(`[push-to-bookings] Created agreement for notifId=${notifId} → ${collectionDate}`);
    res.json({ ok: true, action: "created" });
  } catch (err: any) {
    console.error(`[push-to-bookings] Error:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

// ─── GET /api/formitize/api-sync/status ──────────────────────────────────────
// Returns when the last pull-sync ran and its result summary.
router.get("/formitize/api-sync/status", requireStaffAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  const { getLastApiSync } = await import("../lib/syncFormitize");
  const { lastSyncAt, lastResult } = getLastApiSync();
  res.json({ lastSyncAt, lastResult });
});

// ─── POST /api/formitize/api-sync ─────────────────────────────────────────────
// Manually triggers a Formitize API pull-sync immediately.
router.post("/formitize/api-sync", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const port = Number(process.env.PORT ?? 3000);
  try {
    const { syncFormitizeSubmissions } = await import("../lib/syncFormitize");
    const result = await syncFormitizeSubmissions({ port });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[formitize:api-sync] Manual trigger failed:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/formitize/notifications/mark-all ───────────────────────────────
router.post("/formitize/notifications/mark-all", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  const { product, task_type } = req.body as { product?: string; task_type?: string };
  const params: any[] = [];
  let where = "WHERE status = 'new'";
  if (product) { params.push(product); where += ` AND product = $${params.length}`; }
  if (task_type) { params.push(task_type); where += ` AND task_type = $${params.length}`; }
  const result = await pool.query(
    `UPDATE formitize_notifications SET status = 'actioned', updated_at = NOW() ${where}`,
    params
  );
  res.json({ ok: true, updated: result.rowCount });
});

export default router;
