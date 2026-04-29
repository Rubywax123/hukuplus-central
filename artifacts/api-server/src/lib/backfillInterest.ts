import { pool } from "@workspace/db";
import { getXeroAuth, xeroHeaders } from "./xeroAuth";

const XERO_BASE = "https://api.xero.com/api.xro/2.0";
const LR_URL = process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
const LR_KEY = process.env.HUKUPLUS_API_KEY;

// ─── backfillMissingInterest ──────────────────────────────────────────────────
// Runs on a schedule. Finds HukuPlus agreements that have a Xero invoice but
// no interest amount stored yet, looks them up in the Loan Register by their
// Xero invoice ID, calculates the interest, and patches the invoice directly.
//
// The LR takes an unknown amount of time to create its entry after we raise the
// invoice — potentially hours. This job closes that gap without requiring manual
// intervention for every new agreement.

export async function backfillMissingInterest(): Promise<{
  checked: number;
  patched: number;
  skipped: number;
  errors: string[];
}> {
  const result = { checked: 0, patched: 0, skipped: 0, errors: [] as string[] };

  // 1. Find all HukuPlus agreements that have a Xero invoice but still no interest
  const { rows: pending } = await pool.query<{
    id: number;
    xero_invoice_id: string;
    loan_amount: string;
    facility_fee_amount: string | null;
    customer_name: string;
  }>(
    `SELECT id, xero_invoice_id, loan_amount, facility_fee_amount, customer_name
     FROM agreements
     WHERE xero_invoice_id IS NOT NULL
       AND interest_amount IS NULL
       AND loan_product = 'HukuPlus'
       AND status NOT IN ('completed', 'dropped')
     ORDER BY created_at DESC
     LIMIT 50`
  );

  if (pending.length === 0) return result;
  result.checked = pending.length;

  // 2. Fetch the full LR loan list once — match by xeroInvoiceId
  const lrHdrs: Record<string, string> = { "Content-Type": "application/json" };
  if (LR_KEY) {
    lrHdrs["Authorization"] = `Bearer ${LR_KEY}`;
    lrHdrs["X-Central-System"] = "HukuPlusCentral";
  }

  let lrLoans: any[] = [];
  try {
    const lrRes = await fetch(`${LR_URL}/api/central/loans`, { headers: lrHdrs });
    if (!lrRes.ok) {
      result.errors.push(`LR fetch failed (${lrRes.status})`);
      return result;
    }
    const lrData = await lrRes.json() as any;
    lrLoans = Array.isArray(lrData) ? lrData : (lrData.loans ?? lrData.data ?? []);
  } catch (err: any) {
    result.errors.push(`LR fetch error: ${err.message}`);
    return result;
  }

  if (lrLoans.length === 0) {
    result.errors.push("LR returned 0 loans");
    return result;
  }

  // Build a fast lookup map: xeroInvoiceId → loan
  const lrByXeroId = new Map<string, any>();
  for (const loan of lrLoans) {
    if (loan.xeroInvoiceId) {
      lrByXeroId.set(String(loan.xeroInvoiceId), loan);
    }
  }

  // 3. Get Xero auth once — needed if we patch
  const auth = await getXeroAuth();
  if (!auth) {
    result.errors.push("Xero not connected");
    return result;
  }

  // 4. For each pending agreement, try to find and patch interest
  for (const ag of pending) {
    const lrLoan = lrByXeroId.get(ag.xero_invoice_id);
    if (!lrLoan) {
      result.skipped++;
      continue;
    }

    // Derive interest: totalAmount − loanAmount − loanRaisingFee
    const total    = parseFloat(String(lrLoan.totalAmount    ?? 0)) || 0;
    const principal = parseFloat(String(lrLoan.loanAmount    ?? ag.loan_amount)) || 0;
    const fee       = parseFloat(String(lrLoan.loanRaisingFee ?? ag.facility_fee_amount ?? 0)) || 0;
    const interest  = Math.round((total - principal - fee) * 100) / 100;

    if (interest <= 0) {
      result.skipped++;
      continue;
    }

    try {
      // Fetch the live Xero invoice
      const getRes = await fetch(`${XERO_BASE}/Invoices/${ag.xero_invoice_id}`, {
        headers: { ...xeroHeaders(auth), Accept: "application/json" },
      });
      if (!getRes.ok) {
        result.errors.push(`GET invoice ${ag.xero_invoice_id} failed (${getRes.status})`);
        result.skipped++;
        continue;
      }
      const getJson = await getRes.json() as any;
      const inv = getJson.Invoices?.[0];
      if (!inv) { result.skipped++; continue; }

      // Skip if already paid/voided/deleted
      if (["PAID", "VOIDED", "DELETED"].includes(inv.Status ?? "")) {
        result.skipped++;
        continue;
      }

      // Skip if interest line already present
      const existingLines: any[] = inv.LineItems ?? [];
      if (existingLines.some((l: any) =>
        l.AccountCode === "201" ||
        String(l.Description ?? "").toLowerCase().includes("interest")
      )) {
        // Already has interest — just save the amount we derived if not stored
        const derivedFee = fee > 0 ? fee : null;
        await pool.query(
          `UPDATE agreements SET interest_amount = $1, facility_fee_amount = COALESCE(facility_fee_amount, $2) WHERE id = $3`,
          [String(interest), derivedFee ? String(derivedFee) : null, ag.id]
        );
        result.skipped++;
        continue;
      }

      // Append interest line to existing line items
      const updatedLines = [
        ...existingLines.map((l: any) => ({
          Description: l.Description,
          Quantity: l.Quantity,
          UnitAmount: l.UnitAmount,
          AccountCode: l.AccountCode,
          ...(l.Tracking?.length > 0 ? { Tracking: l.Tracking } : {}),
        })),
        {
          Description: "42 days interest",
          Quantity: 1.0,
          UnitAmount: interest,
          AccountCode: "201",
        },
      ];

      const patchRes = await fetch(`${XERO_BASE}/Invoices/${ag.xero_invoice_id}`, {
        method: "POST",
        headers: xeroHeaders(auth),
        body: JSON.stringify({ Invoices: [{ InvoiceID: ag.xero_invoice_id, LineItems: updatedLines }] }),
      });

      if (patchRes.ok) {
        // Persist to DB
        await pool.query(
          `UPDATE agreements
           SET interest_amount     = $1,
               facility_fee_amount = COALESCE(facility_fee_amount, $2)
           WHERE id = $3`,
          [String(interest), fee > 0 ? String(fee) : null, ag.id]
        );
        console.log(
          `[backfill:interest] Patched ${ag.xero_invoice_id} (agreement #${ag.id} — ${ag.customer_name}) — interest $${interest}`
        );
        result.patched++;
      } else {
        const errText = await patchRes.text();
        result.errors.push(`PATCH ${ag.xero_invoice_id} failed: ${errText.slice(0, 150)}`);
        result.skipped++;
      }
    } catch (err: any) {
      result.errors.push(`Agreement #${ag.id}: ${err.message}`);
      result.skipped++;
    }
  }

  return result;
}
