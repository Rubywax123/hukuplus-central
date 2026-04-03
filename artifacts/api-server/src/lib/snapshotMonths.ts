import { pool } from "@workspace/db";

export interface MonthSnapshot {
  month: string;       // ISO date string for first of month, e.g. "2026-03-01"
  monthLabel: string;  // e.g. "March 2026"
  newApplications: number;
  reApplications: number;
  agreementsIssued: number;
  isLive: boolean;     // true = current month (computed now), false = stored snapshot
}

// ── Compute totals for any month from live data ───────────────────────────────
export async function computeMonthTotals(monthStart: Date): Promise<{
  newApplications: number;
  reApplications: number;
  agreementsIssued: number;
}> {
  const monthEnd = new Date(monthStart);
  monthEnd.setMonth(monthEnd.getMonth() + 1);

  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ task_type: string; count: string }>(`
      SELECT task_type, COUNT(DISTINCT formitize_job_id) AS count
      FROM formitize_notifications
      WHERE task_type IN ('application', 'reapplication', 'agreement')
        AND created_at >= $1
        AND created_at <  $2
      GROUP BY task_type
    `, [monthStart.toISOString(), monthEnd.toISOString()]);

    const get = (t: string) => parseInt(rows.find((r) => r.task_type === t)?.count ?? "0", 10);
    return {
      newApplications: get("application"),
      reApplications:  get("reapplication"),
      agreementsIssued: get("agreement"),
    };
  } finally {
    client.release();
  }
}

// ── Write (upsert) a snapshot for a past month ────────────────────────────────
export async function upsertMonthSnapshot(monthStart: Date, notes?: string): Promise<MonthSnapshot> {
  const totals = await computeMonthTotals(monthStart);
  const monthIso = monthStart.toISOString().split("T")[0]; // e.g. "2026-03-01"

  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO monthly_snapshots (month, new_applications, re_applications, agreements_issued, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (month) DO UPDATE
        SET new_applications  = EXCLUDED.new_applications,
            re_applications   = EXCLUDED.re_applications,
            agreements_issued = EXCLUDED.agreements_issued,
            notes             = COALESCE(EXCLUDED.notes, monthly_snapshots.notes),
            updated_at        = NOW()
    `, [monthIso, totals.newApplications, totals.reApplications, totals.agreementsIssued, notes ?? null]);
  } finally {
    client.release();
  }

  return {
    month: monthIso,
    monthLabel: monthStart.toLocaleString("en-US", { month: "long", year: "numeric" }),
    ...totals,
    isLive: false,
  };
}

// ── Auto-snapshot: called by scheduler on month rollover ─────────────────────
// If the previous calendar month has no snapshot yet, create one automatically.
export async function autoSnapshotPreviousMonth(): Promise<void> {
  const now = new Date();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthIso   = prevMonthStart.toISOString().split("T")[0];

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT id FROM monthly_snapshots WHERE month = $1",
      [prevMonthIso]
    );
    if (rows.length === 0) {
      await upsertMonthSnapshot(prevMonthStart, "auto-snapshot");
      console.log(`[snapshot] Auto-snapshotted ${prevMonthIso}`);
    }
  } finally {
    client.release();
  }
}

// ── Get full history: all stored snapshots + live current month ───────────────
export async function getMonthlyHistory(): Promise<MonthSnapshot[]> {
  const client = await pool.connect();
  let rows: any[] = [];
  try {
    const result = await client.query(`
      SELECT month, new_applications, re_applications, agreements_issued
      FROM monthly_snapshots
      ORDER BY month ASC
    `);
    rows = result.rows;
  } finally {
    client.release();
  }

  const snapshots: MonthSnapshot[] = rows.map((r) => {
    const d = new Date(r.month);
    return {
      month: r.month,
      monthLabel: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      newApplications:  parseInt(r.new_applications, 10),
      reApplications:   parseInt(r.re_applications, 10),
      agreementsIssued: parseInt(r.agreements_issued, 10),
      isLive: false,
    };
  });

  // Append live current-month data
  const now = new Date();
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentMonthIso   = currentMonthStart.toISOString().split("T")[0];

  // Only add live if current month not already in snapshots (it shouldn't be, but guard anyway)
  const alreadyStored = snapshots.some((s) => s.month === currentMonthIso);
  if (!alreadyStored) {
    const live = await computeMonthTotals(currentMonthStart);
    snapshots.push({
      month: currentMonthIso,
      monthLabel: now.toLocaleString("en-US", { month: "long", year: "numeric" }),
      ...live,
      isLive: true,
    });
  }

  return snapshots;
}
