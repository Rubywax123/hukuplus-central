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
    storeName,
  } = req.body as {
    notificationId: number;
    xeroContactId: string;
    paymentDate: string;
    bankAccountCode: string;
    allocations: Array<{ invoiceId: string; amount: number }>;
    markLoanComplete?: boolean;
    customerId?: number | null;
    creditAmount?: number;
    storeName?: string;
  };

  if (!allocations?.length || !bankAccountCode || !paymentDate) {
    res.status(400).json({ error: "allocations, bankAccountCode, and paymentDate are required" });
    return;
  }

  const auth = await getValidAccessToken();
  if (!auth) { res.status(503).json({ error: "Xero not connected" }); return; }

  const errors: string[] = [];
  const applied: string[] = [];
  let overpaymentPosted = false;
  let overpaymentAmount = 0;
  let overpaymentError: string | null = null;

  // ── STEP 0: Resolve bank AccountID from code ──────────────────────────────────
  // BatchPayments requires the AccountID (UUID) — the Code alone isn't accepted.
  // We MUST filter by Type=="BANK" here to avoid matching a revenue/income account
  // that happens to share the same code (which Xero will reject with a ValidationException).
  let resolvedBankAccountId: string | null = null;
  let resolvedBankAccountName: string | null = null;
  try {
    const acctRes = await fetch(
      `https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22BANK%22%20AND%20Code%3D%3D%22${encodeURIComponent(bankAccountCode)}%22`,
      { headers: xeroHeaders(auth) }
    );
    if (acctRes.ok) {
      const acctData = await acctRes.json();
      const matched = acctData.Accounts?.[0];
      resolvedBankAccountId   = matched?.AccountID ?? null;
      resolvedBankAccountName = matched?.Name ?? null;
      // If no BANK match, try without type filter as a fallback and log a warning
      if (!resolvedBankAccountId) {
        const fallbackRes = await fetch(
          `https://api.xero.com/api.xro/2.0/Accounts?where=Code%3D%3D%22${encodeURIComponent(bankAccountCode)}%22`,
          { headers: xeroHeaders(auth) }
        );
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          const fallback = fallbackData.Accounts?.[0];
          if (fallback) {
            console.warn(`[payment] Code "${bankAccountCode}" matched a non-BANK account (Type=${fallback.Type}, Name=${fallback.Name}) — this will likely fail BatchPayments validation`);
            resolvedBankAccountId   = fallback.AccountID ?? null;
            resolvedBankAccountName = fallback.Name ?? null;
          }
        }
      }
    }
  } catch { /* non-fatal — fall back below */ }

  if (!resolvedBankAccountId) {
    console.error(`[payment] Could not resolve bank AccountID for code "${bankAccountCode}"`);
    res.status(422).json({ error: `Bank account "${bankAccountCode}" not found in Xero. Please verify the account code is correct and the account is a Bank type account.` });
    return;
  }

  console.log(`[payment] Bank account "${bankAccountCode}" (${resolvedBankAccountName}) resolved to AccountID ${resolvedBankAccountId}`);

  // ── Build the flat invoice allocation list ────────────────────────────────────
  const credit = Math.round(((creditAmount ?? 0) > 0.01 ? (creditAmount ?? 0) : 0) * 100) / 100;

  type InvoiceAlloc = { invoiceId: string; amount: number };
  const invoiceAllocs: InvoiceAlloc[] = allocations
    .filter(a => a.amount > 0.005)
    .map(a => ({ invoiceId: a.invoiceId, amount: Math.round(a.amount * 100) / 100 }));

  // Absorb any credit into additional outstanding invoices (oldest first) so the
  // credit-remainder reflects only genuine surplus with no further invoices to cover.
  let creditRemaining = credit;
  const allocatedSet = new Set(invoiceAllocs.map(a => a.invoiceId));

  if (credit > 0.01 && xeroContactId) {
    try {
      const otherInvRes = await fetch(
        `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${xeroContactId}&Statuses=AUTHORISED,PARTIAL&order=Date ASC&pageSize=50`,
        { headers: xeroHeaders(auth) }
      );
      if (otherInvRes.ok) {
        const otherInvData = await otherInvRes.json();
        for (const inv of (otherInvData.Invoices ?? [])) {
          if (creditRemaining <= 0.005) break;
          if (allocatedSet.has(inv.InvoiceID)) continue;
          const due = parseFloat(String(inv.AmountDue ?? 0));
          if (due <= 0.005) continue;
          const apply = Math.min(creditRemaining, due);
          invoiceAllocs.push({ invoiceId: inv.InvoiceID, amount: Math.round(apply * 100) / 100 });
          allocatedSet.add(inv.InvoiceID);
          creditRemaining = Math.round((creditRemaining - apply) * 100) / 100;
        }
      }
    } catch (err: any) {
      console.warn(`[payment] Other-invoice credit lookup failed: ${err.message}`);
    }
  }

  if (invoiceAllocs.length === 0) {
    res.status(400).json({ error: "No valid invoice allocations to post" });
    return;
  }

  // ── Decide the posting strategy ───────────────────────────────────────────────
  // When the customer paid MORE than the sum of outstanding invoices (creditRemaining > 0)
  // the ENTIRE amount must go through a single RECEIVE-OVERPAYMENT, and invoices are
  // allocated FROM that overpayment.  This creates ONE bank transaction for the full
  // payment amount — the correct Xero approach.
  //
  // When the payment exactly matches the invoices (creditRemaining == 0) we use the
  // cheaper BatchPayments call which doesn't need an income AccountCode.

  const useOverpaymentFlow = creditRemaining > 0.01;

  if (useOverpaymentFlow) {
    // ── OVERPAYMENT FLOW ──────────────────────────────────────────────────────
    // Total = sum of all invoice allocations + the true credit remainder
    const invoiceTotal = invoiceAllocs.reduce((s, a) => s + a.amount, 0);
    const fullAmount   = Math.round((invoiceTotal + creditRemaining) * 100) / 100;

    // Resolve AccountCode (required for RECEIVE-OVERPAYMENT line items).
    // Four fallback strategies: invoice line items → recent invoices → REVENUE → SALES.
    let accountCode = "";

    for (const alloc of invoiceAllocs) {
      if (accountCode) break;
      try {
        const invRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${alloc.invoiceId}`, { headers: xeroHeaders(auth) });
        if (invRes.ok) {
          const d = await invRes.json();
          for (const li of (d.Invoices?.[0]?.LineItems ?? [])) {
            if (li.AccountCode) { accountCode = li.AccountCode; break; }
          }
        }
      } catch { /* non-fatal */ }
    }

    if (!accountCode && xeroContactId) {
      try {
        const rRes = await fetch(
          `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${xeroContactId}&Statuses=AUTHORISED,PARTIAL,PAID&order=Date DESC&pageSize=20`,
          { headers: xeroHeaders(auth) }
        );
        if (rRes.ok) {
          for (const inv of ((await rRes.json()).Invoices ?? [])) {
            if (accountCode) break;
            try {
              const sRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, { headers: xeroHeaders(auth) });
              if (sRes.ok) {
                for (const li of ((await sRes.json()).Invoices?.[0]?.LineItems ?? [])) {
                  if (li.AccountCode) { accountCode = li.AccountCode; break; }
                }
              }
            } catch { /* non-fatal */ }
          }
        }
      } catch { /* non-fatal */ }
    }

    for (const type of ["REVENUE", "SALES", "OTHERINCOME"]) {
      if (accountCode) break;
      try {
        const aRes = await fetch(
          `https://api.xero.com/api.xro/2.0/Accounts?where=Type%3D%3D%22${type}%22%20AND%20Status%3D%3D%22ACTIVE%22&pageSize=5`,
          { headers: xeroHeaders(auth) }
        );
        if (aRes.ok) {
          const first = (await aRes.json()).Accounts?.[0];
          if (first?.Code) { accountCode = first.Code; console.log(`[payment] AccountCode fallback: ${type} "${accountCode}" (${first.Name})`); }
        }
      } catch { /* non-fatal */ }
    }

    if (!accountCode) {
      res.status(422).json({ error: `Cannot post a $${fullAmount.toFixed(2)} payment — the payment exceeds the outstanding invoices by $${creditRemaining.toFixed(2)} and no income account code could be found in Xero to post the overpayment. Please contact your Xero administrator or post the payment manually.` });
      return;
    }

    // POST a single RECEIVE-OVERPAYMENT for the full amount
    console.log(`[payment] Overpayment flow: full=$${fullAmount}, invoices=$${invoiceTotal}, credit=$${creditRemaining}, accountCode=${accountCode}`);

    const ovRes = await fetch("https://api.xero.com/api.xro/2.0/Overpayments", {
      method: "PUT",
      headers: xeroHeaders(auth),
      body: JSON.stringify({
        Type: "RECEIVE-OVERPAYMENT",
        Contact: { ContactID: xeroContactId },
        Date: paymentDate,
        BankAccount: { AccountID: resolvedBankAccountId },
        LineAmountTypes: "Inclusive",
        ...(storeName ? { Reference: storeName } : {}),
        LineItems: [{
          Description: `Payment received${storeName ? ` [${storeName}]` : ""}`,
          UnitAmount: fullAmount,
          AccountCode: accountCode,
        }],
      }),
    });

    if (!ovRes.ok) {
      const errText = await ovRes.text();
      console.error(`[payment] RECEIVE-OVERPAYMENT PUT failed (${ovRes.status}): ${errText.slice(0, 400)}`);
      res.status(502).json({ error: `Failed to post payment to Xero (${ovRes.status}): ${errText.slice(0, 200)}` });
      return;
    }

    const ovData = await ovRes.json();
    const overpaymentId: string | undefined = ovData.Overpayments?.[0]?.OverpaymentID;

    if (!overpaymentId) {
      res.status(502).json({ error: "Xero returned no OverpaymentID — cannot allocate invoices." });
      return;
    }

    console.log(`[payment] Overpayment ${overpaymentId} posted for $${fullAmount}, now allocating invoices...`);

    // Allocate each invoice from the overpayment credit
    const allocRes = await fetch(`https://api.xero.com/api.xro/2.0/Overpayments/${overpaymentId}/Allocations`, {
      method: "PUT",
      headers: xeroHeaders(auth),
      body: JSON.stringify({
        Allocations: invoiceAllocs.map(a => ({
          Invoice: { InvoiceID: a.invoiceId },
          Amount: a.amount,
        })),
      }),
    });

    if (allocRes.ok) {
      for (const a of invoiceAllocs) applied.push(a.invoiceId);
      overpaymentPosted = true;
      overpaymentAmount = creditRemaining;
      console.log(`[payment] Allocated ${invoiceAllocs.length} invoice(s) from overpayment, $${creditRemaining} remains as credit`);
    } else {
      const errText = await allocRes.text();
      console.warn(`[payment] Overpayment allocation failed (${allocRes.status}): ${errText.slice(0, 400)}`);
      // The bank transaction exists — partial success; flag but don't fail entirely
      overpaymentError = `Payment of $${fullAmount.toFixed(2)} was received in Xero but invoice allocation failed (${allocRes.status}). Invoices may still appear outstanding — please allocate them manually from the overpayment in Xero. Error: ${errText.slice(0, 120)}`;
    }

  } else {
    // ── BATCH PAYMENT FLOW (exact / under payment — no credit remainder) ──────
    type BatchPaymentEntry = { Invoice: { InvoiceID: string }; Amount: number; Date: string };
    const batchPayments: BatchPaymentEntry[] = invoiceAllocs.map(a => ({
      Invoice: { InvoiceID: a.invoiceId },
      Amount: a.amount,
      Date: paymentDate,
    }));

    const batchRes = await fetch("https://api.xero.com/api.xro/2.0/BatchPayments", {
      method: "PUT",
      headers: xeroHeaders(auth),
      body: JSON.stringify({
        BatchPayments: [{
          Account: { AccountID: resolvedBankAccountId },
          ...(storeName ? { Reference: storeName } : {}),
          Date: paymentDate,
          Payments: batchPayments,
        }],
      }),
    });

    if (!batchRes.ok) {
      const errText = await batchRes.text();
      console.error(`[payment] BatchPayment PUT failed (${batchRes.status}): ${errText.slice(0, 400)}`);
      res.status(502).json({ error: `Failed to post payment to Xero (${batchRes.status}): ${errText.slice(0, 200)}` });
      return;
    }

    const batchData = await batchRes.json();
    console.log(`[payment] BatchPayment posted for contact ${xeroContactId}, ${batchPayments.length} invoice(s), $${batchPayments.reduce((s, p) => s + p.Amount, 0).toFixed(2)}`);

    for (const bp of (batchData.BatchPayments ?? [])) {
      for (const p of (bp.Payments ?? [])) {
        if (p.Invoice?.InvoiceID) applied.push(p.Invoice.InvoiceID);
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
    overpaymentError,
  });
});

export default router;
