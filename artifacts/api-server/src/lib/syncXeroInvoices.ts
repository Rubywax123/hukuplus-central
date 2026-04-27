import { pool } from "@workspace/db";
import crypto from "crypto";
import { getXeroAuth, xeroHeaders } from "./xeroAuth";

const XERO_BASE = "https://api.xero.com/api.xro/2.0";
const LOAN_REGISTER_URL =
  process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
// HUKUPLUS_API_KEY authenticates Central → Loan Register calls (read-only).
// CENTRAL_API_KEY is Central's own inbound API key — do NOT use it for LR calls.
const HUKUPLUS_API_KEY = process.env.HUKUPLUS_API_KEY;

// ─── Xero auth helpers ────────────────────────────────────────────────────────
// Centralised in lib/xeroAuth.ts — getXeroAuth + xeroHeaders imported above.

async function getValidAccessToken() {
  return getXeroAuth();
}

// ─── Loan Register API helpers ────────────────────────────────────────────────

function loanRegHeaders() {
  return {
    "Content-Type": "application/json",
    ...(HUKUPLUS_API_KEY ? {
      Authorization: `Bearer ${HUKUPLUS_API_KEY}`,
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

export async function updateLoanRegister(
  loanRegisterId: number,
  updates: Record<string, any>
): Promise<boolean> {
  const res = await fetch(`${LOAN_REGISTER_URL}/api/loans/${loanRegisterId}`, {
    method: "PUT",
    headers: loanRegHeaders(),
    body: JSON.stringify(updates),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[loan-register] Update failed (${res.status}): ${body.slice(0, 200)}`);
    return false;
  }
  return true;
}

export async function updateLoanRegisterStatus(
  loanRegisterId: number,
  status: "completed" | "active",
  paymentsReceived?: number
): Promise<boolean> {
  const updates: Record<string, any> = { status };
  if (paymentsReceived != null && paymentsReceived > 0) {
    updates.paymentsReceived = paymentsReceived;
  }
  // When completing a loan, always set balanceOwing to 0 (fully paid)
  if (status === "completed") {
    updates.balanceOwing = 0;
  }
  return updateLoanRegister(loanRegisterId, updates);
}

// ─── Backfill paid amounts for all completed loans in the Loan Register ────────
// DISABLED — Loan Register is READ-ONLY from Central.
export async function backfillCompletedLoanPayments(): Promise<{ updated: number; skipped: number; errors: string[] }> {
  const result = { updated: 0, skipped: 0, errors: ["LR is read-only from Central — backfill disabled"] as string[] };
  console.warn("[sync:xero-invoices] backfillCompletedLoanPayments is disabled: LR is read-only.");
  return result;
  // Dead code below kept for reference only:
  const _result = { updated: 0, skipped: 0, errors: [] as string[] };

  let page = 1;
  const pageSize = 100;

  while (true) {
    let loans: any[];
    try {
      const r = await fetch(
        `${LOAN_REGISTER_URL}/api/loans?status=completed&page=${page}&limit=${pageSize}`,
        { headers: loanRegHeaders() }
      );
      if (!r.ok) {
        result.errors.push(`Loan Register list failed (${r.status}) on page ${page}`);
        break;
      }
      loans = await r.json() as any[];
      if (!Array.isArray(loans) || loans.length === 0) break;
    } catch (err: any) {
      result.errors.push(`Fetch error page ${page}: ${err.message}`);
      break;
    }

    for (const loan of loans) {
      const paid = parseFloat(String(loan.paymentsReceived ?? 0)) || 0;
      if (paid > 0) {
        result.skipped++;
        continue;
      }

      const loanAmt  = parseFloat(String(loan.loanAmount ?? 0)) || 0;
      const fee      = parseFloat(String(loan.loanRaisingFee ?? 0)) || 0;
      const interest = parseFloat(String(loan.accruedInterest ?? 0)) || 0;
      const total    = loanAmt + fee + interest;

      if (total <= 0) {
        result.skipped++;
        continue;
      }

      try {
        const ok = await updateLoanRegister(loan.id, { paymentsReceived: total, balanceOwing: 0 });
        if (ok) {
          result.updated++;
        } else {
          result.errors.push(`Failed to update loan #${loan.id}`);
        }
      } catch (err: any) {
        result.errors.push(`Error updating loan #${loan.id}: ${err.message}`);
      }
    }

    if (loans.length < pageSize) break;
    page++;
  }

  return result;
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
  completed: number;
  errors: string[];
}

export async function syncXeroInvoices(): Promise<SyncXeroResult> {
  const result: SyncXeroResult = { checked: 0, pushed: 0, skipped: 0, completed: 0, errors: [] };

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
    // Use FULL ISO timestamp (not just date) so each 5-min sync window only
    // fetches invoices changed since the previous run, not all of today.
    // Subtract 2 min buffer to avoid missing invoices at the boundary.
    // Fall back to 7 days if no prior sync (first run or fresh deploy).
    let since: string;
    try {
      const lastSyncRow = await client.query(
        `SELECT value FROM system_settings WHERE key = 'xero_invoice_last_sync'`
      );
      if (lastSyncRow.rows[0]?.value) {
        // Parse stored value — may be PostgreSQL text format "2026-04-06 10:00:00+00"
        // or our new ISO format "2026-04-06T10:00:00Z".  Normalise the separator.
        const raw = (lastSyncRow.rows[0].value as string).replace(" ", "T");
        const lastSyncMs = new Date(raw).getTime();
        if (isNaN(lastSyncMs)) {
          // Unparseable — fall back to 7 days
          since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        } else {
          since = new Date(lastSyncMs - 2 * 60 * 1000).toISOString();
        }
      } else {
        since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      }
    } catch {
      since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    }

    // ── Paginate through all matching Xero invoices ───────────────────────
    // Xero returns max 100 per page. Without pagination the sync silently
    // misses invoices that fall past the first 100.
    const invoices: any[] = [];
    let page = 1;
    while (true) {
      const invoiceRes = await fetch(
        `${XERO_BASE}/Invoices?Type=ACCREC&Statuses=AUTHORISED,PARTIAL&ModifiedAfter=${encodeURIComponent(since)}&includeArchived=false&page=${page}`,
        { headers: xeroHeaders(auth) }
      );
      if (!invoiceRes.ok) {
        const body = await invoiceRes.text();
        result.errors.push(`Xero invoice fetch failed (${invoiceRes.status}) page ${page}: ${body.slice(0, 200)}`);
        break;
      }
      const invoiceData = await invoiceRes.json() as any;
      const pageInvoices: any[] = invoiceData.Invoices ?? [];
      invoices.push(...pageInvoices);
      if (pageInvoices.length < 100) break; // last page
      page++;
    }
    result.checked = invoices.length;

    // ── Build a Map of all existing Loan Register loan numbers ────────────────
    // Used as a secondary dedup check — guards against the case where the local
    // agreements table has been cleared but the Loan Register still has entries.
    // Keyed by both "INV-XXXX" and "XXXX" (normalised without prefix).
    const lrLoanNumberMap = new Map<string, { id: number }>();
    try {
      const lrAllRes = await fetch(
        `${LOAN_REGISTER_URL}/api/loans?status=active&limit=5000`,
        {
          headers: {
            Authorization: `Bearer ${HUKUPLUS_API_KEY}`,
            "X-Central-System": "HukuPlusCentral",
          },
        }
      );
      if (lrAllRes.ok) {
        const lrAll: any[] = await lrAllRes.json();
        for (const loan of Array.isArray(lrAll) ? lrAll : []) {
          if (loan.loanNumber) {
            const num = String(loan.loanNumber);
            lrLoanNumberMap.set(num, { id: loan.id });
            // Also index without INV- prefix so both forms match
            const normNum = num.replace(/^INV-/i, "");
            if (normNum !== num) lrLoanNumberMap.set(normNum, { id: loan.id });
          }
        }
      }
    } catch {
      // Non-fatal — continue without secondary dedup if LR fetch fails
    }

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

      // ── Secondary dedup: check pre-fetched LR loan number Map ────────────
      // Guards against DB resets: if the agreements table was cleared but the
      // Loan Register still has the entry, lrLoanNumberMap catches it.
      const invoiceNumber: string = inv.InvoiceNumber ?? "";
      if (invoiceNumber && lrLoanNumberMap.size > 0) {
        const normInv = invoiceNumber.replace(/^INV-/i, "");
        const existingLrLoan = lrLoanNumberMap.get(invoiceNumber) ?? lrLoanNumberMap.get(normInv);
        if (existingLrLoan) {
          try {
            await client.query(
              `INSERT INTO agreements
                (xero_invoice_id, source, loan_register_id, customer_name, status, created_at)
               VALUES ($1, 'xero_sync', $2, $3, 'active', NOW())`,
              [xeroInvoiceId, existingLrLoan.id, inv.Contact?.Name ?? ""]
            );
          } catch {
            // Duplicate xero_invoice_id — already recorded, nothing to do
          }
          result.skipped++;
          console.log(
            `[sync:xero-invoices] Secondary dedup: ${invoiceNumber} already in Loan Register as #${existingLrLoan.id}, recorded agreement.`
          );
          continue;
        }
      }

      // ── Check for an unlinked Formitize agreement for the same customer ──
      // When the Formitize webhook fires before Xero approval, it creates an
      // agreement with no xero_invoice_id. Rather than duplicating, link it.
      let existingFormitizeAgreementId: number | null = null;
      if (contactId) {
        const fzCheck = await client.query(
          `SELECT a.id FROM agreements a
           JOIN customers c ON c.id = a.customer_id
           WHERE c.xero_contact_id ILIKE $1
             AND (a.xero_invoice_id IS NULL OR a.xero_invoice_id = '')
             AND a.source = 'formitize'
             AND a.created_at > NOW() - INTERVAL '30 days'
           ORDER BY a.created_at DESC
           LIMIT 1`,
          [contactId]
        );
        existingFormitizeAgreementId = fzCheck.rows[0]?.id ?? null;
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

      // ── LR is READ-ONLY from Central — do NOT push ────────────────────
      // The Loan Register is managed directly; Central only reads it for
      // reporting. All LR write calls have been removed.

      // ── Store locally in agreements (tracking record) ──────────────────
      // If a Formitize agreement already exists for this customer (webhook
      // fired before Xero approval), link it rather than creating a duplicate.
      if (existingFormitizeAgreementId) {
        await client.query(
          `UPDATE agreements SET
             xero_invoice_id     = $1,
             loan_amount         = COALESCE(loan_amount, $2),
             facility_fee_amount = COALESCE(facility_fee_amount, $3),
             interest_amount     = COALESCE(interest_amount, $4),
             repayment_amount    = COALESCE(repayment_amount, $5),
             disbursement_date   = COALESCE(disbursement_date, $6),
             branch_id           = COALESCE(branch_id, $7)
           WHERE id = $8`,
          [
            xeroInvoiceId,
            parsed.loanAmount > 0 ? parsed.loanAmount : parsed.totalAmount,
            parsed.loanRaisingFee > 0 ? parsed.loanRaisingFee.toFixed(2) : null,
            parsed.accruedInterest > 0 ? parsed.accruedInterest.toFixed(2) : null,
            parsed.totalAmount > 0 ? parsed.totalAmount.toFixed(2) : null,
            disbursementDate,
            branchId,
            existingFormitizeAgreementId,
          ]
        );
        console.log(
          `[sync:xero-invoices] Linked Formitize agreement #${existingFormitizeAgreementId} → Xero ${invoiceNumber}`
        );
      } else {
        const signingToken = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        await client.query(
          `INSERT INTO agreements
             (customer_id, customer_name, customer_phone, loan_product,
              loan_amount, facility_fee_amount, interest_amount, repayment_amount,
              form_type, status, signing_token, expires_at,
              xero_invoice_id, source, dismissed,
              branch_id, disbursement_date, created_at)
           VALUES
             ($1,$2,$3,'HukuPlus',
              $4,$5,$6,$7,
              'agreement','active',$8,$9,
              $10,'xero_sync',FALSE,
              $11,$12,NOW())
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
            branchId,
            disbursementDate,
          ]
        );
      }
      result.pushed++;
      console.log(
        `[sync:xero-invoices] Tracked "${givenName} ${surname}" locally (Xero: ${inv.InvoiceNumber})`
      );
    }

    // ── Detect PAID invoices → mark agreements as completed ───────────────────
    // The main loop above only fetches AUTHORISED/PARTIAL invoices. When a
    // customer pays their invoice in Xero, the status changes to PAID and the
    // invoice drops out of that query — so payments are never detected.
    // This second pass fetches PAID invoices modified in the same window and
    // marks any matching local agreement as completed.
    try {
      const paidInvoices: any[] = [];
      let paidPage = 1;
      while (true) {
        const paidRes = await fetch(
          `${XERO_BASE}/Invoices?Type=ACCREC&Statuses=PAID&ModifiedAfter=${encodeURIComponent(since)}&includeArchived=false&page=${paidPage}`,
          { headers: xeroHeaders(auth) }
        );
        if (!paidRes.ok) {
          result.errors.push(`Xero PAID invoice fetch failed (${paidRes.status}) page ${paidPage}`);
          break;
        }
        const paidData = await paidRes.json() as any;
        const pageInvoices: any[] = paidData.Invoices ?? [];
        paidInvoices.push(...pageInvoices);
        if (pageInvoices.length < 100) break;
        paidPage++;
      }

      for (const inv of paidInvoices) {
        const xeroInvoiceId: string = inv.InvoiceID;
        const invNumber: string = inv.InvoiceNumber ?? xeroInvoiceId;

        // Look up matching agreement in Central's DB
        const agRow = await client.query(
          `SELECT id, status FROM agreements WHERE xero_invoice_id = $1 LIMIT 1`,
          [xeroInvoiceId]
        );

        if (agRow.rows.length === 0) {
          // No local record yet — will be created on next new-invoice sync if relevant
          continue;
        }

        const ag = agRow.rows[0];
        if (ag.status === "completed") {
          // Already marked completed — nothing to do
          continue;
        }

        // Sum all payments on this invoice (Xero may have multiple payments)
        const payments: any[] = inv.Payments ?? [];
        const totalPaid = payments.reduce((sum: number, p: any) => {
          return sum + (parseFloat(String(p.Amount ?? 0)) || 0);
        }, 0);

        const paidAmount = totalPaid > 0 ? totalPaid : (parseFloat(String(inv.Total ?? 0)) || 0);

        await client.query(
          `UPDATE agreements
           SET status       = 'completed',
               completed_at = COALESCE(completed_at, NOW())
           WHERE id = $1`,
          [ag.id]
        );

        result.completed++;
        console.log(
          `[sync:xero-invoices] PAID detected: ${invNumber} → agreement #${ag.id} marked completed (paid $${paidAmount.toFixed(2)})`
        );
      }
    } catch (paidErr: any) {
      result.errors.push(`PAID invoice detection error: ${paidErr.message}`);
    }

    // Always update last sync timestamp
    await client.query(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('xero_invoice_last_sync', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), NOW())
      ON CONFLICT (key) DO UPDATE SET value = to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), updated_at = NOW()
    `);

    return result;
  } finally {
    client.release();
  }
}
