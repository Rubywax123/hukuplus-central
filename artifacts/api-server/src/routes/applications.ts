import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requirePortalAuth } from "../middlewares/portalAuthMiddleware";
import { apiKeyOrSession } from "../middlewares/staffAuthMiddleware";
import { sendEmail, loanApplicationEmail, drawdownRequestEmail } from "../lib/mailer";
import { format, differenceInDays, parseISO } from "date-fns";

// Alias so all existing requireAuth usages work without individual changes
const requireAuth = apiKeyOrSession;

const router = Router();
const OPS_EMAIL = "operations@marishoma.com";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getStoreEmails(retailerId: number): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT pu.email FROM portal_users pu
     WHERE pu.retailer_id = $1 AND pu.is_active = true AND pu.email IS NOT NULL`,
    [retailerId]
  );
  return result.rows.map((r: any) => r.email);
}

async function getStoreName(retailerId?: number | null, branchId?: number | null): Promise<string> {
  if (!retailerId) return "Unknown Store";
  if (branchId) {
    const r = await pool.query(
      `SELECT r.name, b.name as branch_name FROM retailers r
       JOIN branches b ON b.id = $2 WHERE r.id = $1`,
      [retailerId, branchId]
    );
    if (r.rows.length) return `${r.rows[0].name} - ${r.rows[0].branch_name}`;
  }
  const r = await pool.query("SELECT name FROM retailers WHERE id = $1", [retailerId]);
  return r.rows[0]?.name || "Unknown Store";
}

async function createMessage(
  retailerId: number,
  branchId: number | null,
  referenceType: string,
  referenceId: number,
  subject: string,
  body: string
) {
  await pool.query(
    `INSERT INTO in_app_messages (retailer_id, branch_id, reference_type, reference_id, subject, body)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [retailerId, branchId, referenceType, referenceId, subject, body]
  );
}

// ── Customer Verification (public) ───────────────────────────────────────────

// POST /applications/customer-verify
router.post("/applications/customer-verify", async (req: Request, res: Response) => {
  try {
    const { name, phone, product } = req.body;
    if (!name || !phone) return res.status(400).json({ error: "Name and phone are required" });

    const normalise = (p: string) => {
      let n = p.replace(/[\s\-()]/g, "");
      if (n.startsWith("+263")) n = "0" + n.slice(4);
      else if (n.startsWith("263")) n = "0" + n.slice(3);
      return n;
    };
    const normPhone = normalise(phone);

    // Find customer by normalised phone + name
    const cResult = await pool.query(
      `SELECT c.id, c.full_name AS name, c.phone,
              a.retailer_id, r.name as retailer_name,
              a.branch_id, b.name as branch_name
       FROM customers c
       LEFT JOIN LATERAL (
         SELECT retailer_id, branch_id FROM agreements
         WHERE customer_id = c.id
         ORDER BY created_at DESC LIMIT 1
       ) a ON true
       LEFT JOIN retailers r ON r.id = a.retailer_id
       LEFT JOIN branches b ON b.id = a.branch_id
       WHERE LOWER(TRIM(c.full_name)) = LOWER(TRIM($1))
         AND REPLACE(REPLACE(REPLACE(REPLACE(c.phone,' ',''),'-',''),'(',''),')','') = $2`,
      [name, normPhone]
    );

    if (cResult.rows.length === 0) {
      return res.status(404).json({ error: "No customer found matching that name and phone number." });
    }

    const customer = cResult.rows[0];

    if (product === "Revolver") {
      // Find active Revolver agreement + calculate balance
      const agrResult = await pool.query(
        `SELECT a.*, r.name as retailer_name, b.name as branch_name
         FROM agreements a
         LEFT JOIN retailers r ON r.id = a.retailer_id
         LEFT JOIN branches b ON b.id = a.branch_id
         WHERE a.customer_id = $1
           AND (LOWER(a.loan_product) LIKE '%revolver%')
           AND a.status = 'active'
         ORDER BY a.created_at DESC LIMIT 1`,
        [customer.id]
      );

      if (agrResult.rows.length === 0) {
        return res.status(404).json({ error: "No active Revolver facility found for this customer." });
      }

      const agreement = agrResult.rows[0];

      // Calculate used balance from actioned drawdowns
      const usedResult = await pool.query(
        `SELECT COALESCE(SUM(amount_requested), 0) as used
         FROM drawdown_requests
         WHERE agreement_id = $1 AND status = 'actioned'`,
        [agreement.id]
      );
      const used = parseFloat(usedResult.rows[0].used);
      const facilityLimit = parseFloat(agreement.loan_amount);
      const facilityBalance = Math.max(0, facilityLimit - used);

      return res.json({
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          retailerId: customer.retailer_id,
          retailerName: customer.retailer_name,
          branchId: customer.branch_id,
          branchName: customer.branch_name,
        },
        agreement: {
          id: agreement.id,
          facilityLimit,
          facilityBalance,
          retailerId: agreement.retailer_id,
          retailerName: agreement.retailer_name,
          branchId: agreement.branch_id,
          branchName: agreement.branch_name,
        },
      });
    }

    return res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        retailerId: customer.retailer_id,
        retailerName: customer.retailer_name,
        branchId: customer.branch_id,
        branchName: customer.branch_name,
      },
    });
  } catch (err) {
    console.error("[applications] customer-verify error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── HukuPlus Loan Applications ────────────────────────────────────────────────

// POST /applications/loan (public — customer submits)
router.post("/applications/loan", async (req: Request, res: Response) => {
  try {
    const {
      customerId, customerName, customerPhone,
      retailerId, branchId,
      collectionRetailerId, collectionBranchId,
      chickCount, chickPurchaseDate, expectedCollectionDate,
      amountRequested,
    } = req.body;

    if (!customerName || !chickCount || !chickPurchaseDate || !expectedCollectionDate || !amountRequested) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const chicks = parseInt(chickCount);
    const amount = parseFloat(amountRequested);
    const amountLimit = parseFloat((chicks * 2.06).toFixed(2));

    if (amount > amountLimit) {
      return res.status(400).json({ error: `Amount exceeds limit of $${amountLimit.toFixed(2)} for ${chicks} chicks` });
    }

    const purchaseDate = parseISO(chickPurchaseDate);
    const collectionDate = parseISO(expectedCollectionDate);
    const daysDiff = differenceInDays(collectionDate, purchaseDate);
    if (daysDiff < 12) {
      return res.status(400).json({ error: "Expected collection date must be at least 12 days after chick purchase date" });
    }

    const result = await pool.query(
      `INSERT INTO loan_applications
         (customer_id, customer_name, customer_phone, retailer_id, branch_id,
          collection_retailer_id, collection_branch_id,
          chick_count, chick_purchase_date, expected_collection_date,
          amount_requested, amount_limit, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'submitted')
       RETURNING *`,
      [
        customerId || null, customerName, customerPhone || null,
        retailerId || null, branchId || null,
        collectionRetailerId || retailerId || null,
        collectionBranchId || branchId || null,
        chicks, chickPurchaseDate, expectedCollectionDate,
        amount, amountLimit,
      ]
    );

    const app = result.rows[0];
    const storeName = await getStoreName(retailerId, branchId);
    const collectionStoreName = await getStoreName(
      collectionRetailerId || retailerId,
      collectionBranchId || branchId
    );

    // Notify operations via email
    const html = loanApplicationEmail({
      customerName,
      customerPhone: customerPhone || "",
      chickCount: chicks,
      chickPurchaseDate: format(purchaseDate, "dd MMM yyyy"),
      expectedCollectionDate: format(collectionDate, "dd MMM yyyy"),
      amountRequested: amount,
      amountLimit,
      storeName,
      collectionStoreName,
      applicationId: app.id,
    });

    await sendEmail({
      to: OPS_EMAIL,
      subject: `HukuPlus Repeat Loan Application #${app.id} — ${customerName}`,
      html,
    });

    // In-app message to the store
    if (retailerId) {
      await createMessage(
        retailerId, branchId || null,
        "loan_application", app.id,
        `Repeat Loan Application from ${customerName}`,
        `${customerName} has applied for a repeat HukuPlus loan of $${amount.toFixed(2)} (${chicks} chicks). Expected collection: ${format(collectionDate, "dd MMM yyyy")}.`
      );
    }

    res.status(201).json({ id: app.id, status: "submitted", amountLimit });
  } catch (err) {
    console.error("[applications] loan POST error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/loan (admin)
router.get("/applications/loan", requireAuth, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const params: any[] = [];
    let where = "";
    if (status) { params.push(status); where = `WHERE la.status = $1`; }

    const result = await pool.query(
      `SELECT la.*,
              r.name as retailer_name, b.name as branch_name,
              cr.name as collection_retailer_name, cb.name as collection_branch_name
       FROM loan_applications la
       LEFT JOIN retailers r ON r.id = la.retailer_id
       LEFT JOIN branches b ON b.id = la.branch_id
       LEFT JOIN retailers cr ON cr.id = la.collection_retailer_id
       LEFT JOIN branches cb ON cb.id = la.collection_branch_id
       ${where}
       ORDER BY la.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[applications] loan GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /applications/loan/:id (admin — update status/notes)
router.put("/applications/loan/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const result = await pool.query(
      `UPDATE loan_applications SET status = COALESCE($1, status), notes = COALESCE($2, notes), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status || null, notes !== undefined ? notes : null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[applications] loan PUT error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Revolver Drawdown Requests ────────────────────────────────────────────────

// POST /applications/drawdown (public — customer submits)
router.post("/applications/drawdown", async (req: Request, res: Response) => {
  try {
    const {
      customerId, customerName, customerPhone,
      agreementId, retailerId, branchId,
      collectionRetailerId, collectionBranchId,
      amountRequested, facilityLimit, facilityBalance,
    } = req.body;

    if (!customerName || !amountRequested) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const amount = parseFloat(amountRequested);
    const balance = parseFloat(facilityBalance || "0");

    if (amount > balance) {
      return res.status(400).json({ error: `Amount exceeds available balance of $${balance.toFixed(2)}` });
    }
    if (amount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }

    const result = await pool.query(
      `INSERT INTO drawdown_requests
         (customer_id, customer_name, customer_phone, agreement_id,
          retailer_id, branch_id, collection_retailer_id, collection_branch_id,
          amount_requested, facility_limit, facility_balance, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
       RETURNING *`,
      [
        customerId || null, customerName, customerPhone || null,
        agreementId || null,
        retailerId || null, branchId || null,
        collectionRetailerId || retailerId || null,
        collectionBranchId || branchId || null,
        amount,
        parseFloat(facilityLimit || "0"),
        balance,
      ]
    );

    const dr = result.rows[0];
    const defaultStoreName = await getStoreName(retailerId, branchId);
    const collectionStoreName = await getStoreName(
      collectionRetailerId || retailerId,
      collectionBranchId || branchId
    );

    // Email operations + store
    const html = drawdownRequestEmail({
      customerName,
      customerPhone: customerPhone || "",
      amountRequested: amount,
      facilityLimit: parseFloat(facilityLimit || "0"),
      facilityBalance: balance,
      defaultStoreName,
      collectionStoreName,
      requestId: dr.id,
    });

    const toEmails = [OPS_EMAIL];
    const collRetailerId = collectionRetailerId || retailerId;
    if (collRetailerId) {
      const storeEmails = await getStoreEmails(collRetailerId);
      toEmails.push(...storeEmails);
    }

    await sendEmail({
      to: [...new Set(toEmails)],
      subject: `Revolver Drawdown Request #${dr.id} — ${customerName} — $${amount.toFixed(2)}`,
      html,
    });

    // In-app message to the collection store
    if (collRetailerId) {
      const collBranchId = collectionBranchId || branchId;
      await createMessage(
        collRetailerId, collBranchId || null,
        "drawdown_request", dr.id,
        `Drawdown Request from ${customerName}`,
        `${customerName} has requested a drawdown of $${amount.toFixed(2)} from your store. Please action this and confirm in HukuPlusCentral.`
      );
      // Notify original store too if different
      if (collRetailerId !== retailerId && retailerId) {
        await createMessage(
          retailerId, branchId || null,
          "drawdown_request", dr.id,
          `Drawdown Request from ${customerName}`,
          `${customerName} has requested a drawdown of $${amount.toFixed(2)}. They will collect from ${collectionStoreName}.`
        );
      }
    }

    res.status(201).json({ id: dr.id, status: "pending" });
  } catch (err) {
    console.error("[applications] drawdown POST error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/drawdown (admin)
router.get("/applications/drawdown", requireAuth, async (req: Request, res: Response) => {
  try {
    const { status } = req.query;
    const params: any[] = [];
    let where = "";
    if (status) { params.push(status); where = `WHERE dr.status = $1`; }

    const result = await pool.query(
      `SELECT dr.*,
              r.name as retailer_name, b.name as branch_name,
              cr.name as collection_retailer_name, cb.name as collection_branch_name
       FROM drawdown_requests dr
       LEFT JOIN retailers r ON r.id = dr.retailer_id
       LEFT JOIN branches b ON b.id = dr.branch_id
       LEFT JOIN retailers cr ON cr.id = dr.collection_retailer_id
       LEFT JOIN branches cb ON cb.id = dr.collection_branch_id
       ${where}
       ORDER BY dr.created_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[applications] drawdown GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /applications/drawdown/:id (admin — update status, trigger store notification)
router.put("/applications/drawdown/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    let notifiedAt = null;
    if (status === "notified") notifiedAt = new Date();

    const result = await pool.query(
      `UPDATE drawdown_requests
       SET status = COALESCE($1, status),
           notes = COALESCE($2, notes),
           store_notified_at = CASE WHEN $3 IS NOT NULL THEN $3 ELSE store_notified_at END,
           updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [status || null, notes !== undefined ? notes : null, notifiedAt, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[applications] drawdown PUT error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /applications/drawdown/:id/confirm (store portal — confirm actioned)
router.put("/applications/drawdown/:id/confirm", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const portalUser = (req as any).portalUser;

    const result = await pool.query(
      `UPDATE drawdown_requests
       SET status = 'actioned',
           store_actioned_at = NOW(),
           store_actioned_by = $1,
           updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [portalUser?.name || "Store", id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });

    // Notify ops
    const dr = result.rows[0];
    await sendEmail({
      to: OPS_EMAIL,
      subject: `Drawdown #${dr.id} Actioned — ${dr.customer_name}`,
      html: `<p>Drawdown request #${dr.id} for <strong>${dr.customer_name}</strong> ($${parseFloat(dr.amount_requested).toFixed(2)}) has been actioned by <strong>${dr.store_actioned_by}</strong> at ${new Date().toISOString()}.</p>`,
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error("[applications] drawdown confirm error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── In-App Messages ────────────────────────────────────────────────────────────

// GET /applications/messages (portal — get store's messages)
router.get("/applications/messages", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const portalUser = (req as any).portalUser;
    const result = await pool.query(
      `SELECT * FROM in_app_messages
       WHERE retailer_id = $1
         AND (branch_id IS NULL OR branch_id = $2)
       ORDER BY created_at DESC
       LIMIT 50`,
      [portalUser.retailerId, portalUser.branchId || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[applications] messages GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/messages/unread-count (portal)
router.get("/applications/messages/unread-count", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const portalUser = (req as any).portalUser;
    const result = await pool.query(
      `SELECT COUNT(*) FROM in_app_messages
       WHERE retailer_id = $1
         AND (branch_id IS NULL OR branch_id = $2)
         AND is_read = false`,
      [portalUser.retailerId, portalUser.branchId || null]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /applications/messages/:id/read (portal)
router.put("/applications/messages/:id/read", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE in_app_messages SET is_read = true WHERE id = $1", [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/drawdown/store (portal — store sees its own drawdown requests)
router.get("/applications/drawdown/store", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const portalUser = (req as any).portalUser;
    const result = await pool.query(
      `SELECT dr.*,
              r.name as retailer_name, b.name as branch_name,
              cr.name as collection_retailer_name, cb.name as collection_branch_name
       FROM drawdown_requests dr
       LEFT JOIN retailers r ON r.id = dr.retailer_id
       LEFT JOIN branches b ON b.id = dr.branch_id
       LEFT JOIN retailers cr ON cr.id = dr.collection_retailer_id
       LEFT JOIN branches cb ON cb.id = dr.collection_branch_id
       WHERE dr.collection_retailer_id = $1
         AND ($2::int IS NULL OR dr.collection_branch_id = $2)
       ORDER BY dr.created_at DESC`,
      [portalUser.retailerId, portalUser.branchId || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[applications] drawdown store GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/messages/admin (admin — all in-app messages with store info)
router.get("/applications/messages/admin", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT m.*,
              r.name as retailer_name,
              b.name as branch_name
       FROM in_app_messages m
       LEFT JOIN retailers r ON r.id = m.retailer_id
       LEFT JOIN branches b ON b.id = m.branch_id
       ORDER BY m.created_at DESC
       LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[applications] admin messages GET error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /applications/messages/admin (admin — send message to a store)
router.post("/applications/messages/admin", requireAuth, async (req: Request, res: Response) => {
  try {
    const { retailer_id, branch_id, reference_type, reference_id, subject, body } = req.body;
    if (!retailer_id || !subject || !body) {
      return res.status(400).json({ error: "retailer_id, subject and body are required" });
    }
    const result = await pool.query(
      `INSERT INTO in_app_messages (retailer_id, branch_id, reference_type, reference_id, subject, body)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [retailer_id, branch_id || null, reference_type || null, reference_id || null, subject, body]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[applications] admin messages POST error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/drawdown/pending-count (admin — badge count)
router.get("/applications/drawdown/pending-count", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT COUNT(*) FROM drawdown_requests WHERE status = 'pending'`
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /applications/retailers (public — for store picker in customer forms)
router.get("/applications/retailers", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, b.id as branch_id, b.name as branch_name
       FROM retailers r
       JOIN branches b ON b.retailer_id = r.id AND b.is_active = true
       WHERE r.is_active = true
       ORDER BY r.name, b.name`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
