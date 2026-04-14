import { Router } from "express";
import { db, portalUsersTable, agreementsTable, retailersTable, branchesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import {
  createPortalSession,
  deletePortalSession,
  getPortalSessionId,
  hashPassword,
  verifyPassword,
  setPortalCookie,
  clearPortalCookie,
} from "../lib/portalAuth";
import { requirePortalAuth, requirePortalAdmin } from "../middlewares/portalAuthMiddleware";
import { requireStaffAuth } from "../middlewares/staffAuthMiddleware";
import { pool } from "@workspace/db";

const router = Router();

// ── Portal Auth ──────────────────────────────────────────────────────────────

router.post("/portal/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const [user] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.email, email.toLowerCase().trim()));
  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const [retailer] = await db.select({ name: retailersTable.name })
    .from(retailersTable).where(eq(retailersTable.id, user.retailerId));

  const sid = await createPortalSession({
    portalUserId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    retailerId: user.retailerId,
    retailerName: retailer?.name ?? "",
    branchId: user.branchId,
  });

  setPortalCookie(res, sid);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    retailerId: user.retailerId,
    retailerName: retailer?.name ?? "",
    branchId: user.branchId,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/portal/logout", async (req, res) => {
  const sid = getPortalSessionId(req);
  if (sid) await deletePortalSession(sid);
  clearPortalCookie(res);
  res.json({ ok: true });
});

router.get("/portal/me", requirePortalAuth, async (req, res) => {
  const user = req.portalUser!;
  // Always resolve retailerName live so old sessions without it still work
  if (!user.retailerName) {
    const [retailer] = await db.select({ name: retailersTable.name })
      .from(retailersTable).where(eq(retailersTable.id, user.retailerId));
    res.json({ ...user, retailerName: retailer?.name ?? "" });
  } else {
    res.json(user);
  }
});

router.post("/portal/change-password", requirePortalAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }
  const [user] = await db.select().from(portalUsersTable).where(eq(portalUsersTable.id, req.portalUser!.portalUserId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  const hash = await hashPassword(newPassword);
  await db.update(portalUsersTable).set({ passwordHash: hash, mustChangePassword: false }).where(eq(portalUsersTable.id, user.id));
  res.json({ ok: true });
});

// ── Portal Agreements (Novafeeds kiosk only — ringfenced by retailer) ────────

router.get("/portal/agreements", requirePortalAuth, async (req, res) => {
  const { retailerId, branchId, role } = req.portalUser!;
  let retailerName = req.portalUser!.retailerName ?? "";

  // Re-fetch retailerName for old sessions that predate the field
  if (!retailerName) {
    const [r] = await db.select({ name: retailersTable.name })
      .from(retailersTable).where(eq(retailersTable.id, retailerId));
    retailerName = r?.name ?? "";
  }

  // Ringfence: only Novafeeds portal users may access kiosk agreements
  if (!retailerName.toLowerCase().includes("novafeed")) {
    res.status(403).json({ error: "Kiosk agreements are restricted to Novafeeds portal users." });
    return;
  }

  let query = db
    .select({
      id: agreementsTable.id,
      customerName: agreementsTable.customerName,
      customerPhone: agreementsTable.customerPhone,
      loanProduct: agreementsTable.loanProduct,
      loanAmount: agreementsTable.loanAmount,
      status: agreementsTable.status,
      signedAt: agreementsTable.signedAt,
      createdAt: agreementsTable.createdAt,
      branchId: agreementsTable.branchId,
      branchName: branchesTable.name,
      branchLocation: branchesTable.location,
      formitizeJobId: agreementsTable.formitizeJobId,
      signingToken: agreementsTable.signingToken,
    })
    .from(agreementsTable)
    .leftJoin(branchesTable, eq(agreementsTable.branchId, branchesTable.id))
    .orderBy(desc(agreementsTable.createdAt));

  const conditions = [eq(agreementsTable.retailerId, retailerId)];
  if (role === "store_staff" && branchId) {
    conditions.push(eq(agreementsTable.branchId, branchId));
  }

  const results = await query.where(and(...conditions));
  res.json(results);
});

router.get("/portal/agreements/:id", requirePortalAuth, async (req, res) => {
  const id = parseInt(req.params.id);
  const { retailerId, branchId, role } = req.portalUser!;

  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .leftJoin(branchesTable, eq(agreementsTable.branchId, branchesTable.id))
    .where(eq(agreementsTable.id, id));

  if (!agreement) { res.status(404).json({ error: "Not found" }); return; }
  if (agreement.agreements.retailerId !== retailerId) { res.status(403).json({ error: "Access denied" }); return; }
  if (role === "store_staff" && branchId && agreement.agreements.branchId !== branchId) {
    res.status(403).json({ error: "Access denied" }); return;
  }
  res.json(agreement);
});

// ── Portal User Management (internal Tefco admin only) ───────────────────────

router.get("/portal/users", async (req, res) => {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const retailerIdFilter = req.query.retailerId ? parseInt(req.query.retailerId as string) : null;
  let query = db
    .select({
      id: portalUsersTable.id,
      name: portalUsersTable.name,
      email: portalUsersTable.email,
      role: portalUsersTable.role,
      retailerId: portalUsersTable.retailerId,
      branchId: portalUsersTable.branchId,
      isActive: portalUsersTable.isActive,
      mustChangePassword: portalUsersTable.mustChangePassword,
      createdAt: portalUsersTable.createdAt,
      retailerName: retailersTable.name,
      branchName: branchesTable.name,
    })
    .from(portalUsersTable)
    .leftJoin(retailersTable, eq(portalUsersTable.retailerId, retailersTable.id))
    .leftJoin(branchesTable, eq(portalUsersTable.branchId, branchesTable.id))
    .$dynamic();
  if (retailerIdFilter) {
    query = query.where(eq(portalUsersTable.retailerId, retailerIdFilter));
  }
  const users = await query.orderBy(desc(portalUsersTable.createdAt));
  res.json(users);
});

router.post("/portal/users", async (req, res) => {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { name, email, password, retailerId, branchId, role } = req.body;
  if (!name || !email || !password || !retailerId || !role) {
    res.status(400).json({ error: "name, email, password, retailerId, role required" });
    return;
  }
  if (!["retailer_admin", "store_staff"].includes(role)) {
    res.status(400).json({ error: "role must be retailer_admin or store_staff" });
    return;
  }
  if (role === "store_staff" && !branchId) {
    res.status(400).json({ error: "branchId required for store_staff" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(portalUsersTable).values({
    name,
    email: email.toLowerCase().trim(),
    passwordHash,
    retailerId: parseInt(retailerId),
    branchId: branchId ? parseInt(branchId) : null,
    role,
    mustChangePassword: true,
  }).returning();
  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.patch("/portal/users/:id", async (req, res) => {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const id = parseInt(req.params.id);
  const { isActive, password, name, email } = req.body;
  const updates: any = {};
  if (name !== undefined) updates.name = name;
  if (email !== undefined) updates.email = email.toLowerCase().trim();
  if (isActive !== undefined) updates.isActive = isActive;
  if (password) { updates.passwordHash = await hashPassword(password); updates.mustChangePassword = true; }
  await db.update(portalUsersTable).set(updates).where(eq(portalUsersTable.id, id));
  res.json({ ok: true });
});

router.delete("/portal/users/:id", async (req, res) => {
  if (!req.isAuthenticated?.()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.delete(portalUsersTable).where(eq(portalUsersTable.id, parseInt(req.params.id)));
  res.json({ ok: true });
});

// ── Agronomist Management (staff-only CRUD) ───────────────────────────────────

router.get("/portal/agronomists", requireStaffAuth, async (_req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT pu.id, pu.name, pu.email, pu.role, pu.is_active, pu.must_change_password,
             pu.retailer_id, pu.branch_id, pu.created_at,
             ret.name AS retailer_name, br.name AS branch_name
      FROM portal_users pu
      LEFT JOIN retailers ret ON ret.id = pu.retailer_id
      LEFT JOIN branches br ON br.id = pu.branch_id
      WHERE pu.role = 'agronomist'
      ORDER BY pu.created_at DESC
    `);
    res.json(r.rows);
  } finally {
    client.release();
  }
});

router.post("/portal/agronomists", requireStaffAuth, async (req, res) => {
  const { name, email, password, retailerId, branchId } = req.body;
  if (!name || !email || !password || !retailerId) {
    res.status(400).json({ error: "name, email, password, retailerId required" });
    return;
  }
  const hash = await hashPassword(password);
  const client = await pool.connect();
  try {
    const r = await client.query(
      `INSERT INTO portal_users (name, email, password_hash, retailer_id, branch_id, role, must_change_password)
       VALUES ($1, $2, $3, $4, $5, 'agronomist', true)
       RETURNING id, name, email, role, retailer_id, branch_id, is_active, created_at`,
      [name.trim(), email.toLowerCase().trim(), hash, parseInt(retailerId), branchId ? parseInt(branchId) : null]
    );
    res.status(201).json(r.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      res.status(409).json({ error: "An account with this email already exists" });
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
});

router.patch("/portal/agronomists/:id", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, email, password, isActive, retailerId, branchId } = req.body;
  const client = await pool.connect();
  try {
    const sets: string[] = ["updated_at = NOW()"];
    const params: any[] = [];
    if (name !== undefined) { params.push(name.trim()); sets.push(`name = $${params.length}`); }
    if (email !== undefined) { params.push(email.toLowerCase().trim()); sets.push(`email = $${params.length}`); }
    if (isActive !== undefined) { params.push(isActive); sets.push(`is_active = $${params.length}`); }
    if (retailerId !== undefined) { params.push(parseInt(retailerId)); sets.push(`retailer_id = $${params.length}`); }
    if (branchId !== undefined) { params.push(branchId ? parseInt(branchId) : null); sets.push(`branch_id = $${params.length}`); }
    if (password) {
      const hash = await hashPassword(password);
      params.push(hash); sets.push(`password_hash = $${params.length}`);
      sets.push("must_change_password = true");
    }
    params.push(id);
    await client.query(
      `UPDATE portal_users SET ${sets.join(", ")} WHERE id = $${params.length} AND role = 'agronomist'`,
      params
    );
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

router.delete("/portal/agronomists/:id", requireStaffAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE portal_users SET is_active = false, updated_at = NOW() WHERE id = $1 AND role = 'agronomist'`,
      [id]
    );
    res.json({ ok: true });
  } finally {
    client.release();
  }
});

// ── Agronomist: own submitted leads ──────────────────────────────────────────

router.get("/portal/agronomist/leads", requirePortalAuth, async (req, res) => {
  const portalUser = req.portalUser!;
  if (portalUser.role !== "agronomist") {
    res.status(403).json({ error: "Agronomist access only" });
    return;
  }
  const submittedByPattern = `%<${portalUser.email}>%`;
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id, customer_name, phone, retailer_name, branch_name, flock_size,
              (flock_size::numeric * 2.06) AS estimated_value,
              status, submitted_by, notes, created_at
       FROM leads
       WHERE submitted_by LIKE $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [submittedByPattern]
    );
    res.json(r.rows);
  } finally {
    client.release();
  }
});

export default router;
