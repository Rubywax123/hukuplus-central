import { Router, type IRouter } from "express";
import { db, pool } from "@workspace/db";
import { requireStaffAuth } from "../middlewares/staffAuthMiddleware";

const router: IRouter = Router();

// ─── GET /api/store-visits ────────────────────────────────────────────────────
// Query params: date (YYYY-MM-DD), dateFrom, dateTo, status, staffUserId
router.get("/store-visits", requireStaffAuth, async (req, res): Promise<void> => {
  try {
    const { date, dateFrom, dateTo, status, staffUserId } = req.query as Record<string, string>;
    const conditions: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (date) {
      conditions.push(`sv.visit_date = $${i++}`);
      params.push(date);
    } else {
      if (dateFrom) { conditions.push(`sv.visit_date >= $${i++}`); params.push(dateFrom); }
      if (dateTo)   { conditions.push(`sv.visit_date <= $${i++}`); params.push(dateTo); }
    }
    if (status)      { conditions.push(`sv.status = $${i++}`);         params.push(status); }
    if (staffUserId) { conditions.push(`sv.staff_user_id = $${i++}`);  params.push(Number(staffUserId)); }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT sv.*,
              r.name  AS retailer_name,
              b.name  AS branch_name,
              b.location AS branch_location
         FROM store_visits sv
         JOIN retailers r ON r.id = sv.retailer_id
    LEFT JOIN branches  b ON b.id = sv.branch_id
        ${where}
        ORDER BY sv.visit_date DESC, sv.created_at DESC`,
      params,
    );
    res.json(rows);
  } catch (err: any) {
    console.error("[store-visits] GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch store visits" });
  }
});

// ─── POST /api/store-visits ───────────────────────────────────────────────────
router.post("/store-visits", requireStaffAuth, async (req, res): Promise<void> => {
  try {
    const { visitDate, retailerId, branchId, planNotes, visitNotes, status } = req.body as {
      visitDate: string;
      retailerId: number;
      branchId?: number | null;
      planNotes?: string;
      visitNotes?: string;
      status?: string;
    };

    if (!visitDate || !retailerId) {
      res.status(400).json({ error: "visitDate and retailerId are required" });
      return;
    }

    const staffUserId  = req.staffUser!.staffUserId;
    const staffName    = req.staffUser!.name;
    const resolvedStatus = status === "visited" ? "visited" : "planned";
    const visitedAt    = resolvedStatus === "visited" ? new Date() : null;

    const { rows } = await pool.query(
      `INSERT INTO store_visits
              (visit_date, retailer_id, branch_id, staff_user_id, staff_name, plan_notes, visit_notes, status, visited_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [visitDate, retailerId, branchId ?? null, staffUserId, staffName,
       planNotes ?? null, visitNotes ?? null, resolvedStatus, visitedAt],
    );
    res.status(201).json(rows[0]);
  } catch (err: any) {
    console.error("[store-visits] POST error:", err.message);
    res.status(500).json({ error: "Failed to create store visit" });
  }
});

// ─── PATCH /api/store-visits/:id ─────────────────────────────────────────────
router.patch("/store-visits/:id", requireStaffAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { status, visitNotes, planNotes, visitDate, retailerId, branchId } = req.body as {
      status?: string;
      visitNotes?: string;
      planNotes?: string;
      visitDate?: string;
      retailerId?: number;
      branchId?: number | null;
    };

    const sets: string[] = ["updated_at = NOW()"];
    const params: any[] = [];
    let i = 1;

    if (status !== undefined) {
      sets.push(`status = $${i++}`);
      params.push(status);
      if (status === "visited") {
        sets.push(`visited_at = NOW()`);
      }
    }
    if (visitNotes  !== undefined) { sets.push(`visit_notes  = $${i++}`); params.push(visitNotes); }
    if (planNotes   !== undefined) { sets.push(`plan_notes   = $${i++}`); params.push(planNotes);  }
    if (visitDate   !== undefined) { sets.push(`visit_date   = $${i++}`); params.push(visitDate);  }
    if (retailerId  !== undefined) { sets.push(`retailer_id  = $${i++}`); params.push(retailerId); }
    if (branchId    !== undefined) { sets.push(`branch_id    = $${i++}`); params.push(branchId ?? null); }

    params.push(id);
    const { rows } = await pool.query(
      `UPDATE store_visits SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
      params,
    );
    if (!rows.length) { res.status(404).json({ error: "Not found" }); return; }
    res.json(rows[0]);
  } catch (err: any) {
    console.error("[store-visits] PATCH error:", err.message);
    res.status(500).json({ error: "Failed to update store visit" });
  }
});

// ─── DELETE /api/store-visits/:id ────────────────────────────────────────────
router.delete("/store-visits/:id", requireStaffAuth, async (req, res): Promise<void> => {
  try {
    const id = Number(req.params.id);
    await pool.query(`DELETE FROM store_visits WHERE id = $1`, [id]);
    res.status(204).send();
  } catch (err: any) {
    console.error("[store-visits] DELETE error:", err.message);
    res.status(500).json({ error: "Failed to delete store visit" });
  }
});

export default router;
