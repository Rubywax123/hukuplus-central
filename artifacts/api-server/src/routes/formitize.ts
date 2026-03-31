import { Router } from "express";
import { db, pool, agreementsTable, retailersTable, branchesTable, activityTable, customersTable } from "@workspace/db";
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

// ─── Form context detection ────────────────────────────────────────────────────
function parseFormContext(formName: string): {
  product: "HukuPlus" | "ChikweretiOne" | "Revolver";
  formType: "agreement" | "application" | "reapplication" | "drawdown" | "payment" | "upload" | "approval" | "undertaking" | "unknown";
} {
  const n = formName.toLowerCase();

  let product: "HukuPlus" | "ChikweretiOne" | "Revolver" = "HukuPlus";
  if (n.includes("chikweret")) product = "ChikweretiOne";
  else if (n.includes("revolver")) product = "Revolver";
  // HukuPlus catches: "hukuplus", "novafeed", "new customer", "drawdown approval", "payment receipt"

  let formType: "agreement" | "application" | "reapplication" | "drawdown" | "payment" | "upload" | "approval" | "undertaking" | "unknown" = "unknown";
  if (n.includes("agreement")) formType = "agreement";
  else if (n.includes("re-application") || n.includes("reapplication") || n.includes("re application")) formType = "reapplication";
  else if (n.includes("application")) formType = "application";
  else if (n.includes("drawdown")) formType = "drawdown";
  else if (n.includes("payment") || n.includes("receipt") || n.includes("payment notice")) formType = "payment";
  else if (n.includes("upload") || n.includes("document")) formType = "upload";
  else if (n.includes("approval")) formType = "approval";
  else if (n.includes("undertaking")) formType = "undertaking";

  return { product, formType };
}

// ─── Upsert a notification record for every inbound Formitize submission ──────
async function upsertNotification(params: {
  jobId: string | null;
  formName: string;
  taskType: string;
  product: string;
  customerName: string;
  customerPhone?: string | null;
  branchName?: string | null;
  retailerName?: string | null;
}) {
  try {
    await pool.query(
      `INSERT INTO formitize_notifications
         (formitize_job_id, form_name, task_type, product, customer_name, customer_phone, branch_name, retailer_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (formitize_job_id) DO NOTHING`,
      [params.jobId, params.formName, params.taskType, params.product,
       params.customerName, params.customerPhone ?? null,
       params.branchName ?? null, params.retailerName ?? null]
    );
  } catch (err) {
    console.error("[formitize:webhook] Failed to upsert notification:", err);
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
  console.log(`[formitize:webhook] Hit — form="${rawFormName}" submittedFormID=${body.submittedFormID} jobID=${body.jobID}`);

  const formName = rawFormName.toLowerCase().trim();
  if (!formName) {
    res.status(400).json({ error: "No form name in payload" });
    return;
  }

  const { product, formType } = parseFormContext(formName);
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
      if (nodeKeys.length === 1 && nodeKeys[0] === "0" && typeof node["0"] === "string" && node["0"].trim()) {
        fieldMap[key.toLowerCase()] = node["0"].trim();
        continue;
      }

      if (node.value !== undefined && node.value !== null && typeof node.value !== "object" && String(node.value).trim()) {
        const resolvedKey = (node.name || node.label || key).toString().toLowerCase();
        fieldMap[resolvedKey] = String(node.value).trim();
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

  // ── Job ID dedup ───────────────────────────────────────────────────────────
  const rawJobId = body.jobID || body.jobId || body.job_id || null;
  const jobId = (rawJobId && String(rawJobId) !== "0")
    ? String(rawJobId)
    : (body.submittedFormID ? String(body.submittedFormID) : null);

  if (jobId) {
    const existing = await db.select({ id: agreementsTable.id })
      .from(agreementsTable).where(eq(agreementsTable.formitizeJobId, jobId));
    if (existing.length > 0) {
      console.log(`[formitize:webhook] Duplicate jobId ${jobId} — skipped`);
      res.status(200).json({ ok: true, skipped: true, reason: "Already imported" });
      return;
    }
  }

  // ── Activity-only form types (no agreement record needed) ──────────────────
  // Drawdowns, payments, uploads, approvals, undertakings are events against
  // existing agreements — store as activity log and return.
  const activityOnly = ["drawdown", "payment", "upload", "approval", "undertaking"];
  if (activityOnly.includes(formType)) {
    const customerName = findField(
      "formcrm_1", "borrowername", "clientname", "customername", "employeename",
      "applicantname", "fullname", "name", "formtext_1", "formtext_2"
    ) || rawFormName;

    await db.insert(activityTable).values({
      type: `formitize_${formType}`,
      description: `${rawFormName} received for ${customerName}`,
      loanProduct: product,
      referenceId: jobId ? parseInt(jobId) || null : null,
    });

    await upsertNotification({ jobId, formName: rawFormName, taskType: formType, product, customerName });

    console.log(`[formitize:webhook] Stored as activity — ${rawFormName}`);
    res.status(200).json({ ok: true, stored: "activity", product, formType });
    return;
  }

  // ── Agreement and Application forms — create a record ─────────────────────
  // "New Customer Application" forms use a different field layout:
  //   formtext_1 = store/branch name, formtext_2 = customer name
  // All other forms use the standard layout where formtext_1 = customer name.
  const isNewCustomerForm = formName.includes("new customer");

  // Extract customer identity fields (broad search across all product field names)
  const customerName = isNewCustomerForm
    ? (findField("formtext_2") || findField(
        "formcrm_1", "borrowername", "clientname", "customername",
        "fullname", "full name", "name", "formtext_1"
      ))
    : findField(
        "formcrm_1", "borrowername", "clientname", "customername",
        "employeename", "employee name", "debtorname", "debtor name",
        "applicantname", "applicant name", "revolverName",
        "fullname", "full name", "name",
        "formtext_1", "formtext_2", "formtext_3",
        "borrowerid"
      );

  if (!customerName) {
    console.log(`[formitize:webhook] Missing customer name. Fields: ${Object.keys(fieldMap).join(", ")}`);
    res.status(400).json({ error: "Missing customer name", availableFields: Object.keys(fieldMap) });
    return;
  }

  const customerPhone = findField(
    "borrowermobile", "employeemobile", "mobile", "phone",
    "cell", "cellphone", "contact number", "contactnumber", "phonenumber",
    "formtel_1", "formtel_2"
  ) || null;

  // National ID — checked against common field names; formtext_7 is the "new customer" form slot
  const nationalIdRaw = findField(
    "nationalid", "national_id", "idnumber", "id number", "national id",
    "employeeid", "employee id", "debtornid", "nid", "formtext_7"
  ) || null;

  // Email — filter out placeholder "na" / "n/a" values
  const isNa = (v: string | undefined) =>
    !v || ["na", "n/a", "none", "nil", "-"].includes(v.toLowerCase().trim());
  const customerEmailRaw = findField(
    "email", "emailaddress", "email address", "borroweremail",
    "employeeemail", "formemail_1", "formemail_2"
  );
  const customerEmail = isNa(customerEmailRaw) ? null : (customerEmailRaw || null);

  // Address — formlocation_1 is the "new customer" form slot; also check generic labels
  const customerAddressRaw = findField(
    "address", "homeaddress", "home address", "residentialaddress",
    "residential address", "formlocation_1"
  );
  const customerAddress = isNa(customerAddressRaw) ? null : (customerAddressRaw || null);

  const loanAmountRaw = findField(
    "loanamount", "loan amount", "creditlimit", "credit limit",
    "revolveramount", "revolver amount", "deductionamount", "deduction amount", "amount"
  );
  const loanAmount = parseFloat(loanAmountRaw || "0");

  // ── Retailer / branch resolution (product-specific) ────────────────────────
  let retailerId: number | null = null;
  let branchId: number | null = null;
  let resolvedRetailerName = "";
  let resolvedBranchName = "";

  if (product === "HukuPlus" && isNewCustomerForm) {
    // "New Customer Application" — formtext_1 contains the actual store/branch name.
    // Search all branches for a match, then resolve parent retailer.
    const storeName = (fieldMap["formtext_1"] || "").trim();
    if (storeName) {
      const allBranches = await db.select().from(branchesTable);
      const storeWords = storeName.toLowerCase().split(/\s+/);
      const matchedBranch = allBranches.find(b => {
        const bn = b.name.toLowerCase();
        return storeWords.some(w => w.length > 2 && bn.includes(w));
      });
      if (matchedBranch) {
        branchId = matchedBranch.id;
        resolvedBranchName = matchedBranch.name;
        const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, matchedBranch.retailerId));
        if (retailer) { retailerId = retailer.id; resolvedRetailerName = retailer.name; }
      } else {
        // Fallback: match retailer name directly
        const [retailer] = await db.select().from(retailersTable).where(ilike(retailersTable.name, `%${storeWords[0]}%`));
        if (retailer) {
          retailerId = retailer.id;
          resolvedRetailerName = retailer.name;
          const [firstBranch] = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, retailer.id));
          if (firstBranch) { branchId = firstBranch.id; resolvedBranchName = firstBranch.name; }
        }
      }
    }
  } else if (product === "HukuPlus") {
    // Standard HukuPlus agreement → always Novafeeds; branch from formtext_5 / storebranch
    const branchName = findField("formtext_5", "storebranch", "store branch", "branchname");
    const [retailer] = await db.select().from(retailersTable).where(ilike(retailersTable.name, "%novafeed%"));
    if (retailer) {
      retailerId = retailer.id;
      resolvedRetailerName = retailer.name;
      const allBranches = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, retailer.id));
      const branch = branchName
        ? (allBranches.find(r => r.name.toLowerCase().includes(branchName.toLowerCase())) || allBranches[0])
        : allBranches[0];
      if (branch) { branchId = branch.id; resolvedBranchName = branch.name; }
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
    if (s.startsWith("+263")) s = "0" + s.slice(4);
    else if (s.startsWith("263") && s.length >= 12) s = "0" + s.slice(3);
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

  let customerId: number | null = null;
  if (formitizeCrmId) {
    const [hit] = await db.select({ id: customersTable.id })
      .from(customersTable).where(eq(customersTable.formitizeCrmId, formitizeCrmId));
    if (hit) customerId = hit.id;
  }
  if (!customerId && normPhone) {
    const [hit] = await db.select({ id: customersTable.id })
      .from(customersTable).where(eq(customersTable.phone, normPhone));
    if (hit) customerId = hit.id;
  }
  if (!customerId) {
    const allByName = await db.select({ id: customersTable.id })
      .from(customersTable).where(ilike(customersTable.fullName, customerName));
    if (allByName.length === 1) customerId = allByName[0].id;
  }
  if (!customerId) {
    const [newCustomer] = await db.insert(customersTable).values({
      fullName: customerName,
      ...(normPhone       ? { phone:          normPhone       } : {}),
      ...(nationalIdRaw   ? { nationalId:     nationalIdRaw   } : {}),
      ...(customerEmail   ? { email:          customerEmail   } : {}),
      ...(customerAddress ? { address:        customerAddress } : {}),
      ...(formitizeCrmId  ? { formitizeCrmId: formitizeCrmId  } : {}),
    }).returning({ id: customersTable.id });
    customerId = newCustomer.id;
    console.log(`[formitize:webhook] Created customer #${customerId} for "${customerName}"`);
  } else {
    // Enrich existing customer record with any new details from this form
    const updates: Record<string, string> = {};
    if (normPhone)       updates.phone        = normPhone;
    if (nationalIdRaw)   updates.national_id  = nationalIdRaw;
    if (customerEmail)   updates.email        = customerEmail;
    if (customerAddress) updates.address      = customerAddress;
    if (Object.keys(updates).length > 0) {
      const setClauses = Object.entries(updates)
        .map(([k], i) => `${k} = COALESCE(${k}, $${i + 2})`)
        .join(", ");
      const values = [customerId, ...Object.values(updates)];
      await pool.query(
        `UPDATE customers SET ${setClauses} WHERE id = $1`,
        values
      );
    }
    console.log(`[formitize:webhook] Linked to customer #${customerId} for "${customerName}"`);
  }

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
    loanAmount: isNaN(loanAmount) ? 0 : loanAmount,
    formitizeJobId: jobId,
    formitizeFormUrl: null,
    signingToken,
    // Agreements go "pending" (awaiting signature); applications just sit as "application"
    status: isAgreement ? "pending" : "application",
    expiresAt,
    createdBy: "formitize-webhook",
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

  await upsertNotification({
    jobId,
    formName: rawFormName,
    taskType: formType,
    product,
    customerName,
    customerPhone: customerPhone ?? null,
    branchName: resolvedBranchName || null,
    retailerName: resolvedRetailerName || null,
  });

  console.log(`[formitize:webhook] Created ${formType} #${agreement.id} — ${product} — ${customerName}`);

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
router.get("/formitize/notifications", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { product, task_type, status } = req.query;
  const params: any[] = [];
  let where = "WHERE 1=1";
  if (product && product !== "all") { params.push(product); where += ` AND product = $${params.length}`; }
  if (task_type && task_type !== "all") { params.push(task_type); where += ` AND task_type = $${params.length}`; }
  if (status && status !== "all") { params.push(status); where += ` AND status = $${params.length}`; }
  const result = await pool.query(
    `SELECT * FROM formitize_notifications ${where} ORDER BY created_at DESC LIMIT 500`,
    params
  );
  res.json(result.rows);
});

// ─── GET /api/formitize/notifications/counts ──────────────────────────────────
router.get("/formitize/notifications/counts", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const result = await pool.query(
    `SELECT product, task_type, status, COUNT(*) AS count
     FROM formitize_notifications
     GROUP BY product, task_type, status`
  );
  const newTotal = await pool.query(
    `SELECT COUNT(*) AS count FROM formitize_notifications WHERE status = 'new'`
  );
  res.json({ breakdown: result.rows, newTotal: parseInt(newTotal.rows[0].count) });
});

// ─── PUT /api/formitize/notifications/:id/status ──────────────────────────────
router.put("/formitize/notifications/:id/status", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { id } = req.params;
  const { status } = req.body;
  if (!["new", "actioned"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  await pool.query(
    "UPDATE formitize_notifications SET status = $1, updated_at = NOW() WHERE id = $2",
    [status, id]
  );
  res.json({ ok: true });
});

// ─── POST /api/formitize/notifications/mark-all ───────────────────────────────
router.post("/formitize/notifications/mark-all", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
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
