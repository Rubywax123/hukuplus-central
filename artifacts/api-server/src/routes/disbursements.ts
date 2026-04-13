import { Router } from "express";
import { pool } from "@workspace/db";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";

const router = Router();

// ─── Static bank account list ──────────────────────────────────────────────────
// Each maps to a Xero account code. Petty Cash is always available as a fallback.
const BANK_ACCOUNTS = [
  { code: "101", name: "Profeeds",    retailerMatch: "profeeds"  },
  { code: "102", name: "Novafeeds",   retailerMatch: "novafeeds" },
  { code: "104", name: "Gain",        retailerMatch: "gain"      },
  { code: "106", name: "Petty Cash",  retailerMatch: null        },
  { code: "108", name: "Feedmix",     retailerMatch: "feedmix"   },
];

// ─── Token helper ─────────────────────────────────────────────────────────────

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

// ─── GET /api/disbursements/bank-accounts ─────────────────────────────────────
// Returns the static bank account list. The retailerMatch field lets the UI
// auto-select the right account based on the notification's retailer_name.

router.get("/disbursements/bank-accounts", requireStaffAuth, requireSuperAdmin, (_req, res): void => {
  res.json({ bankAccounts: BANK_ACCOUNTS });
});

// ─── POST /api/disbursements/process ──────────────────────────────────────────
// Creates a Xero "Spend Money" bank transaction (account 621 — Loans Disbursed),
// marks the notification as actioned, and records the Xero transaction ID.

router.post("/disbursements/process", requireStaffAuth, requireSuperAdmin, async (req, res): Promise<void> => {
  const {
    notificationId,
    xeroContactId,
    customerName,
    loanAmount,
    disbursementDate,
    bankAccountCode,
    description,
    storeName,
  } = req.body;

  if (!notificationId || !xeroContactId || !loanAmount || !bankAccountCode) {
    res.status(400).json({ error: "notificationId, xeroContactId, loanAmount, and bankAccountCode are required" });
    return;
  }

  const amount = parseFloat(loanAmount);
  if (isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: "Invalid loan amount" });
    return;
  }

  const auth = await getValidAccessToken();
  if (!auth) {
    res.status(503).json({ error: "Xero not connected. Please reconnect via Settings." });
    return;
  }

  const storeLabel = storeName ? ` [${storeName}]` : "";
  const lineDescription = description || `Loan disbursement — ${customerName || "Customer"}${storeLabel}`;
  const txDate = disbursementDate || new Date().toISOString().split("T")[0];

  const bankTxPayload = {
    Type: "SPEND",
    Contact: { ContactID: xeroContactId },
    Date: txDate,
    LineItems: [
      {
        Description: lineDescription,
        Quantity: 1,
        UnitAmount: amount,
        AccountCode: "621",
      },
    ],
    BankAccount: { Code: bankAccountCode },
    Reference: `Disbursement — ${customerName || ""}${storeLabel}`,
  };

  const xeroRes = await fetch(
    "https://api.xero.com/api.xro/2.0/BankTransactions",
    {
      method: "POST",
      headers: xeroHeaders(auth),
      body: JSON.stringify({ BankTransactions: [bankTxPayload] }),
    }
  );

  if (!xeroRes.ok) {
    const errText = await xeroRes.text();
    console.error("[disbursements] Xero bank transaction failed:", errText);
    res.status(502).json({ error: `Xero error: ${errText.slice(0, 300)}` });
    return;
  }

  const xeroData = await xeroRes.json();
  const createdTx = xeroData?.BankTransactions?.[0];
  const xeroTxId = createdTx?.BankTransactionID ?? null;
  const xeroRef = createdTx?.Reference ?? null;

  // Mark notification as actioned and store disbursement details.
  // Also look up the customer's loan agreement Formitize job ID for the deep-link button.
  const client = await pool.connect();
  let formitizeJobId: string | null = null;
  try {
    await client.query(
      `UPDATE formitize_notifications
       SET status = 'actioned',
           disbursed_at = NOW(),
           disbursement_amount = $1,
           xero_bank_transaction_id = $2,
           processed_at = NOW()
       WHERE id = $3`,
      [amount, xeroTxId, notificationId]
    );

    // Fetch the customer_id from the notification then find their latest agreement's Formitize job ID
    const notifRow = await client.query<{ customer_id: number | null }>(
      `SELECT customer_id FROM formitize_notifications WHERE id = $1`, [notificationId]
    );
    const customerId = notifRow.rows[0]?.customer_id;
    if (customerId) {
      const agRow = await client.query<{ formitize_job_id: string | null }>(
        `SELECT formitize_job_id FROM agreements
         WHERE customer_id = $1 AND formitize_job_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`,
        [customerId]
      );
      formitizeJobId = agRow.rows[0]?.formitize_job_id ?? null;
    }
  } finally {
    client.release();
  }

  // Construct a Formitize deep-link URL for the loan agreement task
  const formitizeTaskUrl = formitizeJobId
    ? `https://service.formitize.com/#/tasks/${formitizeJobId}`
    : null;

  console.log(`[disbursements] Disbursed $${amount} for notification ${notificationId} → Xero TX ${xeroTxId}${formitizeJobId ? ` | Formitize task ${formitizeJobId}` : ""}`);

  res.json({
    success: true,
    xeroTransactionId: xeroTxId,
    xeroReference: xeroRef,
    amount,
    bankAccountCode,
    date: txDate,
    formitizeTaskUrl,
  });
});

export default router;
