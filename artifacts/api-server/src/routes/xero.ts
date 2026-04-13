import { Router, Request, Response } from "express";
import { pool } from "@workspace/db";
import crypto from "crypto";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";
import { syncXeroInvoices } from "../lib/syncXeroInvoices";

const router = Router();

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID!;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET!;
const REDIRECT_URI = "https://huku-plus-central.replit.app/api/xero/callback";
const SCOPES = "openid profile email accounting.contacts accounting.transactions offline_access";

// ─── Token storage helpers ────────────────────────────────────────────────────

async function getXeroTokens() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT * FROM xero_tokens WHERE id = 1");
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function saveXeroTokens(tokens: {
  access_token: string;
  refresh_token: string;
  tenant_id: string;
  tenant_name: string;
  expires_at: Date;
}) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO xero_tokens (id, access_token, refresh_token, tenant_id, tenant_name, expires_at, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (id) DO UPDATE SET
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         tenant_id = EXCLUDED.tenant_id,
         tenant_name = EXCLUDED.tenant_name,
         expires_at = EXCLUDED.expires_at,
         updated_at = NOW()`,
      [tokens.access_token, tokens.refresh_token, tokens.tenant_id, tokens.tenant_name, tokens.expires_at]
    );
  } finally {
    client.release();
  }
}

// ─── Token refresh ────────────────────────────────────────────────────────────

async function getValidAccessToken(): Promise<{ accessToken: string; tenantId: string } | null> {
  const tokens = await getXeroTokens();
  if (!tokens) return null;

  const expiresAt = new Date(tokens.expires_at);
  const now = new Date();

  if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: XERO_CLIENT_ID,
        client_secret: XERO_CLIENT_SECRET,
      }),
    });

    if (!response.ok) {
      console.error("[xero] Token refresh failed:", await response.text());
      return null;
    }

    const data = await response.json();
    await saveXeroTokens({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokens.refresh_token,
      tenant_id: tokens.tenant_id,
      tenant_name: tokens.tenant_name,
      expires_at: new Date(Date.now() + data.expires_in * 1000),
    });

    return { accessToken: data.access_token, tenantId: tokens.tenant_id };
  }

  return { accessToken: tokens.access_token, tenantId: tokens.tenant_id };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /xero/auth — initiate OAuth (admin only)
router.get("/xero/auth", requireStaffAuth, requireSuperAdmin, (req: Request, res: Response) => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state: "hukupluscentral",
  });

  res.redirect(`https://login.xero.com/identity/connect/authorize?${params}`);
});

// GET /xero/callback — handle OAuth callback
router.get("/xero/callback", async (req: Request, res: Response) => {
  const { code, error } = req.query;

  if (error) {
    console.error("[xero] OAuth error:", error);
    return res.redirect("/?xero=error");
  }

  if (!code) {
    return res.redirect("/?xero=error");
  }

  const tokenResponse = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: REDIRECT_URI,
      client_id: XERO_CLIENT_ID,
      client_secret: XERO_CLIENT_SECRET,
    }),
  });

  if (!tokenResponse.ok) {
    console.error("[xero] Token exchange failed:", await tokenResponse.text());
    return res.redirect("/?xero=error");
  }

  const tokenData = await tokenResponse.json();

  const tenantsResponse = await fetch("https://api.xero.com/connections", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
  });

  if (!tenantsResponse.ok) {
    console.error("[xero] Tenants fetch failed:", await tenantsResponse.text());
    return res.redirect("/?xero=error");
  }

  const tenants = await tenantsResponse.json();
  const tenant = tenants[0];

  if (!tenant) {
    return res.redirect("/?xero=error");
  }

  await saveXeroTokens({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    tenant_id: tenant.tenantId,
    tenant_name: tenant.tenantName,
    expires_at: new Date(Date.now() + tokenData.expires_in * 1000),
  });

  console.log(`[xero] Connected to tenant: ${tenant.tenantName}`);
  res.redirect("/?xero=connected");
});

// GET /xero/status
router.get("/xero/status", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const tokens = await getXeroTokens();
    if (!tokens) return res.json({ connected: false });
    res.json({
      connected: true,
      tenantName: tokens.tenant_name,
      expiresAt: tokens.expires_at,
    });
  } catch (err: any) {
    console.error("[xero] Status check error:", err.message);
    res.json({ connected: false });
  }
});

// POST /xero/disconnect
router.post("/xero/disconnect", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM xero_tokens");
    res.json({ success: true });
  } finally {
    client.release();
  }
});

// GET /xero/contacts/search?q=...
router.get("/xero/contacts/search", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const q = ((req.query.q as string) || "").trim();
  if (!q || q.length < 2) return res.json([]);

  const auth = await getValidAccessToken();
  if (!auth) return res.status(401).json({ error: "Xero not connected" });

  try {
    const where = encodeURIComponent(`Name.Contains("${q}")`);
    const response = await fetch(
      `https://api.xero.com/api.xro/2.0/Contacts?where=${where}&summaryOnly=true&pageSize=20`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Xero-tenant-id": auth.tenantId,
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("[xero] Contact search failed:", await response.text());
      return res.status(500).json({ error: "Xero search failed" });
    }

    const data = await response.json();
    const contacts = (data.Contacts || []).map((c: any) => ({
      contactId: c.ContactID,
      name: c.Name,
      email: c.EmailAddress || null,
      status: c.ContactStatus,
    }));

    res.json(contacts);
  } catch (err: any) {
    console.error("[xero] Contact search error:", err.message);
    res.status(500).json({ error: "Search failed" });
  }
});

// GET /xero/customer/:customerId/data
router.get("/xero/customer/:customerId/data", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const client = await pool.connect();
  let xeroContactId: string | null = null;
  try {
    const result = await client.query(
      "SELECT xero_contact_id FROM customers WHERE id = $1",
      [req.params.customerId]
    );
    xeroContactId = result.rows[0]?.xero_contact_id || null;
  } finally {
    client.release();
  }

  if (!xeroContactId) return res.json({ linked: false });

  const auth = await getValidAccessToken();
  if (!auth) return res.status(401).json({ error: "Xero not connected" });

  try {
    const [contactRes, invoicesRes] = await Promise.all([
      fetch(`https://api.xero.com/api.xro/2.0/Contacts/${xeroContactId}`, {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Xero-tenant-id": auth.tenantId,
          Accept: "application/json",
        },
      }),
      fetch(
        `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${xeroContactId}&order=Date DESC&pageSize=20`,
        {
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            "Xero-tenant-id": auth.tenantId,
            Accept: "application/json",
          },
        }
      ),
    ]);

    const contactData = contactRes.ok ? await contactRes.json() : null;
    const invoiceData = invoicesRes.ok ? await invoicesRes.json() : null;

    const contact = contactData?.Contacts?.[0] || null;
    const invoices = (invoiceData?.Invoices || []).map((inv: any) => ({
      invoiceId: inv.InvoiceID,
      invoiceNumber: inv.InvoiceNumber,
      type: inv.Type,
      status: inv.Status,
      date: inv.DateString,
      dueDate: inv.DueDateString,
      total: inv.Total,
      amountDue: inv.AmountDue,
      amountPaid: inv.AmountPaid,
      currencyCode: inv.CurrencyCode,
    }));

    const totalOutstanding = invoices
      .filter((i: any) => ["AUTHORISED", "PARTIAL"].includes(i.status))
      .reduce((sum: number, i: any) => sum + (i.amountDue || 0), 0);

    res.json({
      linked: true,
      xeroContactId,
      contactName: contact?.Name || null,
      contactEmail: contact?.EmailAddress || null,
      invoices,
      totalOutstanding,
    });
  } catch (err: any) {
    console.error("[xero] Data fetch error:", err.message);
    res.status(500).json({ error: "Xero data fetch failed" });
  }
});

// ─── POST /xero/sync-invoices — manual trigger ────────────────────────────────
router.post("/xero/sync-invoices", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const result = await syncXeroInvoices();
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error("[xero] Manual invoice sync failed:", err.message);
    res.status(500).json({ error: "Sync failed", detail: err.message });
  }
});

// ─── GET /xero/pending-invoices — recent Xero invoices with import status ────
// Returns last 30 days of ACCREC invoices showing which are already imported
// into the Loan Register (via agreements table) and which are still pending.
router.get("/xero/pending-invoices", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const auth = await getValidAccessToken();
  if (!auth) return res.status(401).json({ error: "Xero not connected" });

  const client = await pool.connect();
  try {
    // Fetch all known xero_invoice_ids from agreements table
    const agrResult = await client.query(
      "SELECT xero_invoice_id, loan_register_id, status FROM agreements WHERE xero_invoice_id IS NOT NULL"
    );
    const importedSet = new Map<string, { loanRegisterId: number | null; status: string }>();
    for (const row of agrResult.rows) {
      importedSet.set(row.xero_invoice_id as string, {
        loanRegisterId: row.loan_register_id,
        status: row.status,
      });
    }

    // Fetch recent invoices from Xero (last 30 days)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const invoiceRes = await fetch(
      `https://api.xero.com/api.xro/2.0/Invoices?Type=ACCREC&Statuses=AUTHORISED,PARTIAL,PAID&ModifiedAfter=${since}&includeArchived=false`,
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Xero-tenant-id": auth.tenantId,
          Accept: "application/json",
        },
      }
    );
    if (!invoiceRes.ok) {
      return res.status(502).json({ error: `Xero fetch failed: ${invoiceRes.status}` });
    }
    const invoiceData = await invoiceRes.json() as any;
    const invoices: any[] = (invoiceData.Invoices ?? [])
      .filter((inv: any) => inv.Type === "ACCREC" && (inv.Total ?? 0) > 0)
      .sort((a: any, b: any) => {
        // Most recent first
        const da = a.DateString ?? a.Date ?? "";
        const db = b.DateString ?? b.Date ?? "";
        return db.localeCompare(da);
      });

    const result = invoices.map((inv: any) => {
      const imported = importedSet.get(inv.InvoiceID);
      return {
        invoiceId:     inv.InvoiceID,
        invoiceNumber: inv.InvoiceNumber ?? "",
        contactName:   inv.Contact?.Name ?? "",
        date:          inv.DateString ?? inv.Date ?? "",
        dueDate:       inv.DueDateString ?? inv.DueDate ?? "",
        total:         inv.Total ?? 0,
        amountDue:     inv.AmountDue ?? 0,
        xeroStatus:    inv.Status ?? "",
        imported:      !!imported,
        lrStatus:      imported?.status ?? null,
        tracking:      (inv.LineItems?.[0]?.Tracking ?? []).map((t: any) => t.Option).join(" · "),
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error("[xero] pending-invoices error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── GET /xero/tracking-categories — all active categories + options ──────────
router.get("/xero/tracking-categories", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const auth = await getValidAccessToken();
  if (!auth) { res.status(503).json({ error: "Xero not connected" }); return; }

  try {
    const r = await fetch(
      "https://api.xero.com/api.xro/2.0/TrackingCategories?includeArchived=false",
      {
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          "Xero-tenant-id": auth.tenantId,
          Accept: "application/json",
        },
      }
    );
    if (!r.ok) { res.status(502).json({ error: "Xero fetch failed" }); return; }
    const data = await r.json();
    const categories = (data.TrackingCategories ?? []).map((cat: any) => ({
      id: cat.TrackingCategoryID,
      name: cat.Name,
      options: (cat.Options ?? [])
        .filter((o: any) => o.Status === "ACTIVE")
        .map((o: any) => ({ id: o.TrackingOptionID, name: o.Name })),
    }));
    res.json(categories);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /xero/sync-invoices/status — last sync timestamp + counts ────────────
router.get("/xero/sync-invoices/status", requireStaffAuth, requireSuperAdmin, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const tsResult = await client.query(
      "SELECT value FROM system_settings WHERE key = 'xero_invoice_last_sync'"
    );
    const countResult = await client.query(
      "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE dismissed = FALSE AND status = 'active') AS active FROM agreements WHERE source = 'xero_sync'"
    );
    res.json({
      lastSync: tsResult.rows[0]?.value ?? null,
      totalSynced: parseInt(countResult.rows[0]?.total ?? "0", 10),
      activeSynced: parseInt(countResult.rows[0]?.active ?? "0", 10),
    });
  } finally {
    client.release();
  }
});

export default router;

