import { db, pool, activityTable } from "@workspace/db";
import { getXeroAuth, xeroHeaders } from "./xeroAuth";

const XERO_BASE = "https://api.xero.com/api.xro/2.0";

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

    // Pass 1 — prefer options that contain BOTH retailer AND branch (e.g. "Profeeds Mazowe")
    for (const cat of categories) {
      if (cat.Status === "ARCHIVED") continue;
      for (const opt of (cat.Options ?? []) as any[]) {
        if (opt.Status === "ARCHIVED") continue;
        const optNorm = norm(opt.Name ?? "");
        if (
          optNorm.includes(retailerNorm) &&
          branchNorm.length > 0 &&
          optNorm.includes(branchNorm)
        ) {
          return { categoryName: cat.Name, optionName: opt.Name };
        }
      }
    }

    // Pass 2 — fall back to retailer-only match (e.g. "Profeeds" when branch unknown)
    for (const cat of categories) {
      if (cat.Status === "ARCHIVED") continue;
      for (const opt of (cat.Options ?? []) as any[]) {
        if (opt.Status === "ARCHIVED") continue;
        const optNorm = norm(opt.Name ?? "");
        if (optNorm.includes(retailerNorm)) {
          console.warn(
            `[xero-invoice] Exact branch match not found for "${branchName}" — ` +
            `falling back to "${opt.Name}" (retailer-only match).`
          );
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
  const dueDate = new Date(Date.now() + 42 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
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
        DueDate: dueDate,
        Reference: reference,
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
