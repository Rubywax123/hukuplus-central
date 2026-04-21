import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, retailersTable, branchesTable } from "@workspace/db";
import { syncRevolverStores, pushRetailerRenameToRevolver, pushBranchRenameToRevolver } from "./sync";
import {
  CreateRetailerBody,
  UpdateRetailerBody,
  GetRetailerParams,
  UpdateRetailerParams,
  ListBranchesParams,
  CreateBranchParams,
  CreateBranchBody,
  UpdateBranchParams,
  UpdateBranchBody,
  DeleteBranchParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function pushToRevolver() {
  syncRevolverStores().catch(err =>
    console.warn("[sync:revolver] background push failed:", err.message)
  );
}

router.get("/retailers", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const retailers = await db.select().from(retailersTable).orderBy(retailersTable.name);
  const branchCounts = await db
    .select({ retailerId: branchesTable.retailerId, count: sql<number>`count(*)::int` })
    .from(branchesTable)
    .groupBy(branchesTable.retailerId);
  const countMap = Object.fromEntries(branchCounts.map((r) => [r.retailerId, r.count]));
  res.json(retailers.map((r) => ({ ...r, branchCount: countMap[r.id] ?? 0 })));
});

router.post("/retailers", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = CreateRetailerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [retailer] = await db.insert(retailersTable).values(parsed.data).returning();
  pushToRevolver();
  res.status(201).json({ ...retailer, branchCount: 0 });
});

router.post("/retailers/bulk-import", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { rows } = req.body as {
    rows: Array<{ retailerName: string; branchName: string; contactEmail?: string; contactPhone?: string; address?: string }>;
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ error: "rows array is required" });
    return;
  }

  const results = { created: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    const rName = (row.retailerName ?? "").trim();
    const bName = (row.branchName ?? "").trim();
    if (!rName || !bName) {
      results.errors.push(`Skipped blank row: "${rName}" / "${bName}"`);
      continue;
    }

    try {
      let [existing] = await db
        .select()
        .from(retailersTable)
        .where(eq(retailersTable.name, rName));

      if (!existing) {
        [existing] = await db
          .insert(retailersTable)
          .values({
            name: rName,
            contactEmail: row.contactEmail || null,
            contactPhone: row.contactPhone || null,
            address: row.address || null,
            isActive: true,
          })
          .returning();
        results.created++;
      }

      const existingBranches = await db
        .select()
        .from(branchesTable)
        .where(eq(branchesTable.retailerId, existing.id));

      const branchExists = existingBranches.some(
        b => b.name.toLowerCase() === bName.toLowerCase()
      );

      if (!branchExists) {
        await db.insert(branchesTable).values({
          retailerId: existing.id,
          name: bName,
          isActive: true,
        });
      } else {
        results.skipped++;
      }
    } catch (err: any) {
      results.errors.push(`"${rName}" / "${bName}": ${err.message}`);
    }
  }

  pushToRevolver();
  res.status(200).json(results);
});

router.get("/retailers/:retailerId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = GetRetailerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [retailer] = await db.select().from(retailersTable).where(eq(retailersTable.id, params.data.retailerId));
  if (!retailer) {
    res.status(404).json({ error: "Retailer not found" });
    return;
  }
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(branchesTable)
    .where(eq(branchesTable.retailerId, retailer.id));
  res.json({ ...retailer, branchCount: countResult?.count ?? 0 });
});

router.patch("/retailers/:retailerId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = UpdateRetailerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateRetailerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [before] = await db.select().from(retailersTable).where(eq(retailersTable.id, params.data.retailerId));
  const [retailer] = await db
    .update(retailersTable)
    .set(parsed.data)
    .where(eq(retailersTable.id, params.data.retailerId))
    .returning();
  if (!retailer) {
    res.status(404).json({ error: "Retailer not found" });
    return;
  }
  // If name changed, immediately patch Revolver via the mapping; otherwise full push handles the rest
  if (before && parsed.data.name && before.name !== parsed.data.name) {
    pushRetailerRenameToRevolver(retailer.id, retailer.name).catch(() => {});
  }
  pushToRevolver();
  res.json({ ...retailer, branchCount: null });
});

router.get("/retailers/:retailerId/branches", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = ListBranchesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const branches = await db
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.retailerId, params.data.retailerId))
    .orderBy(branchesTable.name);
  res.json(branches);
});

router.post("/retailers/:retailerId/branches", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = CreateBranchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [branch] = await db
    .insert(branchesTable)
    .values({ ...parsed.data, retailerId: params.data.retailerId })
    .returning();
  pushToRevolver();
  res.status(201).json(branch);
});

router.patch("/retailers/:retailerId/branches/:branchId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = UpdateBranchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBranchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [before] = await db.select().from(branchesTable).where(eq(branchesTable.id, params.data.branchId));
  const [branch] = await db
    .update(branchesTable)
    .set(parsed.data)
    .where(eq(branchesTable.id, params.data.branchId))
    .returning();
  if (!branch) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
  // If name changed, immediately patch Revolver via the mapping
  if (before && parsed.data.name && before.name !== parsed.data.name) {
    pushBranchRenameToRevolver(branch.id, branch.name).catch(() => {});
  }
  pushToRevolver();
  res.json(branch);
});

router.delete("/retailers/:retailerId/branches/:branchId", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = DeleteBranchParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    await db.delete(branchesTable).where(eq(branchesTable.id, params.data.branchId));
  } catch (err: any) {
    // PostgreSQL FK violation code 23503
    if (err?.code === "23503") {
      res.status(422).json({
        error: "Cannot delete — this branch has customers, agreements, or users linked to it. Reassign them first, or rename the branch instead.",
      });
      return;
    }
    throw err;
  }
  pushToRevolver();
  res.sendStatus(204);
});

export default router;
