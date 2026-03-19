import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, retailersTable, branchesTable } from "@workspace/db";
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
  res.status(201).json({ ...retailer, branchCount: 0 });
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
  const [retailer] = await db
    .update(retailersTable)
    .set(parsed.data)
    .where(eq(retailersTable.id, params.data.retailerId))
    .returning();
  if (!retailer) {
    res.status(404).json({ error: "Retailer not found" });
    return;
  }
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
  const [branch] = await db
    .update(branchesTable)
    .set(parsed.data)
    .where(eq(branchesTable.id, params.data.branchId))
    .returning();
  if (!branch) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }
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
  await db.delete(branchesTable).where(eq(branchesTable.id, params.data.branchId));
  res.sendStatus(204);
});

export default router;
