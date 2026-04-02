import { pool } from "@workspace/db";
import crypto from "crypto";

const XERO_BASE = "https://api.xero.com/api.xro/2.0";

// ─── Shared Xero auth helpers ─────────────────────────────────────────────────

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

// ─── Line-item parsing helpers ────────────────────────────────────────────────

interface ParsedLoanLines {
  loanAmount: number;
  feeAmount: number;
  interestAmount: number;
  repaymentAmount: number;
  trackingOptions: string[];
}

function parseLoanLineItems(lineItems: any[]): ParsedLoanLines {
  let loanAmount = 0;
  let feeAmount = 0;
  let interestAmount = 0;
  const trackingOptions: string[] = [];

  for (const li of lineItems) {
    const desc = (li.Description || "").toLowerCase();
    const amount = parseFloat(String(li.LineAmount ?? 0)) || 0;

    if (desc.includes("loan") || desc.includes("principal")) {
      loanAmount += amount;
    } else if (
      desc.includes("fee") ||
      desc.includes("facilit") ||
      desc.includes("admin")
    ) {
      feeAmount += amount;
    } else if (
      desc.includes("interest") ||
      desc.includes("42 day") ||
      desc.includes("42day")
    ) {
      interestAmount += amount;
    } else if (loanAmount === 0 && feeAmount === 0 && interestAmount === 0) {
      loanAmount += amount;
    }

    for (const t of li.Tracking ?? []) {
      if (t.Option) trackingOptions.push((t.Option as string).trim());
    }
  }

  const repaymentAmount = loanAmount + feeAmount + interestAmount;
  return { loanAmount, feeAmount, interestAmount, repaymentAmount, trackingOptions };
}

// ─── Main sync function ───────────────────────────────────────────────────────

export interface SyncXeroResult {
  checked: number;
  created: number;
  skipped: number;
  errors: string[];
}

export async function syncXeroInvoices(): Promise<SyncXeroResult> {
  const result: SyncXeroResult = { checked: 0, created: 0, skipped: 0, errors: [] };

  const auth = await getValidAccessToken();
  if (!auth) {
    result.errors.push("Xero not connected — please reconnect in Settings.");
    return result;
  }

  const client = await pool.connect();
  try {
    // ── Fetch known HukuPlus branch names from DB ─────────────────────────
    const branchRows = await client.query(
      `SELECT LOWER(b.name) AS name
       FROM branches b
       JOIN retailers r ON r.id = b.retailer_id
       WHERE LOWER(r.name) LIKE '%hukuplus%'
          OR LOWER(r.name) LIKE '%huku plus%'`
    );
    const hukuplusBranches = new Set<string>(branchRows.rows.map((r: any) => r.name));

    // Also fetch xero_contact_ids of known customers so we can match by contact
    const contactRows = await client.query(
      `SELECT id, xero_contact_id, full_name FROM customers
       WHERE xero_contact_id IS NOT NULL AND xero_contact_id != ''`
    );
    const contactMap = new Map<string, { id: number; name: string }>();
    for (const r of contactRows.rows) {
      contactMap.set((r.xero_contact_id as string).toLowerCase(), {
        id: r.id,
        name: r.full_name,
      });
    }

    // ── Fetch AUTHORISED ACCREC invoices from Xero (last 90 days) ─────────
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const invoiceRes = await fetch(
      `${XERO_BASE}/Invoices?Type=ACCREC&Statuses=AUTHORISED,PARTIAL&ModifiedAfter=${since}&includeArchived=false`,
      { headers: xeroHeaders(auth) }
    );

    if (!invoiceRes.ok) {
      const body = await invoiceRes.text();
      result.errors.push(`Xero invoice fetch failed: ${invoiceRes.status} — ${body.slice(0, 200)}`);
      return result;
    }

    const invoiceData = await invoiceRes.json() as any;
    const invoices: any[] = invoiceData.Invoices ?? [];
    result.checked = invoices.length;

    for (const inv of invoices) {
      const xeroInvoiceId: string = inv.InvoiceID;
      const lineItems: any[] = inv.LineItems ?? [];

      // ── Identify HukuPlus invoices ─────────────────────────────────────
      // A HukuPlus invoice has tracking options matching our known branches
      // OR the contact is a known HukuPlus customer.
      const parsed = parseLoanLineItems(lineItems);

      const hasHukuPlusTracking =
        parsed.trackingOptions.some((opt) => {
          const lower = opt.toLowerCase();
          return (
            lower.includes("hukuplus") ||
            lower.includes("huku plus") ||
            hukuplusBranches.has(lower)
          );
        });

      const contactId: string = (inv.Contact?.ContactID ?? "").toLowerCase();
      const contactMatch = contactMap.get(contactId);
      const hasKnownContact = !!contactMatch;

      if (!hasHukuPlusTracking && !hasKnownContact) {
        result.skipped++;
        continue;
      }

      // Must have at least one non-zero loan amount line item
      if (parsed.loanAmount <= 0 && parsed.repaymentAmount <= 0) {
        result.skipped++;
        continue;
      }

      // ── Deduplicate by xero_invoice_id ─────────────────────────────────
      const existing = await client.query(
        "SELECT id FROM agreements WHERE xero_invoice_id = $1",
        [xeroInvoiceId]
      );
      if (existing.rows.length > 0) {
        result.skipped++;
        continue;
      }

      // ── Resolve customer details ────────────────────────────────────────
      const customerName: string = inv.Contact?.Name ?? "Unknown Customer";
      const customerId: number | null = contactMatch?.id ?? null;

      // Resolve branch name from tracking options
      let branchName: string | null = null;
      for (const opt of parsed.trackingOptions) {
        if (
          opt.toLowerCase().includes("hukuplus") ||
          opt.toLowerCase().includes("huku plus") ||
          hukuplusBranches.has(opt.toLowerCase())
        ) {
          branchName = opt;
          break;
        }
        // Use the first tracking option as branch if no HukuPlus-specific one found
        if (!branchName) branchName = opt;
      }

      // Look up branchId from name
      let branchId: number | null = null;
      if (branchName) {
        const br = await client.query(
          "SELECT id FROM branches WHERE LOWER(name) = LOWER($1) LIMIT 1",
          [branchName]
        );
        branchId = br.rows[0]?.id ?? null;
      }

      // ── Create agreement record ─────────────────────────────────────────
      const signingToken = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const invoiceDate = inv.DateString
        ? new Date(inv.DateString).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];

      await client.query(
        `INSERT INTO agreements
           (customer_id, customer_name, loan_product, loan_amount,
            facility_fee_amount, interest_amount, repayment_amount,
            form_type, status, signing_token, expires_at,
            xero_invoice_id, source, dismissed, branch_id,
            disbursement_date, created_at)
         VALUES
           ($1,$2,'HukuPlus',$3,$4,$5,$6,
            'agreement','active',$7,$8,
            $9,'xero_sync',FALSE,$10,
            $11,NOW())`,
        [
          customerId,
          customerName,
          parsed.loanAmount > 0 ? parsed.loanAmount : parsed.repaymentAmount,
          parsed.feeAmount > 0 ? parsed.feeAmount.toFixed(2) : null,
          parsed.interestAmount > 0 ? parsed.interestAmount.toFixed(2) : null,
          parsed.repaymentAmount > 0 ? parsed.repaymentAmount.toFixed(2) : null,
          signingToken,
          expiresAt,
          xeroInvoiceId,
          branchId,
          invoiceDate,
        ]
      );

      // ── Update last sync timestamp in settings ─────────────────────────
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('xero_invoice_last_sync', NOW()::TEXT, NOW())
        ON CONFLICT (key) DO UPDATE SET value = NOW()::TEXT, updated_at = NOW()
      `);

      result.created++;
      console.log(`[xero-sync] Created agreement for "${customerName}" — invoice ${inv.InvoiceNumber}`);
    }

    // Always update last sync timestamp even if nothing new
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
