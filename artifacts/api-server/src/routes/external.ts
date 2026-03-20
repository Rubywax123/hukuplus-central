import { Router } from "express";
import { db, retailersTable, branchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const CENTRAL_API_KEY = process.env.CENTRAL_API_KEY;

/**
 * Middleware: authenticate external loan apps via Bearer token.
 * Uses the same CENTRAL_API_KEY that HukuPlus already knows.
 */
function requireAppKey(req: any, res: any, next: any) {
  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!CENTRAL_API_KEY || token !== CENTRAL_API_KEY) {
    res.status(401).json({ error: "Unauthorized — invalid or missing API key" });
    return;
  }
  next();
}

/**
 * GET /api/external/stores
 *
 * Returns all active retailers and their branches from Central's database.
 * This is the single source of truth for store data across all loan apps.
 *
 * Response format:
 * [
 *   {
 *     retailerId: 1,
 *     retailerName: "Profeeds",
 *     branches: [
 *       { branchId: 2, branchName: "Beitbridge" },
 *       ...
 *     ]
 *   },
 *   ...
 * ]
 *
 * Also supports flat format with ?format=flat:
 * [
 *   { retailerId: 1, retailerName: "Profeeds", branchId: 2, branchName: "Beitbridge" },
 *   ...
 * ]
 */
router.get("/external/stores", requireAppKey, async (req, res): Promise<void> => {
  const retailers = await db
    .select()
    .from(retailersTable)
    .where(eq(retailersTable.isActive, true))
    .orderBy(retailersTable.name);

  const branches = await db
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.isActive, true))
    .orderBy(branchesTable.name);

  if (req.query.format === "flat") {
    const flat = branches.map(b => {
      const retailer = retailers.find(r => r.id === b.retailerId);
      return {
        retailerId: b.retailerId,
        retailerName: retailer?.name ?? "",
        branchId: b.id,
        branchName: b.name,
      };
    });
    res.json(flat);
    return;
  }

  const grouped = retailers.map(r => ({
    retailerId: r.id,
    retailerName: r.name,
    branches: branches
      .filter(b => b.retailerId === r.id)
      .map(b => ({ branchId: b.id, branchName: b.name })),
  }));

  res.json(grouped);
});

/**
 * GET /api/external/retailers
 * Returns just the retailer list (no branches).
 */
router.get("/external/retailers", requireAppKey, async (req, res): Promise<void> => {
  const retailers = await db
    .select()
    .from(retailersTable)
    .where(eq(retailersTable.isActive, true))
    .orderBy(retailersTable.name);

  res.json(retailers.map(r => ({
    retailerId: r.id,
    retailerName: r.name,
  })));
});

export default router;
