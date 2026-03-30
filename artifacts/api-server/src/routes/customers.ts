import { Router, type IRouter } from "express";
import { eq, ilike, or, desc, sql } from "drizzle-orm";
import { db, customersTable, agreementsTable, branchesTable, retailersTable } from "@workspace/db";

const router: IRouter = Router();

function normalisePhone(p: string): string | null {
  if (!p) return null;
  let s = p.replace(/[\s\-\(\)\.]/g, "");
  if (s.startsWith("+263")) s = "0" + s.slice(4);
  else if (s.startsWith("263") && s.length >= 12) s = "0" + s.slice(3);
  return s || null;
}

// ── List customers (admin only) ───────────────────────────────────────────────
router.get("/customers", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const search = (req.query.search as string || "").trim();
  const limit  = Math.min(parseInt(req.query.limit as string || "50"), 200);
  const offset = parseInt(req.query.offset as string || "0");

  let rows;
  if (search) {
    rows = await db
      .select()
      .from(customersTable)
      .where(or(
        ilike(customersTable.fullName, `%${search}%`),
        ilike(customersTable.phone, `%${search}%`),
        ilike(customersTable.nationalId, `%${search}%`),
        ilike(customersTable.email, `%${search}%`),
      ))
      .orderBy(desc(customersTable.createdAt))
      .limit(limit)
      .offset(offset);
  } else {
    rows = await db
      .select()
      .from(customersTable)
      .orderBy(desc(customersTable.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // Attach agreement counts per customer
  const ids = rows.map(r => r.id);
  let counts: Record<number, number> = {};
  if (ids.length) {
    const countRows = await db
      .select({ customerId: agreementsTable.customerId, count: sql<number>`count(*)::int` })
      .from(agreementsTable)
      .where(sql`customer_id = ANY(ARRAY[${sql.raw(ids.join(","))}]::int[])`)
      .groupBy(agreementsTable.customerId);
    for (const c of countRows) counts[c.customerId!] = c.count;
  }

  const total = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable)
    .then(r => r[0]?.count ?? 0);

  res.json({
    customers: rows.map(r => ({ ...r, agreementCount: counts[r.id] ?? 0 })),
    total,
    limit,
    offset,
  });
});

// ── Get single customer with agreement history ────────────────────────────────
router.get("/customers/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }

  const agreements = await db
    .select({
      id: agreementsTable.id,
      loanProduct: agreementsTable.loanProduct,
      loanAmount: agreementsTable.loanAmount,
      status: agreementsTable.status,
      createdAt: agreementsTable.createdAt,
      signedAt: agreementsTable.signedAt,
      branchName: branchesTable.name,
      retailerName: retailersTable.name,
    })
    .from(agreementsTable)
    .leftJoin(branchesTable, eq(agreementsTable.branchId, branchesTable.id))
    .leftJoin(retailersTable, eq(agreementsTable.retailerId, retailersTable.id))
    .where(eq(agreementsTable.customerId, id))
    .orderBy(desc(agreementsTable.createdAt));

  res.json({ customer, agreements });
});

// ── Update customer ───────────────────────────────────────────────────────────
router.put("/customers/:id", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const { fullName, phone, email, nationalId, address, notes, xeroContactId } = req.body;

  const normPhone = phone ? (normalisePhone(phone) ?? phone) : undefined;

  const [updated] = await db
    .update(customersTable)
    .set({
      ...(fullName    !== undefined && { fullName }),
      ...(normPhone   !== undefined && { phone: normPhone }),
      ...(email       !== undefined && { email }),
      ...(nationalId  !== undefined && { nationalId }),
      ...(address     !== undefined && { address }),
      ...(notes       !== undefined && { notes }),
      ...(xeroContactId !== undefined && { xeroContactId }),
      updatedAt: new Date(),
    })
    .where(eq(customersTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(updated);
});

export default router;
