import { Router, Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import crypto from "crypto";

const router = Router();

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID!;
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET!;
const REDIRECT_URI = "https://huku-plus-central.replit.app/api/xero/callback";
const SCOPES = "openid profile email accounting.contacts accounting.transactions offline_access";

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any)?.staffUser) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}

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
        Authorization: `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
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

// GET /xero/auth — initiate OAuth
router.get("/xero/auth", requireAuth, (req: Request, res: Response) => {
  const state = crypto.randomBytes(16).toString("hex");
  (req.session as any).xeroState = state;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
  });

  res.redirect(`https://login.xero.com/identity/connect/authorize?${params}`);
});

// GET /xero/callback — handle OAuth callback
router.get("/xero/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query;

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
      Authorization: `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code as string,
      redirect_uri: REDIRECT_URI,
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
router.get("/xero/status", requireAuth, async (req: Request, res: Response) => {
  const tokens = await getXeroTokens();
  if (!tokens) return res.json({ connected: false });
  res.json({
    connected: true,
    tenantName: tokens.tenant_name,
    expiresAt: tokens.expires_at,
  });
});

// POST /xero/disconnect
router.post("/xero/disconnect", requireAuth, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM xero_tokens");
    res.json({ success: true });
  } finally {
    client.release();
  }
});

// GET /xero/contacts/search?q=...
router.get("/xero/contacts/search", requireAuth, async (req: Request, res: Response) => {
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
router.get("/xero/customer/:customerId/data", requireAuth, async (req: Request, res: Response) => {
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

export default router;
