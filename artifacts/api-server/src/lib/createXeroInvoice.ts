import { db, pool, activityTable } from "@workspace/db";

const XERO_BASE = "https://api.xero.com/api.xro/2.0";

// ─── Xero auth (mirrors syncXeroInvoices pattern) ─────────────────────────────

async function getXeroAuth(): Promise<{ accessToken: string; tenantId: string } | null> {
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
      if (!res.ok) {
        console.warn("[xero-invoice] Token refresh failed:", await res.text());
        return null;
      }
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

// ─── Find or resolve Xero contact ─────────────────────────────────────────────

async function findXeroContactId(
  auth: { accessToken: string; tenantId: string },
  customerName: string,
): Promise<string | null> {
  try {
    const searchName = encodeURIComponent(customerName.trim());
    const res = await fetch(`${XERO_BASE}/Contacts?SearchTerm=${searchName}&includeArchived=false`, {
      headers: xeroHeaders(auth),
    });
    if (!res.ok) {
      console.warn("[xero-invoice] Contact search failed:", res.status);
      return null;
    }
    const data = await res.json() as any;
    const contacts: any[] = data.Contacts ?? [];
    if (contacts.length > 0) {
      return contacts[0].ContactID ?? null;
    }
    return null;
  } catch (err: any) {
    console.warn("[xero-invoice] Contact search error:", err.message);
    return null;
  }
}

// ─── Find tracking category option matching retailer + branch ─────────────────

interface TrackingOption {
  categoryName: string;
  optionName: string;
}

async function findTrackingOption(
  auth: { accessToken: string; tenantId: string },
  retailerName: string,
  branchName: string,
): Promise<TrackingOption | null> {
  try {
    const res = await fetch(`${XERO_BASE}/TrackingCategories?includeArchived=false`, {
      headers: xeroHeaders(auth),
    });
    if (!res.ok) {
      console.warn("[xero-invoice] TrackingCategories fetch failed:", res.status);
      return null;
    }
    const data = await res.json() as any;
    const categories: any[] = data.TrackingCategories ?? [];

    const norm = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, "");
    const retailerNorm = norm(retailerName);
    const branchNorm   = norm(branchName);

    for (const cat of categories) {
      if (cat.Status === "ARCHIVED") continue;
      const options: any[] = cat.Options ?? [];
      for (const opt of options) {
        if (opt.Status === "ARCHIVED") continue;
        const optNorm = norm(opt.Name ?? "");
        // Match if option contains both retailer and branch, or retailer alone
        if (optNorm.includes(retailerNorm) || optNorm.includes(branchNorm)) {
          return { categoryName: cat.Name, optionName: opt.Name };
        }
      }
    }
    console.warn(`[xero-invoice] No tracking option found for "${retailerName}" / "${branchName}"`);
    return null;
  } catch (err: any) {
    console.warn("[xero-invoice] TrackingCategories error:", err.message);
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface CreateXeroInvoiceInput {
  agreementId: number;
  customerName: string;
  customerPhone?: string | null;
  loanAmount: number;
  facilityFeeAmount?: number | null;
  interestAmount?: number | null;
  retailerName?: string | null;
  branchName?: string | null;
}

export interface CreateXeroInvoiceResult {
  ok: boolean;
  xeroInvoiceId?: string;
  xeroInvoiceNumber?: string;
  error?: string;
}

export async function createXeroInvoice(input: CreateXeroInvoiceInput): Promise<CreateXeroInvoiceResult> {
  const auth = await getXeroAuth();
  if (!auth) {
    return { ok: false, error: "Xero not connected" };
  }

  const {
    agreementId,
    customerName,
    loanAmount,
    facilityFeeAmount,
    interestAmount,
    retailerName,
    branchName,
  } = input;

  // 1. Find customer contact
  const contactId = await findXeroContactId(auth, customerName);

  // 2. Find tracking category option
  let tracking: { Name: string; Option: string }[] = [];
  if (retailerName) {
    const opt = await findTrackingOption(auth, retailerName, branchName ?? "");
    if (opt) {
      tracking = [{ Name: opt.categoryName, Option: opt.optionName }];
    }
  }

  // 3. Build line items
  const todayStr = new Date().toISOString().split("T")[0];
  const reference = `$${parseFloat(String(loanAmount)).toFixed(0)}`;

  const lineItems: any[] = [
    {
      Description: "HukuPlus Loan",
      Quantity: 1.0,
      UnitAmount: parseFloat(String(loanAmount)) || 0,
      AccountCode: "621",
      ...(tracking.length > 0 ? { Tracking: tracking } : {}),
    },
  ];

  if (facilityFeeAmount && parseFloat(String(facilityFeeAmount)) > 0) {
    lineItems.push({
      Description: "Facility Fee",
      Quantity: 1.0,
      UnitAmount: parseFloat(String(facilityFeeAmount)),
      AccountCode: "202",
      ...(tracking.length > 0 ? { Tracking: tracking } : {}),
    });
  }

  if (interestAmount && parseFloat(String(interestAmount)) > 0) {
    lineItems.push({
      Description: "42 days interest",
      Quantity: 1.0,
      UnitAmount: parseFloat(String(interestAmount)),
      AccountCode: "201",
      ...(tracking.length > 0 ? { Tracking: tracking } : {}),
    });
  }

  // 4. Create invoice in Xero (SUBMITTED = Awaiting Approval)
  const invoicePayload = {
    Invoices: [
      {
        Type: "ACCREC",
        Status: "SUBMITTED",
        Contact: contactId ? { ContactID: contactId } : { Name: customerName },
        Date: todayStr,
        Reference: reference,
        LineAmountTypes: "EXCLUSIVE",
        LineItems: lineItems,
      },
    ],
  };

  try {
    const res = await fetch(`${XERO_BASE}/Invoices`, {
      method: "POST",
      headers: xeroHeaders(auth),
      body: JSON.stringify(invoicePayload),
    });

    const raw = await res.text();
    let data: any;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!res.ok) {
      const errMsg = data?.Elements?.[0]?.ValidationErrors?.[0]?.Message
        ?? data?.Message
        ?? raw.slice(0, 300);
      console.error(`[xero-invoice] Invoice creation failed (${res.status}) for agreement #${agreementId}: ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    const created = data.Invoices?.[0];
    const xeroInvoiceId: string = created?.InvoiceID ?? "";
    const xeroInvoiceNumber: string = created?.InvoiceNumber ?? "";

    if (!xeroInvoiceId) {
      return { ok: false, error: "No InvoiceID returned from Xero" };
    }

    // 5. Store invoice ID back on the agreement record
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE agreements SET xero_invoice_id = $1 WHERE id = $2`,
        [xeroInvoiceId, agreementId]
      );
    } finally {
      client.release();
    }

    console.log(`[xero-invoice] Created Xero invoice ${xeroInvoiceNumber} (${xeroInvoiceId}) for agreement #${agreementId} — ${customerName}`);

    // Log to Central activity feed
    await db.insert(activityTable).values({
      type: "xero_invoice_raised",
      description: `Xero invoice ${xeroInvoiceNumber} raised for ${customerName} — ${reference}`,
      loanProduct: "HukuPlus",
      referenceId: agreementId,
      ...(retailerName ? { retailerName } : {}),
      ...(branchName  ? { branchName  } : {}),
    }).catch((e: any) => console.warn("[xero-invoice] Activity log failed:", e.message));

    return { ok: true, xeroInvoiceId, xeroInvoiceNumber };
  } catch (err: any) {
    console.error(`[xero-invoice] Unexpected error for agreement #${agreementId}:`, err.message);
    return { ok: false, error: err.message };
  }
}
