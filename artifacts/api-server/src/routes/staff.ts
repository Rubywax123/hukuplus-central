import { Router } from "express";
import { db, staffUsersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  createStaffSession,
  deleteStaffSession,
  getStaffSessionId,
  hashPassword,
  verifyPassword,
  setStaffCookie,
  clearStaffCookie,
} from "../lib/staffAuth";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";

const router = Router();

// ── Auth ──────────────────────────────────────────────────────────────────────

router.post("/staff/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: "Email and password required" });
    return;
  }

  const [user] = await db
    .select()
    .from(staffUsersTable)
    .where(eq(staffUsersTable.email, email.toLowerCase().trim()));

  if (!user || !user.isActive) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const sid = await createStaffSession({
    staffUserId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  setStaffCookie(res, sid);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  });
});

router.post("/staff/logout", async (req, res) => {
  const sid = getStaffSessionId(req);
  if (sid) await deleteStaffSession(sid);
  clearStaffCookie(res);
  res.json({ ok: true });
});

router.get("/staff/me", requireStaffAuth, (req, res) => {
  res.json(req.staffUser);
});

router.post("/staff/change-password", requireStaffAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    res.status(400).json({ error: "New password must be at least 6 characters" });
    return;
  }

  const [user] = await db
    .select()
    .from(staffUsersTable)
    .where(eq(staffUsersTable.id, req.staffUser!.staffUserId));

  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }

  const hash = await hashPassword(newPassword);
  await db
    .update(staffUsersTable)
    .set({ passwordHash: hash, mustChangePassword: false })
    .where(eq(staffUsersTable.id, user.id));

  res.json({ ok: true });
});

// ── Staff User Management (super_admin only) ──────────────────────────────────

router.get("/staff/users", requireStaffAuth, requireSuperAdmin, async (_req, res) => {
  const users = await db
    .select({
      id: staffUsersTable.id,
      name: staffUsersTable.name,
      email: staffUsersTable.email,
      role: staffUsersTable.role,
      isActive: staffUsersTable.isActive,
      mustChangePassword: staffUsersTable.mustChangePassword,
      createdAt: staffUsersTable.createdAt,
    })
    .from(staffUsersTable)
    .orderBy(desc(staffUsersTable.createdAt));
  res.json(users);
});

router.post("/staff/users", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    res.status(400).json({ error: "name, email, password required" });
    return;
  }
  if (!["super_admin", "admin", "staff", "sales_agent"].includes(role ?? "staff")) {
    res.status(400).json({ error: "role must be super_admin, admin, staff, or sales_agent" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(staffUsersTable)
    .values({ name, email: email.toLowerCase().trim(), passwordHash, role: role ?? "staff", mustChangePassword: true })
    .returning();

  res.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.patch("/staff/users/:id", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  const id = parseInt(req.params.id);
  const { isActive, password, name, role } = req.body;
  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (isActive !== undefined) updates.isActive = isActive;
  if (role !== undefined) updates.role = role;
  if (password) { updates.passwordHash = await hashPassword(password); updates.mustChangePassword = true; }
  await db.update(staffUsersTable).set(updates).where(eq(staffUsersTable.id, id));
  res.json({ ok: true });
});

router.delete("/staff/users/:id", requireStaffAuth, requireSuperAdmin, async (req, res) => {
  await db.update(staffUsersTable).set({ isActive: false }).where(eq(staffUsersTable.id, parseInt(req.params.id)));
  res.json({ ok: true });
});

/**
 * GET /api/admin/api-keys
 * Super-admin only. Returns the API keys used by external apps so they can
 * be viewed and shared from within the HukuPlusCentral UI without needing
 * access to the Replit secrets panel.
 */
router.get("/admin/api-keys", requireStaffAuth, requireSuperAdmin, (req, res) => {
  res.json({
    keys: [
      {
        name: "HukuPlus External API Key",
        description: "Used by external apps (e.g. Reconciliator) to call /api/external/retailers, /api/external/stores, and /api/external/customers.",
        header: "Authorization: Bearer <key>",
        envVar: "HUKUPLUS_API_KEY",
        value: process.env.HUKUPLUS_API_KEY ?? null,
      },
      {
        name: "Takundwa API Key",
        description: "Used by the Takundwa app to access protected Central endpoints via the x-api-key header.",
        header: "x-api-key: <key>",
        envVar: "TAKUNDWA_API_KEY",
        value: process.env.TAKUNDWA_API_KEY ?? null,
      },
    ],
  });
});

export default router;
