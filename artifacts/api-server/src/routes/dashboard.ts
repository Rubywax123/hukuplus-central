import { Router, type IRouter } from "express";
import { eq, sql, desc, gte } from "drizzle-orm";
import { db, retailersTable, branchesTable, agreementsTable, activityTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { getMonthlyHistory, upsertMonthSnapshot } from "../lib/snapshotMonths";

const LR_URL = process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
const LR_KEY = process.env.CENTRAL_API_KEY;

// Count Loan Register loans whose disbursementDate (or creditApprovalDate) starts
// with yearMonth (e.g. "2026-04"). Fetches all loans — the LR API ignores ?status=
// filters and always returns the full set. Checks all common date field names to
// be resilient against LR schema changes.
async function countLRDisbursementsForMonth(yearMonth: string): Promise<number> {
  if (!LR_KEY) return 0;
  try {
    // Fetch all loans — LR ignores ?status= / ?limit= params; returns everything
    const res = await fetch(`${LR_URL}/api/loans`, {
      headers: {
        Authorization: `Bearer ${LR_KEY}`,
        "X-Central-System": "HukuPlusCentral",
      },
    });
    if (!res.ok) {
      console.warn(`[dashboard] LR API returned ${res.status} when counting disbursements for ${yearMonth}`);
      return 0;
    }
    const raw = await res.json();
    const loans: any[] = Array.isArray(raw) ? raw : (raw?.loans ?? raw?.data ?? []);
    if (loans.length === 0) {
      console.warn(`[dashboard] LR returned 0 loans for disbursement count (month=${yearMonth}). First raw keys: ${Object.keys(raw ?? {}).join(", ")}`);
      return 0;
    }
    // Diagnose field names from first loan
    const sample = loans[0];
    console.log(`[dashboard] LR loan sample keys: ${Object.keys(sample).join(", ")}`);

    // Try all known date field names
    const dateFields = ["disbursementDate", "creditApprovalDate", "loanDate", "date", "startDate", "createdAt", "created_at"];
    const matched = loans.filter((l) => {
      for (const field of dateFields) {
        const val = l[field];
        if (val && String(val).startsWith(yearMonth)) return true;
      }
      return false;
    });
    console.log(`[dashboard] LR disbursement count for ${yearMonth}: ${matched.length} of ${loans.length} loans`);
    return matched.length;
  } catch (err: any) {
    console.error(`[dashboard] LR count error for ${yearMonth}: ${err.message}`);
    return 0;
  }
}

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [totalRetailersResult] = await db.select({ count: sql<number>`count(*)::int` }).from(retailersTable);
  const [totalBranchesResult] = await db.select({ count: sql<number>`count(*)::int` }).from(branchesTable);
  const [totalAgreementsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(agreementsTable);
  const [pendingResult] = await db.select({ count: sql<number>`count(*)::int` }).from(agreementsTable).where(eq(agreementsTable.status, "pending"));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [signedTodayResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agreementsTable)
    .where(sql`status = 'signed' AND signed_at >= ${todayStart.toISOString()}`);

  const productStats = await db
    .select({
      product: agreementsTable.loanProduct,
      total: sql<number>`count(*)::int`,
      pending: sql<number>`sum(case when status = 'pending' then 1 else 0 end)::int`,
      signed: sql<number>`sum(case when status = 'signed' then 1 else 0 end)::int`,
    })
    .from(agreementsTable)
    .groupBy(agreementsTable.loanProduct);

  res.json({
    totalRetailers: totalRetailersResult?.count ?? 0,
    totalBranches: totalBranchesResult?.count ?? 0,
    totalAgreements: totalAgreementsResult?.count ?? 0,
    pendingSignatures: pendingResult?.count ?? 0,
    signedToday: signedTodayResult?.count ?? 0,
    loanProducts: productStats.map((p) => ({
      product: p.product,
      total: p.total ?? 0,
      pending: p.pending ?? 0,
      signed: p.signed ?? 0,
    })),
  });
});

router.get("/dashboard/recent-activity", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const activity = await db.select().from(activityTable).orderBy(desc(activityTable.timestamp)).limit(20);
  res.json(activity);
});

// ── Monthly business metrics: new applications, re-applications, agreements issued
// Dedup: each unique formitize_job_id = 1 event (webhooks can fire multiple times
// per job but the unique index on formitize_job_id ensures only 1 row per event).
router.get("/dashboard/monthly-metrics", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const now = new Date();
  const currentYM  = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate   = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousYM = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const client = await pool.connect();
  try {
    // Applications + re-applications: sourced from Formitize notifications
    const { rows } = await client.query<{ task_type: string; current_month: string; prev_month: string }>(`
      SELECT
        task_type,
        COUNT(DISTINCT formitize_job_id)
          FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) AS current_month,
        COUNT(DISTINCT formitize_job_id)
          FILTER (WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
                    AND created_at <  DATE_TRUNC('month', NOW())) AS prev_month
      FROM formitize_notifications
      WHERE task_type IN ('application', 'reapplication')
        AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
      GROUP BY task_type
    `);

    const get = (type: string, col: "current_month" | "prev_month") =>
      parseInt(rows.find((r) => r.task_type === type)?.[col] ?? "0", 10);

    // Agreements: sourced from Loan Register by disbursementDate — the ground truth.
    // Each loan in the LR is a unique disbursement; no double-counting possible.
    const [currentAgreements, previousAgreements] = await Promise.all([
      countLRDisbursementsForMonth(currentYM),
      countLRDisbursementsForMonth(previousYM),
    ]);

    const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

    res.json({
      month: monthLabel,
      newApplications: {
        current: get("application", "current_month"),
        previous: get("application", "prev_month"),
      },
      reApplications: {
        current: get("reapplication", "current_month"),
        previous: get("reapplication", "prev_month"),
      },
      agreementsIssued: {
        current:  currentAgreements,
        previous: previousAgreements,
      },
    });
  } finally {
    client.release();
  }
});

// ── Full monthly history: stored snapshots + live current month ───────────────
router.get("/dashboard/monthly-history", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const history = await getMonthlyHistory();
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Manual snapshot trigger (super_admin only) ────────────────────────────────
// POST /api/dashboard/snapshot-month
// Body: { month: "2026-03" }   — locks in totals for that calendar month
router.post("/dashboard/snapshot-month", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const user = req.user as any;
  if (user?.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only" });
    return;
  }

  const { month } = req.body as { month?: string };
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "Provide month as YYYY-MM, e.g. \"2026-03\"" });
    return;
  }

  const [year, mon] = month.split("-").map(Number);
  const monthStart = new Date(year, mon - 1, 1);

  // Refuse to snapshot the current month — that's always live
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  if (monthStart >= currentMonthStart) {
    res.status(400).json({ error: "Cannot snapshot the current month — it is always computed live." });
    return;
  }

  try {
    const snapshot = await upsertMonthSnapshot(monthStart, `manual snapshot by ${user.email ?? user.username}`);
    res.json({ ok: true, snapshot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
