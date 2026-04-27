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

// ─── GET /api/store-visits/analytics ─────────────────────────────────────────
// Optional query params: dateFrom, dateTo (YYYY-MM-DD). Only counts "visited" records.
router.get("/store-visits/analytics", requireStaffAuth, async (req, res): Promise<void> => {
  try {
    const { dateFrom, dateTo } = req.query as Record<string, string>;

    const dateConds: string[] = ["sv.status = 'visited'"];
    const dateParams: any[] = [];
    let pi = 1;
    if (dateFrom) { dateConds.push(`sv.visit_date >= $${pi++}`); dateParams.push(dateFrom); }
    if (dateTo)   { dateConds.push(`sv.visit_date <= $${pi++}`); dateParams.push(dateTo);   }
    const dateWhere = dateConds.join(" AND ");

    // ── Per-retailer aggregates ──────────────────────────────────────────────
    const { rows: byRetailer } = await pool.query<{
      retailer_id: number; retailer_name: string;
      total_visits: string; last_visit_date: string; first_visit_date: string;
    }>(
      `SELECT sv.retailer_id,
              r.name                               AS retailer_name,
              COUNT(*)                             AS total_visits,
              MAX(sv.visit_date::text)             AS last_visit_date,
              MIN(sv.visit_date::text)             AS first_visit_date
         FROM store_visits sv
         JOIN retailers r ON r.id = sv.retailer_id
        WHERE ${dateWhere}
        GROUP BY sv.retailer_id, r.name
        ORDER BY total_visits DESC`,
      dateParams,
    );

    // ── Monthly per-retailer breakdown ───────────────────────────────────────
    const { rows: monthlyByRetailer } = await pool.query<{
      retailer_id: number; month: string; count: string;
    }>(
      `SELECT sv.retailer_id,
              TO_CHAR(sv.visit_date, 'YYYY-MM') AS month,
              COUNT(*)                           AS count
         FROM store_visits sv
        WHERE ${dateWhere}
        GROUP BY sv.retailer_id, month
        ORDER BY sv.retailer_id, month`,
      dateParams,
    );

    // ── Overall monthly trend ────────────────────────────────────────────────
    const { rows: monthlyTrend } = await pool.query<{ month: string; count: string }>(
      `SELECT TO_CHAR(sv.visit_date, 'YYYY-MM') AS month,
              COUNT(*)                           AS count
         FROM store_visits sv
        WHERE ${dateWhere}
        GROUP BY month
        ORDER BY month`,
      dateParams,
    );

    // ── Overall summary ──────────────────────────────────────────────────────
    const totalVisits       = byRetailer.reduce((s, r) => s + Number(r.total_visits), 0);
    const uniqueRetailers   = byRetailer.length;
    const mostVisited       = byRetailer[0] ?? null;

    // Build monthly map per retailer
    const monthlyMap: Record<number, { month: string; count: number }[]> = {};
    for (const row of monthlyByRetailer) {
      if (!monthlyMap[row.retailer_id]) monthlyMap[row.retailer_id] = [];
      monthlyMap[row.retailer_id].push({ month: row.month, count: Number(row.count) });
    }

    // Calculate avg days between visits per retailer
    const retailerRows = byRetailer.map(r => {
      const tv = Number(r.total_visits);
      let avgDaysBetween: number | null = null;
      if (tv > 1 && r.first_visit_date && r.last_visit_date) {
        const ms  = new Date(r.last_visit_date).getTime() - new Date(r.first_visit_date).getTime();
        avgDaysBetween = Math.round(ms / (1000 * 60 * 60 * 24) / (tv - 1));
      }
      return {
        retailer_id:     r.retailer_id,
        retailer_name:   r.retailer_name,
        total_visits:    tv,
        last_visit_date: r.last_visit_date ?? null,
        first_visit_date: r.first_visit_date ?? null,
        avg_days_between: avgDaysBetween,
        monthly:         monthlyMap[r.retailer_id] ?? [],
      };
    });

    res.json({
      summary: {
        total_visits:        totalVisits,
        unique_retailers:    uniqueRetailers,
        most_visited_name:   mostVisited?.retailer_name ?? null,
        most_visited_count:  mostVisited ? Number(mostVisited.total_visits) : 0,
      },
      by_retailer: retailerRows,
      monthly_trend: monthlyTrend.map(r => ({ month: r.month, count: Number(r.count) })),
    });
  } catch (err: any) {
    console.error("[store-visits/analytics] GET error:", err.message);
    res.status(500).json({ error: "Failed to fetch analytics" });
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
