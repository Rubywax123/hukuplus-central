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

  const sid = await createPortalSession({
    portalUserId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    retailerId: user.retailerId,
    branchId: user.branchId,
  });

  setPortalCookie(res, sid);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    retailerId: user.retailerId,
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

router.get("/portal/me", requirePortalAuth, (req, res) => {
  res.json(req.portalUser);
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

// ── Portal Agreements (filtered by role) ─────────────────────────────────────

router.get("/portal/agreements", requirePortalAuth, async (req, res) => {
  const { retailerId, branchId, role } = req.portalUser!;

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

export default router;
