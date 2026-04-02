import { pool } from "@workspace/db";
import crypto from "crypto";

const XERO_BASE = "https://api.xero.com/api.xro/2.0";
const LOAN_REGISTER_URL =
  process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
const CENTRAL_API_KEY = process.env.CENTRAL_API_KEY;

// ─── Xero auth helpers ────────────────────────────────────────────────────────

async function getValidAccessToken(): Promise<{ accessToken: string; tenantId: string } | null> {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT * FROM xero_tokens WHERE id = 1");
    const tokens = result.rows[0];
    if (!tokens) return null;
    const expiresAt = new Date(tokens.expires_at);
    if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      const res = await fetch("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
          client_id: process.env.XERO_CLIENT_ID!,
          client_secret: process.env.XERO_CLIENT_SECRET!,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      const newExpiry = new Date(Date.now() + data.expires_in * 1000);
      await client.query(
        `UPDATE xero_tokens SET access_token=$1, refresh_token=$2, expires_at=$3, updated_at=NOW() WHERE id=1`,
        [data.access_token, data.refresh_token ?? tokens.refresh_token, newExpiry]
      );
      return { accessToken: data.access_token, tenantId: tokens.tenant_id };
    }
    return { accessToken: tokens.access_token, tenantId: tokens.tenant_id };
  } finally {
    client.release();
  }
}

function xeroHeaders(auth: { accessToken: string; tenantId: string }) {
  return {
    Authorization: `Bearer ${auth.accessToken}`,
    "Xero-tenant-id": auth.tenantId,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// ─── Loan Register API helpers ────────────────────────────────────────────────

function loanRegHeaders() {
  return {
    "Content-Type": "application/json",
    ...(CENTRAL_API_KEY ? {
      Authorization: `Bearer ${CENTRAL_API_KEY}`,
      "X-Central-System": "HukuPlusCentral",
    } : {}),
  };
}

export async function pushToLoanRegister(payload: Record<string, any>): Promise<number | null> {
  const res = await fetch(`${LOAN_REGISTER_URL}/api/loans`, {
    method: "POST",
    headers: loanRegHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[loan-register] Push failed (${res.status}): ${body.slice(0, 200)}`);
    return null;
  }
  const data = await res.json() as any;
  return data.id ?? null;
}

export async function deleteFromLoanRegister(loanRegisterId: number): Promise<boolean> {
  const res = await fetch(`${LOAN_REGISTER_URL}/api/loans/${loanRegisterId}`, {
    method: "DELETE",
    headers: loanRegHeaders(),
  });
  return res.status === 204 || res.status === 200;
}

export async function updateLoanRegisterStatus(
  loanRegisterId: number,
  status: "completed" | "active"
): Promise<boolean> {
  const res = await fetch(`${LOAN_REGISTER_URL}/api/loans/${loanRegisterId}`, {
    method: "PUT",
    headers: loanRegHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[loan-register] Status update failed (${res.status}): ${body.slice(0, 200)}`);
    return false;
  }
  const data = await res.json() as any;
  return data?.status === status;
}

// ─── Name splitter: "John Paul Smith" → { surname:"Smith", givenName:"John Paul" }
function splitName(fullName: string): { surname: string; givenName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { surname: parts[0], givenName: "" };
  const surname = parts[parts.length - 1];
  const givenName = parts.slice(0, -1).join(" ");
  return { surname, givenName };
}

// ─── Parse line items to extract Loan / Fee / Interest amounts ────────────────

interface ParsedLoanLines {
  loanAmount: number;
  loanRaisingFee: number;
  accruedInterest: number;
  totalAmount: number;
  trackingOptions: string[];    // tracking option values (e.g. "Profeeds Rusape")
  trackingCategories: string[]; // tracking category names (e.g. "HukuPlus")
}

function parseLoanLineItems(lineItems: any[]): ParsedLoanLines {
  let loanAmount = 0;
  let loanRaisingFee = 0;
  let accruedInterest = 0;
  const trackingOptions: string[] = [];
  const trackingCategories: string[] = [];

  for (const li of lineItems) {
    const desc = (li.Description || "").toLowerCase();
    const amount = parseFloat(String(li.LineAmount ?? 0)) || 0;

    if (desc.includes("loan") || desc.includes("principal")) {
      loanAmount += amount;
    } else if (desc.includes("fee") || desc.includes("facilit") || desc.includes("admin") || desc.includes("rais")) {
      loanRaisingFee += amount;
    } else if (desc.includes("interest") || desc.includes("42 day") || desc.includes("42day")) {
      accruedInterest += amount;
    } else if (loanAmount === 0 && loanRaisingFee === 0 && accruedInterest === 0) {
      // First unrecognised line gets treated as loan principal
      loanAmount += amount;
    }

    for (const t of li.Tracking ?? []) {
      if (t.Option) trackingOptions.push((t.Option as string).trim());
      // Capture the category name (e.g. "HukuPlus") to detect loan type by category
      if (t.Name) trackingCategories.push((t.Name as string).trim());
    }
  }

  const totalAmount = loanAmount + loanRaisingFee + accruedInterest;
  return { loanAmount, loanRaisingFee, accruedInterest, totalAmount, trackingOptions, trackingCategories };
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

// ─── Main sync function ───────────────────────────────────────────────────────

export interface SyncXeroResult {
  checked: number;
  pushed: number;
  skipped: number;
  errors: string[];
}

export async function syncXeroInvoices(): Promise<SyncXeroResult> {
  const result: SyncXeroResult = { checked: 0, pushed: 0, skipped: 0, errors: [] };

  if (!CENTRAL_API_KEY) {
    result.errors.push("CENTRAL_API_KEY not set — cannot push to Loan Register.");
    return result;
  }

  const auth = await getValidAccessToken();
  if (!auth) {
    result.errors.push("Xero not connected — please reconnect in Settings.");
    return result;
  }

  const client = await pool.connect();
  try {
    // ── Fetch known HukuPlus branch names from DB ─────────────────────────
    const branchRows = await client.query(
      `SELECT LOWER(b.name) AS name, b.name AS original_name
       FROM branches b
       JOIN retailers r ON r.id = b.retailer_id
       WHERE LOWER(r.name) LIKE '%hukuplus%'
          OR LOWER(r.name) LIKE '%huku plus%'`
    );
    const hukuplusBranchSet = new Set<string>(branchRows.rows.map((r: any) => r.name as string));
    const branchOriginalNames = new Map<string, string>(
      branchRows.rows.map((r: any) => [r.name as string, r.original_name as string])
    );

    // ── Fetch known customers keyed by xero_contact_id ───────────────────
    const contactRows = await client.query(
      `SELECT id, xero_contact_id, full_name, phone, national_id, date_of_birth,
              extension_officer, retailer_reference
       FROM customers
       WHERE xero_contact_id IS NOT NULL AND xero_contact_id != ''`
    );
    const contactMap = new Map<string, any>();
    for (const r of contactRows.rows) {
      contactMap.set((r.xero_contact_id as string).toLowerCase(), r);
    }

    // ── Determine ModifiedAfter window ────────────────────────────────────
    // Use last sync timestamp so frequent runs only fetch recently changed invoices.
    // Subtract 2 min buffer to avoid race conditions at the boundary.
    // Fall back to 7 days if no prior sync (e.g., first run or fresh deploy).
    let since: string;
    try {
      const lastSyncRow = await client.query(
        `SELECT value FROM system_settings WHERE key = 'xero_invoice_last_sync'`
      );
      if (lastSyncRow.rows[0]?.value) {
        const lastSyncMs = new Date(lastSyncRow.rows[0].value as string).getTime();
        const withBuffer = new Date(lastSyncMs - 2 * 60 * 1000);
        since = withBuffer.toISOString().split("T")[0];
      } else {
        // No prior sync — backfill last 7 days
        since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      }
    } catch {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    }

    const invoiceRes = await fetch(
      `${XERO_BASE}/Invoices?Type=ACCREC&Statuses=AUTHORISED,PARTIAL&ModifiedAfter=${since}&includeArchived=false`,
      { headers: xeroHeaders(auth) }
    );

    if (!invoiceRes.ok) {
      const body = await invoiceRes.text();
      result.errors.push(`Xero invoice fetch failed (${invoiceRes.status}): ${body.slice(0, 200)}`);
      return result;
    }

    const invoiceData = await invoiceRes.json() as any;
    const invoices: any[] = invoiceData.Invoices ?? [];
    result.checked = invoices.length;

    for (const inv of invoices) {
      const xeroInvoiceId: string = inv.InvoiceID;
      const lineItems: any[] = inv.LineItems ?? [];

      // ── Skip non-invoice document types ────────────────────────────────
      // Xero sometimes returns credit notes, overpayments, and prepayments
      // in the same Invoices API response. Only process plain ACCREC invoices.
      const docType: string = (inv.Type ?? "").toUpperCase();
      if (docType !== "ACCREC") {
        result.skipped++;
        console.log(`[sync:xero-invoices] Skipped non-invoice type "${inv.Type}" — ${inv.InvoiceNumber ?? xeroInvoiceId}`);
        continue;
      }

      // ── Skip invoices with zero or negative totals (voided / credit notes
      //    that somehow appear as ACCREC — e.g. CN-prefixed invoice numbers) ──
      const xeroTotal: number = parseFloat(String(inv.Total ?? 0)) || 0;
      const xeroInvoiceNumber: string = (inv.InvoiceNumber ?? "").toUpperCase();
      if (xeroTotal <= 0 || xeroInvoiceNumber.startsWith("CN-")) {
        result.skipped++;
        console.log(`[sync:xero-invoices] Skipped zero/negative/credit-note invoice ${inv.InvoiceNumber ?? xeroInvoiceId} (total=${xeroTotal})`);
        continue;
      }

      // ── Parse line items ───────────────────────────────────────────────
      const parsed = parseLoanLineItems(lineItems);

      // ── Identify HukuPlus invoices by tracking category name OR option value ──
      // Xero returns tracking as { Name: "HukuPlus", Option: "Profeeds Rusape" }.
      // The category name is the reliable signal — check it first, then fall back
      // to option-value matching against our known HukuPlus branch list.
      const hasHukuPlusTracking =
        parsed.trackingCategories.some((cat) => {
          const lower = cat.toLowerCase();
          return lower.includes("hukuplus") || lower.includes("huku plus");
        }) ||
        parsed.trackingOptions.some((opt) => {
          const lower = opt.toLowerCase();
          return (
            lower.includes("hukuplus") ||
            lower.includes("huku plus") ||
            hukuplusBranchSet.has(lower)
          );
        });

      const contactId: string = (inv.Contact?.ContactID ?? "").toLowerCase();
      const matchedCustomer = contactMap.get(contactId);

      if (!hasHukuPlusTracking && !matchedCustomer) {
        result.skipped++;
        continue;
      }

      if (parsed.loanAmount <= 0 && parsed.totalAmount <= 0) {
        result.skipped++;
        continue;
      }

      // ── Deduplicate: skip if already in agreements table ───────────────
      const existing = await client.query(
        "SELECT id, loan_register_id FROM agreements WHERE xero_invoice_id = $1",
        [xeroInvoiceId]
      );
      if (existing.rows.length > 0) {
        result.skipped++;
        continue;
      }

      // ── Resolve customer details ────────────────────────────────────────
      const xeroContactName: string = inv.Contact?.Name ?? "Unknown Customer";
      const { surname, givenName } = matchedCustomer
        ? splitName(matchedCustomer.full_name as string)
        : splitName(xeroContactName);

      const phone: string = matchedCustomer?.phone ?? "";
      const dateOfBirth: string | null = matchedCustomer?.date_of_birth ?? null;
      const nationalId: string | null = matchedCustomer?.national_id ?? null;
      const salesRep: string | null = matchedCustomer?.extension_officer ?? null;
      const customerId: number | null = matchedCustomer?.id ?? null;

      // ── Resolve branch / retailer from tracking options ────────────────
      let officeBranch: string | null = null;
      for (const opt of parsed.trackingOptions) {
        const lower = opt.toLowerCase();
        if (
          lower.includes("hukuplus") ||
          lower.includes("huku plus") ||
          hukuplusBranchSet.has(lower)
        ) {
          officeBranch = branchOriginalNames.get(lower) ?? opt;
          break;
        }
      }
      // Fall back to first tracking option as branch
      if (!officeBranch && parsed.trackingOptions.length > 0) {
        officeBranch = parsed.trackingOptions[0];
      }

      // ── Look up branchId in Central DB ─────────────────────────────────
      let branchId: number | null = null;
      if (officeBranch) {
        const br = await client.query(
          "SELECT id FROM branches WHERE LOWER(name) = LOWER($1) LIMIT 1",
          [officeBranch]
        );
        branchId = br.rows[0]?.id ?? null;
      }

      // ── Calculate dates ────────────────────────────────────────────────
      const creditApprovalDate: string = inv.DateString
        ? new Date(inv.DateString).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];
      const disbursementDate = creditApprovalDate;
      const dueDate = addDays(creditApprovalDate, 42);

      // ── Build Loan Register payload ────────────────────────────────────
      const loanPayload: Record<string, any> = {
        clientSurname:       surname,
        clientGivenName:     givenName,
        telephone:           phone,
        dateOfBirth:         dateOfBirth,
        idPassport:          nationalId,
        loanType:            "HukuPlus",
        creditApprovalDate,
        disbursementDate,
        dueDate,
        term:                42,
        loanAmount:          parsed.loanAmount > 0 ? parsed.loanAmount : parsed.totalAmount,
        loanRaisingFee:      parsed.loanRaisingFee > 0 ? parsed.loanRaisingFee : null,
        accruedInterest:     parsed.accruedInterest > 0 ? parsed.accruedInterest : null,
        totalAmount:         parsed.totalAmount > 0 ? parsed.totalAmount : parsed.loanAmount,
        officeBranch,
        retailer:            officeBranch,
        loanNumber:          inv.InvoiceNumber ?? null,
        extension:           salesRep,
        xeroInvoiceId,
        notes:               `Xero Invoice: ${inv.InvoiceNumber ?? xeroInvoiceId}`,
        status:              "active",
      };

      // ── Push to Loan Register ──────────────────────────────────────────
      const loanRegisterId = await pushToLoanRegister(loanPayload);

      // ── Store locally in agreements (tracking record) ──────────────────
      const signingToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO agreements
           (customer_id, customer_name, customer_phone, loan_product,
            loan_amount, facility_fee_amount, interest_amount, repayment_amount,
            form_type, status, signing_token, expires_at,
            xero_invoice_id, source, dismissed, loan_register_id,
            branch_id, disbursement_date, created_at)
         VALUES
           ($1,$2,$3,'HukuPlus',
            $4,$5,$6,$7,
            'agreement','active',$8,$9,
            $10,'xero_sync',FALSE,$11,
            $12,$13,NOW())
         ON CONFLICT DO NOTHING`,
        [
          customerId,
          `${givenName} ${surname}`.trim() || xeroContactName,
          phone || null,
          parsed.loanAmount > 0 ? parsed.loanAmount : parsed.totalAmount,
          parsed.loanRaisingFee > 0 ? parsed.loanRaisingFee.toFixed(2) : null,
          parsed.accruedInterest > 0 ? parsed.accruedInterest.toFixed(2) : null,
          parsed.totalAmount > 0 ? parsed.totalAmount.toFixed(2) : null,
          signingToken,
          expiresAt,
          xeroInvoiceId,
          loanRegisterId,
          branchId,
          disbursementDate,
        ]
      );

      // ── Update last sync timestamp ─────────────────────────────────────
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('xero_invoice_last_sync', NOW()::TEXT, NOW())
        ON CONFLICT (key) DO UPDATE SET value = NOW()::TEXT, updated_at = NOW()
      `);

      if (loanRegisterId) {
        result.pushed++;
        console.log(
          `[xero-sync] Pushed "${givenName} ${surname}" → Loan Register #${loanRegisterId} (Xero: ${inv.InvoiceNumber})`
        );
      } else {
        // Push failed but still stored locally
        result.errors.push(`Push failed for invoice ${inv.InvoiceNumber} (${xeroContactName})`);
      }
    }

    // Always update last sync timestamp
    await client.query(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('xero_invoice_last_sync', NOW()::TEXT, NOW())
      ON CONFLICT (key) DO UPDATE SET value = NOW()::TEXT, updated_at = NOW()
    `);

    return result;
  } finally {
    client.release();
  }
}
