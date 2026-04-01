import { Router } from "express";
import { pool } from "@workspace/db";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";

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
    // Search customers by name (fuzzy), also check branch/retailer context
    const nameTerms = customerName.trim().split(/\s+/).filter(Boolean);
    const nameLike = `%${nameTerms.join("%")}%`;

    const custResult = await client.query<{
      id: number; full_name: string; phone: string | null;
      national_id: string | null; xero_contact_id: string | null;
      branch_name: string | null; retailer_name: string | null;
    }>(
      `SELECT DISTINCT c.id, c.full_name, c.phone, c.national_id, c.xero_contact_id,
              b.name AS branch_name, r.name AS retailer_name
       FROM customers c
       LEFT JOIN agreements a ON a.customer_id = c.id
       LEFT JOIN branches b ON b.id = a.branch_id
       LEFT JOIN retailers r ON r.id = a.retailer_id
       WHERE c.full_name ILIKE $1
       ORDER BY c.full_name
       LIMIT 10`,
      [nameLike]
    );

    const customers = custResult.rows;

    // Score by branch/retailer match
    const scored = customers.map(c => {
      let score = 0;
      if (branchName && c.branch_name?.toLowerCase().includes(branchName.toLowerCase())) score += 2;
      if (retailerName && c.retailer_name?.toLowerCase().includes(retailerName.toLowerCase())) score += 1;
      return { ...c, score };
    }).sort((a, b) => b.score - a.score);

    // Fetch Xero invoices for each customer that has a xero_contact_id
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
          invoices = (invData.Invoices ?? []).map((inv: any) => ({
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

    // Also search Xero directly for contacts not in our customers table
    let xeroOnlyResults: any[] = [];
    if (auth) {
      const contactRes = await fetch(
        `https://api.xero.com/api.xro/2.0/Contacts?searchTerm=${encodeURIComponent(customerName)}&summaryOnly=false&pageSize=5`,
        { headers: xeroHeaders(auth) }
      );
      if (contactRes.ok) {
        const contactData = await contactRes.json();
        const knownXeroIds = new Set(results.map(r => r.xeroContactId).filter(Boolean));
        for (const c of (contactData.Contacts ?? [])) {
          if (knownXeroIds.has(c.ContactID)) continue;
          // Fetch invoices for this contact
          const invRes = await fetch(
            `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${c.ContactID}&Statuses=AUTHORISED,PARTIAL&order=Date ASC&pageSize=50`,
            { headers: xeroHeaders(auth) }
          );
          const invData = invRes.ok ? await invRes.json() : {};
          const invoices = (invData.Invoices ?? []).map((inv: any) => ({
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
          xeroOnlyResults.push({
            customerId: null,
            fullName: c.Name,
            phone: c.Phones?.[0]?.PhoneNumber ?? null,
            nationalId: null,
            xeroContactId: c.ContactID,
            branchName: null,
            retailerName: null,
            score: 0,
            invoices,
            totalOutstanding: invoices.reduce((s: number, i: any) => s + (i.amountDue ?? 0), 0),
          });
        }
      }
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
  } = req.body as {
    notificationId: number;
    xeroContactId: string;
    paymentDate: string;
    bankAccountCode: string;
    allocations: Array<{ invoiceId: string; amount: number }>;
    markLoanComplete?: boolean;
    customerId?: number | null;
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

    // Optionally mark the customer's active loan agreement as complete
    if (markLoanComplete && customerId) {
      await client.query(
        `UPDATE agreements SET status = 'completed', updated_at = NOW()
         WHERE customer_id = $1 AND status NOT IN ('completed', 'cancelled')
         ORDER BY created_at DESC LIMIT 1`,
        [customerId]
      );
    }
  } finally {
    client.release();
  }

  res.json({ ok: true, applied, errors });
});

export default router;
