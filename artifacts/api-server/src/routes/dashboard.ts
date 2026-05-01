import { Router, type IRouter } from "express";
import { eq, sql, desc, gte, and, isNull } from "drizzle-orm";
import { db, retailersTable, branchesTable, agreementsTable, activityTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { getMonthlyHistory, upsertMonthSnapshot } from "../lib/snapshotMonths";

const LR_URL = process.env.HUKUPLUS_URL || "https://loan-manager-automate.replit.app";
const LR_KEY = process.env.HUKUPLUS_API_KEY;

// Only match on disbursementDate — the LR web UI groups loans by when money left the door,
// not by creditApprovalDate or createdAt (which can fall in a different month).
const DATE_FIELDS = ["disbursementDate"];

// Try to fetch loans from the LR API using multiple auth patterns.
// Returns the parsed loans array, or null if all patterns fail.
async function fetchLRLoans(): Promise<any[] | null> {
  if (!LR_KEY) return null;

  // Pattern 1: same auth as the working stores sync — no X-Central-System header
  const patterns = [
    { url: `${LR_URL}/api/central/loans`, headers: { Authorization: `Bearer ${LR_KEY}` } },
    { url: `${LR_URL}/api/loans`,         headers: { Authorization: `Bearer ${LR_KEY}` } },
    { url: `${LR_URL}/api/loans`,         headers: { Authorization: `Bearer ${LR_KEY}`, "X-Central-System": "HukuPlusCentral" } },
  ];

  for (const { url, headers } of patterns) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        console.warn(`[dashboard] LR fetch ${url} → ${res.status}`);
        continue;
      }
      const raw = await res.json();
      const loans: any[] = Array.isArray(raw) ? raw : (raw?.loans ?? raw?.data ?? []);
      if (loans.length > 0) {
        console.log(`[dashboard] LR loans fetched via ${url} — ${loans.length} total. Sample keys: ${Object.keys(loans[0]).join(", ")}`);
        return loans;
      }
    } catch (err: any) {
      console.warn(`[dashboard] LR fetch error (${url}): ${err.message}`);
    }
  }
  return null;
}

// Count agreements issued in a given month. Primary source: Loan Register API.
// Fallback: local agreements table (which the Xero sync populates from Xero invoices).
async function countLRDisbursementsForDay(dateStr: string): Promise<number> {
  const loans = await fetchLRLoans();
  if (loans !== null) {
    const matched = loans.filter((l) => {
      if (String(l.loanType ?? "").toLowerCase() !== "hukuplus") return false;
      for (const field of DATE_FIELDS) {
        if (l[field] && String(l[field]).startsWith(dateStr)) return true;
      }
      return false;
    });
    return matched.length;
  }
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ count: string }>(`
        SELECT COUNT(*)::int AS count
        FROM agreements
        WHERE form_type = 'agreement'
          AND (
            (disbursement_date IS NOT NULL AND disbursement_date >= DATE_TRUNC('day', NOW()) AND disbursement_date < DATE_TRUNC('day', NOW()) + INTERVAL '1 day')
            OR  (disbursement_date IS NULL  AND created_at        >= DATE_TRUNC('day', NOW()) AND created_at        < DATE_TRUNC('day', NOW()) + INTERVAL '1 day')
          )
      `);
      return parseInt(rows[0]?.count ?? "0", 10);
    } finally {
      client.release();
    }
  } catch {
    return 0;
  }
}

async function countLRDisbursementsForMonth(yearMonth: string): Promise<number> {
  // ── Try LR API first ──────────────────────────────────────────────────────
  const loans = await fetchLRLoans();
  if (loans !== null) {
    // Count HukuPlus loans disbursed in yearMonth.
    // Uses disbursementDate only (not creditApprovalDate) to match LR web UI grouping.
    const matched = loans.filter((l) => {
      if (String(l.loanType ?? "").toLowerCase() !== "hukuplus") return false;
      for (const field of DATE_FIELDS) {
        if (l[field] && String(l[field]).startsWith(yearMonth)) return true;
      }
      return false;
    });
    console.log(`[dashboard] LR HukuPlus disbursement count for ${yearMonth}: ${matched.length} of ${loans.length}`);
    return matched.length;
  }

  // ── Fallback: count from local agreements table ───────────────────────────
  // Xero sync records each AUTHORISED invoice as an agreement with disbursement_date.
  console.warn(`[dashboard] LR API unavailable — counting agreements from local DB for ${yearMonth}`);
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ count: string }>(`
        SELECT COUNT(*)::int AS count
        FROM agreements
        WHERE form_type = 'agreement'
          AND (
            (disbursement_date IS NOT NULL AND to_char(disbursement_date, 'YYYY-MM') = $1)
            OR (disbursement_date IS NULL AND to_char(created_at, 'YYYY-MM') = $1)
          )
      `, [yearMonth]);
      const count = parseInt(rows[0]?.count ?? "0", 10);
      console.log(`[dashboard] Local DB agreements for ${yearMonth}: ${count}`);
      return count;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error(`[dashboard] Local agreements count error for ${yearMonth}: ${err.message}`);
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
  // Pending Signatures: Novafeeds only — these are the agreements signed in the kiosk.
  // Other products come from Formitize and don't require kiosk signing.
  // "Mark Done" dismisses an agreement from this count.
  const [pendingResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agreementsTable)
    .where(and(
      eq(agreementsTable.status, "pending"),
      eq(agreementsTable.loanProduct, "Novafeeds"),
      isNull(agreementsTable.markedDoneAt),
    ));

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
      pending: sql<number>`sum(case when status = 'pending' and marked_done_at is null then 1 else 0 end)::int`,
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
    const { rows } = await client.query<{ task_type: string; current_month: string; prev_month: string; today: string }>(`
      SELECT
        task_type,
        COUNT(DISTINCT formitize_job_id)
          FILTER (WHERE created_at >= DATE_TRUNC('month', NOW())) AS current_month,
        COUNT(DISTINCT formitize_job_id)
          FILTER (WHERE created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
                    AND created_at <  DATE_TRUNC('month', NOW())) AS prev_month,
        COUNT(DISTINCT formitize_job_id)
          FILTER (WHERE created_at >= DATE_TRUNC('day', NOW())) AS today
      FROM formitize_notifications
      WHERE task_type IN ('application', 'reapplication')
        AND created_at >= DATE_TRUNC('month', NOW() - INTERVAL '1 month')
      GROUP BY task_type
    `);

    const get = (type: string, col: "current_month" | "prev_month" | "today") =>
      parseInt(rows.find((r) => r.task_type === type)?.[col] ?? "0", 10);

    // Today's date string for LR daily count
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Agreements: Loan Register is the ground truth — it counts only disbursed loans,
    // which is the correct definition of "agreements issued". Formitize agreements
    // include signed-but-not-yet-disbursed loans which must not be counted yet.
    const [currentAgreements, previousAgreements, todayAgreements] = await Promise.all([
      countLRDisbursementsForMonth(currentYM),
      countLRDisbursementsForMonth(previousYM),
      countLRDisbursementsForDay(todayStr),
    ]);

    const monthLabel = now.toLocaleString("en-US", { month: "long", year: "numeric" });

    res.json({
      month: monthLabel,
      newApplications: {
        current:  get("application", "current_month"),
        previous: get("application", "prev_month"),
        today:    get("application", "today"),
      },
      reApplications: {
        current:  get("reapplication", "current_month"),
        previous: get("reapplication", "prev_month"),
        today:    get("reapplication", "today"),
      },
      agreementsIssued: {
        current:  currentAgreements,
        previous: previousAgreements,
        today:    todayAgreements,
      },
    });
  } finally {
    client.release();
  }
});

// ── Applications detail drill-down ────────────────────────────────────────────
router.get("/dashboard/applications-detail", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const type = req.query.type as string; // "application" | "reapplication"
  if (!["application", "reapplication"].includes(type)) {
    res.status(400).json({ error: "Invalid type" }); return;
  }

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT
        formitize_job_id,
        form_name,
        customer_name,
        customer_phone,
        customer_id,
        branch_name,
        retailer_name,
        is_duplicate_warning,
        created_at
      FROM formitize_notifications
      WHERE task_type = $1
        AND created_at >= DATE_TRUNC('month', NOW())
      ORDER BY customer_name ASC, created_at ASC
    `, [type]);

    // Group by customer name so the UI can highlight repeat submitters
    const byCustomer: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = (row.customer_name ?? "Unknown").trim().toLowerCase();
      if (!byCustomer[key]) byCustomer[key] = [];
      byCustomer[key].push(row);
    }

    res.json({
      total: rows.length,
      rows,
      duplicateCustomers: Object.values(byCustomer)
        .filter(g => g.length > 1)
        .map(g => (g[0].customer_name ?? "Unknown").trim()),
    });
  } finally {
    client.release();
  }
});

// ── Re-application conversion: paid this month → re-applied? ─────────────────
// Source of truth for "paid" = Loan Register API (status='completed',
// completedAt in current month).  "Re-applied" = matching Formitize
// reapplication notification this month, matched by normalised phone or
// national ID.
router.get("/dashboard/reapplication-conversion", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  // Re-applications: rolling 60-day window — only recent re-apps count.
  // Completed loans: rolling 12-month window — any customer who finished a
  // loan in the past year and comes back is counted as a conversion, regardless
  // of how long they took to return (e.g. Fidelis, Oct completion).
  const reappCutoff     = new Date(Date.now() - 60  * 24 * 60 * 60 * 1000);
  const completedCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const reappCutoffISO     = reappCutoff.toISOString();
  const completedCutoffISO = completedCutoff.toISOString();

  // ── 1. Fetch completed loans from the Loan Register ───────────────────────
  const loans = await fetchLRLoans();
  if (loans === null) {
    res.status(503).json({ error: "Loan Register unavailable" });
    return;
  }

  const completedLoans = loans.filter((l: any) =>
    l.status === "completed" &&
    l.completedAt &&
    String(l.completedAt) >= completedCutoffISO
  );

  // ── 2. Fetch re-application notifications in the same rolling window ──────
  const client = await pool.connect();
  let reappRows: any[] = [];
  try {
    const { rows } = await client.query(`
      SELECT
        fn.customer_name,
        fn.customer_phone,
        fn.customer_id,
        c.national_id,
        c.nok_phone
      FROM formitize_notifications fn
      LEFT JOIN customers c ON c.id = fn.customer_id
      WHERE fn.task_type = 'reapplication'
        AND fn.created_at >= $1
    `, [reappCutoffISO]);
    reappRows = rows;
  } finally {
    client.release();
  }

  // ── 3. Build normalised lookup sets for matching ──────────────────────────
  // Strips everything except digits, takes last 9 characters (local number)
  function normPhone(p: string | null | undefined): string | null {
    if (!p) return null;
    const digits = String(p).replace(/\D/g, "");
    return digits.length >= 7 ? digits.slice(-9) : null;
  }
  // Strips spaces/hyphens, uppercase
  function normId(id: string | null | undefined): string | null {
    if (!id) return null;
    return String(id).replace(/[\s\-]/g, "").toUpperCase();
  }

  const reappPhones = new Set<string>();
  const reappIds    = new Set<string>();
  const reappNames  = new Set<string>();
  for (const r of reappRows) {
    const p = normPhone(r.customer_phone); if (p) reappPhones.add(p);
    const i = normId(r.national_id);       if (i) reappIds.add(i);
    if (r.customer_name) reappNames.add(r.customer_name.trim().toLowerCase());
  }

  // ── 4. Tag each completed loan as reapplied or not ───────────────────────
  const customers = completedLoans.map((l: any) => {
    const phone     = normPhone(l.telephone);
    const nationalId = normId(l.idPassport);
    const fullName  = `${l.clientGivenName ?? ""} ${l.clientSurname ?? ""}`.trim();

    const reapplied =
      (phone && reappPhones.has(phone)) ||
      (nationalId && reappIds.has(nationalId)) ||
      reappNames.has(fullName.toLowerCase());

    return {
      full_name:     fullName,
      phone:         l.telephone ?? null,
      national_id:   l.idPassport ?? null,
      nok_phone:     null,           // LR doesn't expose NOK phone
      retailer_name: l.retailer ?? l.profeeds ?? null,
      branch_name:   l.officeBranch ?? l.branch ?? null,
      loan_product:  l.loanType ?? null,
      repayment_date: l.completedAt ? String(l.completedAt).slice(0, 10) : null,
      reapplied,
    };
  });

  // Sort: not-reapplied first (the action list), then alphabetical within each group
  customers.sort((a: any, b: any) => {
    if (a.reapplied !== b.reapplied) return a.reapplied ? 1 : -1;
    return a.full_name.localeCompare(b.full_name);
  });

  const paid      = customers.length;
  const reapplied = customers.filter((c: any) => c.reapplied).length;
  const rate      = paid > 0 ? Math.round((reapplied / paid) * 100) : 0;

  res.json({ paid, reapplied, rate, customers });
});

// ── Delete a notification (and its unprocessed agreement if present) ──────────
router.delete("/dashboard/applications/:jobId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const jobId = req.params.jobId;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Remove the notification
    const { rowCount: notifDeleted } = await client.query(
      `DELETE FROM formitize_notifications WHERE formitize_job_id = $1`, [jobId]
    );

    // Remove the linked agreement only if it is still in raw application status
    // (never touch anything that has progressed to pending/signed/disbursed)
    const { rowCount: agreeDeleted } = await client.query(
      `DELETE FROM agreements
       WHERE formitize_job_id = $1
         AND status IN ('application', 'reapplication')`, [jobId]
    );

    await client.query("COMMIT");
    res.json({ deleted: true, notifDeleted, agreeDeleted });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── LR cohort health: per-disbursement-month overdue + bad loan counts ────────
// For each month a cohort of loans was disbursed, shows how many are now sitting
// in overdue (past due date, still active) and how many are bad loans.
// This is always live — data comes directly from the Loan Register API.

router.get("/dashboard/lr-cohort-stats", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const loans = await fetchLRLoans();
  if (!loans) {
    res.status(503).json({ error: "Loan Register unavailable" });
    return;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Mirror the LR's three statuses exactly:
  //   completed = paid off (good outcome)
  //   bad       = written off (bad outcome)
  //   active    = still open — subdivided into on-time vs overdue by due date
  const monthMap = new Map<string, {
    disbursed: number;
    completed: number;  // status="completed"
    active: number;     // status="active", due date not yet passed
    overdue: number;    // status="active", due date in the past
    bad: number;        // status="bad"
  }>();

  for (const loan of loans) {
    if (String(loan.loanType ?? "").toLowerCase() !== "hukuplus") continue;
    const disbStr = loan.disbursementDate;
    if (!disbStr) continue;

    const month = String(disbStr).slice(0, 7);
    if (!monthMap.has(month)) {
      monthMap.set(month, { disbursed: 0, completed: 0, active: 0, overdue: 0, bad: 0 });
    }
    const entry = monthMap.get(month)!;
    entry.disbursed++;

    const loanStatus = String(loan.status ?? "").toLowerCase();

    if (loanStatus === "completed") {
      entry.completed++;
    } else if (loanStatus === "bad") {
      entry.bad++;
    } else {
      // status="active" — check whether it's past its due date
      if (loan.dueDate) {
        const due = new Date(loan.dueDate);
        due.setHours(0, 0, 0, 0);
        if (today > due) {
          entry.overdue++;
        } else {
          entry.active++;
        }
      } else {
        entry.active++;
      }
    }
  }

  // Sort months newest-first, attach human label
  const result = Array.from(monthMap.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, stats]) => {
      const [year, mon] = month.split("-").map(Number);
      const monthLabel = new Date(year, mon - 1, 1)
        .toLocaleString("en-US", { month: "short", year: "numeric" });
      return { month, monthLabel, ...stats };
    });

  res.json(result);
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

// ── Disbursement Pipeline ──────────────────────────────────────────────────────
// Returns open applications (status = 'application' | 'reapplication') grouped
// by their disbursement / stock-collection date.
// • Items with a past disbursement date are EXCLUDED (forward-only view).
// • Items with no date are shown only if created in the last 30 days.
// • Items fall away automatically once their status moves to pending/signed/expired.
router.get("/dashboard/disbursement-pipeline", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await pool.query<{
    id: number;
    customer_name: string;
    customer_phone: string | null;
    loan_amount: string | null;
    loan_product: string | null;
    status: string;
    retailer_name: string | null;
    branch_name: string | null;
    collection_date: string | null;
    created_at: string;
  }>(`
    SELECT
      a.id,
      -- Customer name: DB column first; fallback is form-specific
      --   New App   : formText_6 = Full Name and Surname
      --   Re-App    : formText_1 = Customer Name
      COALESCE(
        NULLIF(a.customer_name, ''),
        CASE a.status
          WHEN 'application'   THEN a.form_data->>'formtext_6'
          WHEN 'reapplication' THEN a.form_data->>'formtext_1'
        END
      )                                                                            AS customer_name,
      a.customer_phone,
      a.loan_amount,
      a.loan_product,
      a.status,
      -- Retailer: joined table first; fallback is form-specific
      --   New App : formRadio_3   Re-App : formRadio_4
      COALESCE(
        r.name,
        CASE a.status
          WHEN 'application'   THEN a.form_data->>'formradio_3'
          WHEN 'reapplication' THEN a.form_data->>'formradio_4'
        END
      )                                                                            AS retailer_name,
      -- Branch: joined table first; fallback is form-specific
      --   New App : formText_1   Re-App : formText_3
      COALESCE(
        b.name,
        CASE a.status
          WHEN 'application'   THEN a.form_data->>'formtext_1'
          WHEN 'reapplication' THEN a.form_data->>'formtext_3'
        END
      )                                                                            AS branch_name,
      -- Collection date: stored disbursement_date first; fallback is form-specific
      --   New App : formDate_2   Re-App : formDate_3
      COALESCE(
        a.disbursement_date,
        CASE a.status
          WHEN 'application'   THEN a.form_data->>'formdate_2'
          WHEN 'reapplication' THEN a.form_data->>'formdate_3'
        END
      )                                                                            AS collection_date,
      a.created_at
    FROM agreements a
    LEFT JOIN retailers r ON r.id = a.retailer_id
    LEFT JOIN branches  b ON b.id = a.branch_id
    WHERE a.status IN ('application', 'reapplication')
    ORDER BY a.created_at DESC
    LIMIT 1000
  `);

  // ── Date parsing ──────────────────────────────────────────────────────────
  const MONTH_NAMES = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

  function parseAnyDate(raw: string | null | undefined): Date | null {
    if (!raw || typeof raw !== "string") return null;
    const s = raw.trim().replace(/\s+/g, " ");
    if (s.length < 6) return null;

    // ISO: 2026-05-20[T...]
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const d = new Date(s.slice(0, 10));
      return isNaN(d.getTime()) ? null : d;
    }
    // UK numeric: 20/05/2026 or 20-05-2026
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const d = new Date(+m[3], +m[2] - 1, +m[1]);
      return isNaN(d.getTime()) ? null : d;
    }
    // "20 May 2026" / "20th May 2026" / "6th Apr 2026"
    m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s+(\d{4})$/i);
    if (m) {
      const mi = MONTH_NAMES.indexOf(m[2].toLowerCase().slice(0, 3));
      if (mi >= 0) {
        const d = new Date(+m[3], mi, +m[1]);
        return isNaN(d.getTime()) ? null : d;
      }
    }
    // "May 20 2026" / "May 20, 2026"
    m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
    if (m) {
      const mi = MONTH_NAMES.indexOf(m[1].toLowerCase().slice(0, 3));
      if (mi >= 0) {
        const d = new Date(+m[3], mi, +m[2]);
        return isNaN(d.getTime()) ? null : d;
      }
    }
    return null;
  }

  function getDisbDate(row: typeof rows.rows[0]): Date | null {
    // The SQL query already COALESCEs disbursement_date with form_data->>'formdate_2'
    // (and formdate_2 is the "Expected Date of Stock Collection" on New Customer Application forms)
    return parseAnyDate(row.collection_date);
  }

  interface PipelineItem {
    id: number;
    customerName: string;
    customerPhone: string | null;
    loanAmount: number | null;
    loanProduct: string | null;
    status: string;
    retailerName: string | null;
    branchName: string | null;
    disbursementDate: string | null;
    createdAt: string;
    walkIn: boolean;
  }

  // Walk-in: collection date is same day or next day as form submission
  function isWalkIn(disbDate: Date, createdAt: Date): boolean {
    const submittedDay = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
    const collDay     = new Date(disbDate.getFullYear(), disbDate.getMonth(), disbDate.getDate());
    const diffMs = collDay.getTime() - submittedDay.getTime();
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays <= 1;
  }

  const now = new Date();
  // Start of today — exclude items whose disbursement date has already passed
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // "No date" cutoff: only show applications created in the last 30 days
  const thirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30);

  // Buckets: map of "YYYY-MM" → items[], plus noDate and walkIns
  const monthBuckets = new Map<string, PipelineItem[]>();
  const noDateItems: PipelineItem[] = [];
  const walkInItems: PipelineItem[] = [];

  for (const row of rows.rows) {
    const disbDate  = getDisbDate(row);
    const createdAt = new Date(row.created_at);
    const walkIn    = disbDate ? isWalkIn(disbDate, createdAt) : false;

    const item: PipelineItem = {
      id: row.id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      loanAmount: row.loan_amount ? parseFloat(row.loan_amount) : null,
      loanProduct: row.loan_product,
      status: row.status,
      retailerName: row.retailer_name,
      branchName: row.branch_name,
      disbursementDate: disbDate ? disbDate.toISOString().slice(0, 10) : null,
      createdAt: row.created_at,
      walkIn,
    };

    // Walk-ins get their own section regardless of date
    if (walkIn) {
      walkInItems.push(item);
      continue;
    }

    if (!disbDate) {
      // Only include recent no-date applications
      if (createdAt >= thirtyDaysAgo) noDateItems.push(item);
    } else if (disbDate >= todayStart) {
      // Forward-only: exclude past dates
      const key = `${disbDate.getFullYear()}-${String(disbDate.getMonth() + 1).padStart(2, "0")}`;
      if (!monthBuckets.has(key)) monthBuckets.set(key, []);
      monthBuckets.get(key)!.push(item);
    }
    // else: disbursement date is in the past → silently excluded
  }

  // Sort buckets chronologically and sort items within each bucket by date
  const sortedKeys = [...monthBuckets.keys()].sort();
  const byDate = (a: PipelineItem, b: PipelineItem) =>
    (a.disbursementDate ?? "").localeCompare(b.disbursementDate ?? "");

  const fmtMonthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  };

  const months = sortedKeys.map(key => ({
    key,
    label: fmtMonthLabel(key),
    items: (monthBuckets.get(key) ?? []).sort(byDate),
  }));

  // Walk-ins sorted most-recent first (newest submission at top)
  walkInItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalOpen = months.reduce((s, m) => s + m.items.length, 0) + noDateItems.length + walkInItems.length;

  res.json({
    months,
    noDate:  { label: "Date Not Yet Set", items: noDateItems },
    walkIns: { label: "Walk-ins", items: walkInItems },
    totalOpen,
  });
});

export default router;


