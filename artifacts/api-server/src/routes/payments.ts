import { Router } from "express";
import { pool } from "@workspace/db";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";
import { updateLoanRegisterStatus } from "../lib/syncXeroInvoices";

const router = Router();

// ─── Token helper (re-uses xero token logic) ──────────────────────────────────

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
      const data = await res.json();
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

function mapInvoices(invoices: any[]) {
  return invoices.map((inv: any) => ({
    invoiceId: inv.InvoiceID,
    invoiceNumber: inv.InvoiceNumber,
    status: inv.Status,
    date: inv.DateString,
    dueDate: inv.DueDateString,
    total: inv.Total,
    amountDue: inv.AmountDue,
    amountPaid: inv.AmountPaid,
    reference: inv.Reference,
  }));
}

// Simple character-level Sørensen–Dice coefficient for scoring Xero-only candidates
function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const bg = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg2 = s.slice(i, i + 2);
      bg.set(bg2, (bg.get(bg2) ?? 0) + 1);
    }
    return bg;
  };
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  let intersection = 0;
  for (const [gram, count] of aGrams) {
    intersection += Math.min(count, bGrams.get(gram) ?? 0);
  }
  return (2 * intersection) / (a.length + b.length - 2);
}

// ─── GET /api/payments/bank-accounts ─────────────────────────────────────────

router.get("/payments/bank-accounts", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {

  const auth = await getValidAccessToken();
  if (!auth) { res.status(503).json({ error: "Xero not connected" }); return; }

  const r = await fetch(
    `https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22BANK%22`,
    { headers: xeroHeaders(auth) }
  );

  if (!r.ok) { res.status(502).json({ error: "Xero bank accounts fetch failed" }); return; }

  const data = await r.json();
  const accounts = (data.Accounts ?? []).map((a: any) => ({
    accountId: a.AccountID,
    code: a.Code,
    name: a.Name,
    currencyCode: a.CurrencyCode,
  }));

  res.json(accounts);
});

// ─── POST /api/payments/match-customer ───────────────────────────────────────
// Find matching customers for a payment notification and fetch their Xero invoices

router.post("/payments/match-customer", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {

  const { customerName, branchName, retailerName } = req.body as {
    customerName: string;
    branchName?: string;
    retailerName?: string;
  };

  if (!customerName?.trim()) { res.status(400).json({ error: "customerName is required" }); return; }

  const client = await pool.connect();
  try {
    const nameTokens = customerName.trim().split(/\s+/).filter(Boolean);
    const surname    = nameTokens[nameTokens.length - 1] ?? customerName.trim();
    const firstName  = nameTokens[0] ?? "";
    // ILIKE patterns for loose matching
    const allTokensLike = `%${nameTokens.join("%")}%`;
    const surnameLike   = `%${surname}%`;

    // ── Local DB: trigram similarity + surname ILIKE fallback ──────────────
    const custResult = await client.query<{
      id: number; full_name: string; phone: string | null;
      national_id: string | null; xero_contact_id: string | null;
      branch_name: string | null; retailer_name: string | null;
      sim: number;
    }>(
      `SELECT DISTINCT c.id, c.full_name, c.phone, c.national_id, c.xero_contact_id,
              b.name AS branch_name, r.name AS retailer_name,
              similarity(c.full_name, $1) AS sim
       FROM customers c
       LEFT JOIN agreements a ON a.customer_id = c.id
       LEFT JOIN branches b ON b.id = a.branch_id
       LEFT JOIN retailers r ON r.id = a.retailer_id
       WHERE
         -- trigram similarity (handles typos / missing letters)
         similarity(c.full_name, $1) > 0.2
         -- OR all tokens appear in any order
         OR (c.full_name ILIKE $2)
         -- OR the surname alone appears (catches first-name-only mismatches)
         OR (c.full_name ILIKE $3)
       ORDER BY sim DESC
       LIMIT 12`,
      [customerName.trim(), allTokensLike, surnameLike]
    );

    // Score: similarity + branch/retailer context
    const scored = custResult.rows.map(c => {
      let score = parseFloat(String(c.sim ?? 0)) * 10; // 0–10 from trigram
      if (branchName   && c.branch_name?.toLowerCase().includes(branchName.toLowerCase()))   score += 3;
      if (retailerName && c.retailer_name?.toLowerCase().includes(retailerName.toLowerCase())) score += 2;
      // Boost exact surname match
      if (c.full_name.toLowerCase().includes(surname.toLowerCase())) score += 1;
      return { ...c, score };
    }).sort((a, b) => b.score - a.score).slice(0, 10);

    // Fetch Xero invoices for each locally-matched customer that has a Xero link
    const auth = await getValidAccessToken();

    const results = await Promise.all(scored.map(async c => {
      let invoices: any[] = [];
      if (c.xero_contact_id && auth) {
        const invRes = await fetch(
          `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${c.xero_contact_id}&Statuses=AUTHORISED,PARTIAL&order=Date ASC&pageSize=50`,
          { headers: xeroHeaders(auth) }
        );
        if (invRes.ok) {
          const invData = await invRes.json();
          invoices = mapInvoices(invData.Invoices ?? []);
        }
      }
      return {
        customerId: c.id,
        fullName: c.full_name,
        phone: c.phone,
        nationalId: c.national_id,
        xeroContactId: c.xero_contact_id,
        branchName: c.branch_name,
        retailerName: c.retailer_name,
        score: c.score,
        invoices,
        totalOutstanding: invoices.reduce((s: number, i: any) => s + (i.amountDue ?? 0), 0),
      };
    }));

    // ── Xero direct search: run 3 terms in parallel ─────────────────────────
    // 1. Full name  2. Surname only  3. First name only (if multi-word)
    let xeroOnlyResults: any[] = [];
    if (auth) {
      const searchTerms = Array.from(new Set([
        customerName.trim(),       // e.g. "Kassimu Matora"
        surname,                   // e.g. "Matora"
        ...(nameTokens.length > 1 ? [firstName] : []),  // e.g. "Kassimu"
      ]));

      const knownXeroIds = new Set(results.map(r => r.xeroContactId).filter(Boolean));
      const xeroContacts: any[] = [];

      await Promise.all(searchTerms.map(async term => {
        try {
          const contactRes = await fetch(
            `https://api.xero.com/api.xro/2.0/Contacts?searchTerm=${encodeURIComponent(term)}&summaryOnly=false&pageSize=10`,
            { headers: xeroHeaders(auth) }
          );
          if (!contactRes.ok) return;
          const data = await contactRes.json();
          for (const c of (data.Contacts ?? [])) {
            if (!knownXeroIds.has(c.ContactID) && !xeroContacts.some(x => x.ContactID === c.ContactID)) {
              xeroContacts.push(c);
              knownXeroIds.add(c.ContactID);
            }
          }
        } catch { /* non-fatal */ }
      }));

      // Fetch invoices for each new Xero contact
      xeroOnlyResults = (await Promise.all(xeroContacts.map(async c => {
        try {
          const invRes = await fetch(
            `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${c.ContactID}&Statuses=AUTHORISED,PARTIAL&order=Date ASC&pageSize=50`,
            { headers: xeroHeaders(auth) }
          );
          const invData = invRes.ok ? await invRes.json() : {};
          const invoices = mapInvoices(invData.Invoices ?? []);
          // Rough similarity score vs the search name so best matches float up
          const sim = stringSimilarity(customerName.trim().toLowerCase(), (c.Name ?? "").toLowerCase());
          return {
            customerId: null,
            fullName: c.Name,
            phone: c.Phones?.[0]?.PhoneNumber ?? null,
            nationalId: null,
            xeroContactId: c.ContactID,
            branchName: null,
            retailerName: null,
            score: sim * 5, // 0–5 range
            invoices,
            totalOutstanding: invoices.reduce((s: number, i: any) => s + (i.amountDue ?? 0), 0),
          };
        } catch { return null; }
      }))).filter(Boolean);

      xeroOnlyResults.sort((a: any, b: any) => b.score - a.score);
    }

    res.json({ candidates: [...results, ...xeroOnlyResults] });
  } finally {
    client.release();
  }
});

// ─── POST /api/payments/process ──────────────────────────────────────────────

router.post("/payments/process", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {

  const {
    notificationId,
    xeroContactId,
    paymentDate,
    bankAccountCode,
    allocations,   // [{ invoiceId, amount }]
    markLoanComplete,
    customerId,
    creditAmount,  // Any payment remainder after invoice allocations
  } = req.body as {
    notificationId: number;
    xeroContactId: string;
    paymentDate: string;
    bankAccountCode: string;
    allocations: Array<{ invoiceId: string; amount: number }>;
    markLoanComplete?: boolean;
    customerId?: number | null;
    creditAmount?: number;
  };

  if (!allocations?.length || !bankAccountCode || !paymentDate) {
    res.status(400).json({ error: "allocations, bankAccountCode, and paymentDate are required" });
    return;
  }

  const auth = await getValidAccessToken();
  if (!auth) { res.status(503).json({ error: "Xero not connected" }); return; }

  const errors: string[] = [];
  const applied: string[] = [];

  // Apply each allocation as a Xero payment
  for (const alloc of allocations) {
    if (!alloc.amount || alloc.amount <= 0) continue;

    const payload = {
      Invoice: { InvoiceID: alloc.invoiceId },
      Account: { Code: bankAccountCode },
      Date: paymentDate,
      Amount: alloc.amount,
    };

    const r = await fetch("https://api.xero.com/api.xro/2.0/Payments", {
      method: "POST",
      headers: xeroHeaders(auth),
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      applied.push(alloc.invoiceId);
    } else {
      const errText = await r.text();
      errors.push(`Invoice ${alloc.invoiceId}: ${r.status} — ${errText.slice(0, 200)}`);
    }
  }

  // ── Handle credit amount: apply to other outstanding invoices, then Overpayment ─
  let overpaymentPosted = false;
  let overpaymentAmount = 0;

  if (creditAmount && creditAmount > 0.01 && xeroContactId && bankAccountCode) {
    const appliedSet = new Set(allocations.map(a => a.invoiceId));
    let creditRemaining = Math.round(creditAmount * 100) / 100;

    // Step 1: apply credit to any other outstanding invoices (oldest first)
    try {
      const otherInvRes = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${xeroContactId}&Statuses=AUTHORISED,PARTIAL&order=Date ASC&pageSize=50`,
        { headers: xeroHeaders(auth) }
      );
      if (otherInvRes.ok) {
        const otherInvData = await otherInvRes.json();
        const otherInvoices = (otherInvData.Invoices ?? []).filter(
          (inv: any) => !appliedSet.has(inv.InvoiceID) && parseFloat(String(inv.AmountDue ?? 0)) > 0.005
        );
        for (const inv of otherInvoices) {
          if (creditRemaining <= 0.005) break;
          const amountDue = parseFloat(String(inv.AmountDue ?? 0));
          const apply = Math.min(creditRemaining, amountDue);
          const payRes = await fetch("https://api.xero.com/api.xro/2.0/Payments", {
            method: "POST",
            headers: xeroHeaders(auth),
            body: JSON.stringify({
              Invoice: { InvoiceID: inv.InvoiceID },
              Account: { Code: bankAccountCode },
              Date: paymentDate,
              Amount: Math.round(apply * 100) / 100,
            }),
          });
          if (payRes.ok) {
            creditRemaining = Math.round((creditRemaining - apply) * 100) / 100;
            applied.push(inv.InvoiceID);
          } else {
            const errText = await payRes.text();
            errors.push(`Credit to invoice ${inv.InvoiceNumber ?? inv.InvoiceID}: ${errText.slice(0, 120)}`);
          }
        }
      }
    } catch (err: any) {
      console.warn(`[payment] Credit invoice application failed: ${err.message}`);
    }

    // Step 2: any remaining credit → Xero Overpayment (credit balance on account)
    if (creditRemaining > 0.01) {
      // Determine account code from first processed invoice
      let accountCode = "";
      if (applied.length > 0) {
        try {
          const firstInvRes = await fetch(
            `https://api.xero.com/api.xro/2.0/Invoices/${applied[0]}`,
            { headers: xeroHeaders(auth) }
          );
          if (firstInvRes.ok) {
            const firstInvData = await firstInvRes.json();
            accountCode = firstInvData.Invoices?.[0]?.LineItems?.[0]?.AccountCode ?? "";
          }
        } catch { /* non-fatal */ }
      }

      if (!accountCode) {
        errors.push(`Credit of $${creditRemaining.toFixed(2)} could not be posted as Overpayment — no account code available. Please post manually in Xero.`);
      } else {
        const ovRes = await fetch("https://api.xero.com/api.xro/2.0/Overpayments", {
          method: "POST",
          headers: xeroHeaders(auth),
          body: JSON.stringify({
            Type: "RECEIVE-OVERPAYMENT",
            Contact: { ContactID: xeroContactId },
            Date: paymentDate,
            BankAccount: { Code: bankAccountCode },
            LineAmountTypes: "Inclusive",
            LineItems: [{
              Description: "Customer credit — overpayment",
              UnitAmount: creditRemaining,
              AccountCode: accountCode,
            }],
          }),
        });
        if (ovRes.ok) {
          overpaymentPosted = true;
          overpaymentAmount = creditRemaining;
        } else {
          const errText = await ovRes.text();
          errors.push(`Overpayment credit of $${creditRemaining.toFixed(2)} failed: ${errText.slice(0, 200)}. Post manually in Xero.`);
        }
      }
    }
  }

  // ── Re-fetch applied invoices from Xero to detect fully-paid ones ────────────
  const autoCompletedLoanRegisterIds: number[] = [];
  const fullyPaidInvoiceIds: string[] = [];
  // Map invoiceId → total amount paid (for recording paymentsReceived on the Loan Register)
  const fullyPaidAmounts = new Map<string, number>();

  if (applied.length > 0) {
    for (const invoiceId of applied) {
      try {
        const invRes = await fetch(
          `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`,
          { headers: xeroHeaders(auth) }
        );
        if (invRes.ok) {
          const invData = await invRes.json() as any;
          const inv = invData.Invoices?.[0];
          if (inv && parseFloat(String(inv.AmountDue ?? 1)) === 0) {
            fullyPaidInvoiceIds.push(invoiceId);
            // Record the total paid — AmountPaid is the accumulated amount across all payments
            const totalPaid = parseFloat(String(inv.AmountPaid ?? inv.Total ?? 0)) || 0;
            if (totalPaid > 0) fullyPaidAmounts.set(invoiceId, totalPaid);
          }
        }
      } catch {
        // Non-fatal — skip
      }
    }
  }

  const client = await pool.connect();
  try {
    if (errors.length > 0 && applied.length === 0) {
      // Total failure — leave notification as "new" so admin can retry; record the error
      await client.query(
        `UPDATE formitize_notifications
         SET processing_error = $1, updated_at = NOW()
         WHERE id = $2`,
        [errors.join(" | ").slice(0, 1000), notificationId]
      );
      res.status(502).json({ error: "All Xero payments failed", details: errors });
      return;
    }

    // At least some payments applied — mark as actioned and record timestamp
    const errorSummary = errors.length > 0 ? errors.join(" | ").slice(0, 1000) : null;
    await client.query(
      `UPDATE formitize_notifications
       SET status = 'actioned', processed_at = NOW(), processing_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [errorSummary, notificationId]
    );

    // Auto-complete Loan Register entries for fully-paid invoices
    for (const invoiceId of fullyPaidInvoiceIds) {
      try {
        const agResult = await client.query(
          `SELECT id, loan_register_id, repayment_amount, loan_amount, facility_fee_amount, interest_amount
           FROM agreements WHERE xero_invoice_id = $1 LIMIT 1`,
          [invoiceId]
        );
        const ag = agResult.rows[0];
        if (ag?.loan_register_id) {
          // Determine amount paid: use Xero's AmountPaid, fallback to repayment_amount from DB
          const xeroPaid = fullyPaidAmounts.get(invoiceId) ?? 0;
          const dbTotal =
            parseFloat(String(ag.repayment_amount ?? 0)) ||
            (parseFloat(String(ag.loan_amount ?? 0)) +
             parseFloat(String(ag.facility_fee_amount ?? 0)) +
             parseFloat(String(ag.interest_amount ?? 0)));
          const paymentsReceived = xeroPaid > 0 ? xeroPaid : dbTotal;

          const ok = await updateLoanRegisterStatus(ag.loan_register_id, "completed", paymentsReceived || undefined);
          if (ok) {
            autoCompletedLoanRegisterIds.push(ag.loan_register_id);
            await client.query(
              `UPDATE agreements SET status = 'completed', updated_at = NOW() WHERE id = $1`,
              [ag.id]
            );
            console.log(`[payment] Auto-completed Loan Register #${ag.loan_register_id} (invoice ${invoiceId}, paid $${paymentsReceived})`);
          }
        }
      } catch (err: any) {
        console.warn(`[payment] Auto-complete check failed for ${invoiceId}: ${err.message}`);
      }
    }

    // Optionally mark the customer's most recent active loan agreement as complete (manual override)
    if (markLoanComplete && customerId) {
      const agResult = await client.query(
        `SELECT id, loan_register_id, repayment_amount, loan_amount, facility_fee_amount, interest_amount
         FROM agreements
         WHERE customer_id = $1
           AND status NOT IN ('completed', 'cancelled')
         ORDER BY created_at DESC
         LIMIT 1`,
        [customerId]
      );
      const ag = agResult.rows[0];
      if (ag) {
        await client.query(
          `UPDATE agreements SET status = 'completed', updated_at = NOW() WHERE id = $1`,
          [ag.id]
        );
        if (ag.loan_register_id && !autoCompletedLoanRegisterIds.includes(ag.loan_register_id)) {
          const dbTotal =
            parseFloat(String(ag.repayment_amount ?? 0)) ||
            (parseFloat(String(ag.loan_amount ?? 0)) +
             parseFloat(String(ag.facility_fee_amount ?? 0)) +
             parseFloat(String(ag.interest_amount ?? 0)));
          const ok = await updateLoanRegisterStatus(ag.loan_register_id, "completed", dbTotal || undefined);
          if (ok) {
            autoCompletedLoanRegisterIds.push(ag.loan_register_id);
            console.log(`[payment] Manual-complete Loan Register #${ag.loan_register_id} (paid $${dbTotal})`);
          }
        }
      }
    }
  } finally {
    client.release();
  }

  res.json({
    ok: true,
    applied,
    errors,
    autoCompleted: autoCompletedLoanRegisterIds.length > 0,
    autoCompletedLoanRegisterIds,
    overpaymentPosted,
    overpaymentAmount,
  });
});

export default router;
