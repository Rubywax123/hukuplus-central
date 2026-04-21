import { Router } from "express";
import { pool } from "@workspace/db";
import { requireStaffAuth } from "../middlewares/staffAuthMiddleware";

const router = Router();

const FLOCK_VALUE_PER_HEAD = 2.06;

// ─── POST /api/leads — submit a new lead ─────────────────────────────────────
// Accepts: staff session OR portal session with role=agronomist

router.post("/leads", async (req, res): Promise<void> => {
  const staffUser = (req as any).staffUser;
  const portalUser = (req as any).portalUser;

  let submittedBy: string;
  let overrideRetailerId: number | null = null;
  let overrideBranchId: number | null = null;
  let overrideRetailerName: string | null = null;
  let overrideBranchName: string | null = null;

  if (staffUser) {
    submittedBy = staffUser.email ?? staffUser.name ?? "unknown";
  } else if (portalUser && portalUser.role === "agronomist") {
    submittedBy = `${portalUser.name} <${portalUser.email}>`;
    overrideRetailerId = portalUser.retailerId ?? null;
    overrideBranchId = portalUser.branchId ?? null;
    overrideRetailerName = portalUser.retailerName ?? null;
  } else {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { customerName, phone, retailerId, branchId, retailerName, branchName, flockSize, notes, loanProduct } = req.body;

  if (!customerName?.trim() || !phone?.trim()) {
    res.status(400).json({ error: "customerName and phone are required" });
    return;
  }
  const flockSizeNum = Number(flockSize ?? 0);
  if (isNaN(flockSizeNum) || flockSizeNum < 0) {
    res.status(400).json({ error: "flockSize must be a non-negative number" });
    return;
  }
  const VALID_PRODUCTS = ["HukuPlus", "Revolver", "ChikweretiOne"];
  const finalProduct = VALID_PRODUCTS.includes(loanProduct) ? loanProduct : "HukuPlus";

  const finalRetailerId = overrideRetailerId ?? (retailerId ? Number(retailerId) : null);
  const finalBranchId = overrideBranchId ?? (branchId ? Number(branchId) : null);
  const finalRetailerName = overrideRetailerName ?? retailerName ?? null;
  const finalBranchName = overrideBranchName ?? branchName ?? null;

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO leads
         (customer_name, phone, retailer_id, branch_id, retailer_name, branch_name, flock_size, notes, submitted_by, loan_product)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *, (flock_size::numeric * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value`,
      [
        customerName.trim(),
        phone.trim(),
        finalRetailerId,
        finalBranchId,
        finalRetailerName,
        finalBranchName,
        flockSizeNum,
        notes?.trim() ?? null,
        submittedBy,
        finalProduct,
      ]
    );
    res.status(201).json(result.rows[0]);
  } finally {
    client.release();
  }
});

// ─── GET /api/leads — list leads (with optional status filter) ────────────────

router.get("/leads", requireStaffAuth, async (req, res): Promise<void> => {
  const { status } = req.query;
  const client = await pool.connect();
  try {
    const params: any[] = [];
    let where = "";
    let orderBy = "ORDER BY CASE l.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, l.created_at DESC";

    if (status === "unconverted") {
      where = "WHERE l.status IN ('new', 'acknowledged')";
      orderBy = "ORDER BY l.created_at DESC";
    } else if (status && status !== "all") {
      where = `WHERE l.status = $${params.push(status)}`;
    }

    const result = await client.query(
      `SELECT l.*,
              (l.flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value,
              c.full_name AS converted_customer_name
       FROM leads l
       LEFT JOIN customers c ON c.id = l.converted_customer_id
       ${where}
       ${orderBy}`,
      params
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});

// ─── GET /api/leads/counts — global new count (for badge) ─────────────────────

router.get("/leads/counts", requireStaffAuth, async (req, res): Promise<void> => {
  const email = (req as any).staffUser?.email ?? (req as any).user?.email ?? "";
  const client = await pool.connect();
  try {
    const feedR = await client.query(
      `SELECT COUNT(*) AS feed_count
       FROM leads l
       WHERE l.status IN ('new', 'acknowledged')
         AND NOT EXISTS (
           SELECT 1 FROM lead_dismissals d
           WHERE d.lead_id = l.id AND d.staff_email = $1
         )`,
      [email]
    );
    const globalR = await client.query(`SELECT COUNT(*) AS new_count FROM leads WHERE status = 'new'`);
    res.json({
      newCount: parseInt(globalR.rows[0].new_count, 10),
      feedCount: parseInt(feedR.rows[0].feed_count, 10),
    });
  } finally {
    client.release();
  }
});

// ─── GET /api/leads/monthly-stats — current + previous month counts ───────────

router.get("/leads/monthly-stats", requireStaffAuth, async (_req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE date_trunc('month', created_at AT TIME ZONE 'UTC') = date_trunc('month', NOW() AT TIME ZONE 'UTC'))::int
          AS this_month_leads,
        COUNT(*) FILTER (WHERE date_trunc('month', created_at AT TIME ZONE 'UTC') = date_trunc('month', (NOW() - INTERVAL '1 month') AT TIME ZONE 'UTC'))::int
          AS last_month_leads,
        COUNT(*) FILTER (WHERE status = 'converted'
          AND date_trunc('month', converted_at AT TIME ZONE 'UTC') = date_trunc('month', NOW() AT TIME ZONE 'UTC'))::int
          AS this_month_conversions,
        COUNT(*) FILTER (WHERE status = 'converted'
          AND date_trunc('month', converted_at AT TIME ZONE 'UTC') = date_trunc('month', (NOW() - INTERVAL '1 month') AT TIME ZONE 'UTC'))::int
          AS last_month_conversions
      FROM leads
    `);
    const row = r.rows[0];
    res.json({
      thisMonth:  { leads: row.this_month_leads,  conversions: row.this_month_conversions },
      lastMonth:  { leads: row.last_month_leads,  conversions: row.last_month_conversions },
    });
  } finally {
    client.release();
  }
});

// ─── GET /api/leads/feed — per-user feed (undismissed unconverted leads) ──────

router.get("/leads/feed", requireStaffAuth, async (req, res): Promise<void> => {
  const email = (req as any).staffUser?.email ?? (req as any).user?.email ?? "";
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT l.*,
              (l.flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value
       FROM leads l
       WHERE l.status IN ('new', 'acknowledged')
         AND NOT EXISTS (
           SELECT 1 FROM lead_dismissals d
           WHERE d.lead_id = l.id AND d.staff_email = $1
         )
       ORDER BY l.created_at DESC`,
      [email]
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});

// ─── PUT /api/leads/:id/dismiss — mark done in MY feed (per-user) ─────────────

router.put("/leads/:id/dismiss", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const email = (req as any).staffUser?.email ?? (req as any).user?.email ?? "";
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO lead_dismissals (lead_id, staff_email)
       VALUES ($1, $2)
       ON CONFLICT (lead_id, staff_email) DO NOTHING`,
      [id, email]
    );
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

// ─── PUT /api/leads/:id/acknowledge ──────────────────────────────────────────

router.put("/leads/:id/acknowledge", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const acknowledgedBy = (req as any).staffUser?.email ?? (req as any).user?.email ?? "unknown";
  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE leads
       SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *, (flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value`,
      [acknowledgedBy, id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(r.rows[0]);
  } finally {
    client.release();
  }
});

// ─── PUT /api/leads/:id/convert — file as converted customer ─────────────────

router.put("/leads/:id/convert", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { customerId, notes } = req.body;
  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE leads
       SET status = 'converted',
           converted_at = NOW(),
           converted_customer_id = $1,
           notes = COALESCE($2, notes),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *, (flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value`,
      [customerId ?? null, notes ?? null, id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(r.rows[0]);
  } finally {
    client.release();
  }
});

// ─── PUT /api/leads/:id/toggle-messaged — mark/unmark as messaged ────────────

router.put("/leads/:id/toggle-messaged", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE leads
         SET messaged_at = CASE WHEN messaged_at IS NULL THEN now() ELSE NULL END,
             updated_at  = now()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(r.rows[0]);
  } finally {
    client.release();
  }
});

// ─── PATCH /api/leads/:id — update editable fields ───────────────────────────

router.patch("/leads/:id", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { notes, customer_name, phone, flock_size } = req.body ?? {};
  const sets: string[] = [];
  const params: any[] = [];

  if (notes !== undefined)         { sets.push(`notes = $${params.push(notes ?? null)}`); }
  if (customer_name !== undefined) { sets.push(`customer_name = $${params.push(String(customer_name).trim())}`); }
  if (phone !== undefined)         { sets.push(`phone = $${params.push(String(phone).trim())}`); }
  if (flock_size !== undefined)    { sets.push(`flock_size = $${params.push(parseInt(flock_size, 10) || 0)}`); }

  if (sets.length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

  sets.push(`updated_at = now()`);
  params.push(id);

  const client = await pool.connect();
  try {
    const r = await client.query(
      `UPDATE leads SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json(r.rows[0]);
  } finally {
    client.release();
  }
});

// ─── DELETE /api/leads/:id — permanently remove a lead ───────────────────────

router.delete("/leads/:id", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const client = await pool.connect();
  try {
    const r = await client.query(`DELETE FROM leads WHERE id = $1 RETURNING id`, [id]);
    if (!r.rows[0]) { res.status(404).json({ error: "Lead not found" }); return; }
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

// ─── GET /api/leads/export.csv — CSV for Wati (name + phone) ─────────────────

router.get("/leads/export.csv", requireStaffAuth, async (req, res): Promise<void> => {
  const { status } = req.query;
  const client = await pool.connect();
  try {
    const params: any[] = [];
    let where = "WHERE status != 'converted'";
    if (status === "unconverted") {
      where = "WHERE status IN ('new', 'acknowledged')";
    } else if (status && status !== "all") {
      where = `WHERE status = $${params.push(status)}`;
    }
    const r = await client.query(
      `SELECT customer_name, phone, retailer_name, branch_name,
              flock_size, (flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value,
              loan_product, submitted_by, created_at
       FROM leads ${where}
       ORDER BY created_at DESC`,
      params
    );

    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Name", "Phone", "Retailer", "Store", "Product", "Flock Size", "Est. Value ($)", "Submitted By", "Date"].join(",");
    const rows = r.rows.map(row =>
      [
        escape(row.customer_name),
        escape(row.phone),
        escape(row.retailer_name ?? ""),
        escape(row.branch_name ?? ""),
        escape(row.loan_product ?? "HukuPlus"),
        row.flock_size,
        Number(row.estimated_value).toFixed(2),
        escape(row.submitted_by ?? ""),
        escape(new Date(row.created_at).toLocaleDateString()),
      ].join(",")
    );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send([header, ...rows].join("\n"));
  } finally {
    client.release();
  }
});

export default router;
