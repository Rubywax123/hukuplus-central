import { Router } from "express";
import { pool } from "@workspace/db";
import { requireStaffAuth } from "../middlewares/staffAuthMiddleware";

const router = Router();

const FLOCK_VALUE_PER_HEAD = 2.06;

// ─── POST /api/leads — submit a new lead ─────────────────────────────────────

router.post("/leads", requireStaffAuth, async (req, res): Promise<void> => {
  const { customerName, phone, retailerId, branchId, retailerName, branchName, flockSize, notes } = req.body;
  const submittedBy = (req as any).user?.email ?? (req as any).user?.name ?? "unknown";

  if (!customerName?.trim() || !phone?.trim()) {
    res.status(400).json({ error: "customerName and phone are required" });
    return;
  }
  if (typeof flockSize !== "number" || flockSize < 0) {
    res.status(400).json({ error: "flockSize must be a non-negative number" });
    return;
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      `INSERT INTO leads
         (customer_name, phone, retailer_id, branch_id, retailer_name, branch_name, flock_size, notes, submitted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, (flock_size * $10) AS estimated_value`,
      [
        customerName.trim(),
        phone.trim(),
        retailerId ?? null,
        branchId ?? null,
        retailerName ?? null,
        branchName ?? null,
        flockSize,
        notes?.trim() ?? null,
        submittedBy,
        FLOCK_VALUE_PER_HEAD,
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
    const where = status && status !== "all" ? `WHERE l.status = $${params.push(status)}` : "";
    const result = await client.query(
      `SELECT l.*,
              (l.flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value,
              c.full_name AS converted_customer_name
       FROM leads l
       LEFT JOIN customers c ON c.id = l.converted_customer_id
       ${where}
       ORDER BY
         CASE l.status WHEN 'new' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
         l.created_at DESC`,
      params
    );
    res.json(result.rows);
  } finally {
    client.release();
  }
});

// ─── GET /api/leads/counts — unacknowledged count (for badge) ─────────────────

router.get("/leads/counts", requireStaffAuth, async (_req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT COUNT(*) AS new_count FROM leads WHERE status = 'new'`);
    res.json({ newCount: parseInt(r.rows[0].new_count, 10) });
  } finally {
    client.release();
  }
});

// ─── PUT /api/leads/:id/acknowledge ──────────────────────────────────────────

router.put("/leads/:id/acknowledge", requireStaffAuth, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const acknowledgedBy = (req as any).user?.email ?? (req as any).user?.name ?? "unknown";
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

// ─── GET /api/leads/export.csv — CSV for Wati (name + phone) ─────────────────

router.get("/leads/export.csv", requireStaffAuth, async (req, res): Promise<void> => {
  const { status } = req.query;
  const client = await pool.connect();
  try {
    const params: any[] = [];
    const where = status && status !== "all"
      ? `WHERE status = $${params.push(status)}`
      : "WHERE status != 'converted'";
    const r = await client.query(
      `SELECT customer_name, phone, retailer_name, branch_name,
              flock_size, (flock_size * ${FLOCK_VALUE_PER_HEAD}) AS estimated_value,
              submitted_by, created_at
       FROM leads ${where}
       ORDER BY created_at DESC`,
      params
    );

    const escape = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Name", "Phone", "Retailer", "Store", "Flock Size", "Est. Value ($)", "Submitted By", "Date"].join(",");
    const rows = r.rows.map(row =>
      [
        escape(row.customer_name),
        escape(row.phone),
        escape(row.retailer_name ?? ""),
        escape(row.branch_name ?? ""),
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
