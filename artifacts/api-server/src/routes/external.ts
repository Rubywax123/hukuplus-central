import { Router } from "express";
import { db, retailersTable, branchesTable, customersTable } from "@workspace/db";
import { eq, ilike, or, desc } from "drizzle-orm";

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

/**
 * GET /api/external/customers
 *
 * Look up customers from Central's database — the single source of truth.
 * Supports lookup by phone, nationalId, or a general name/phone/ID search.
 *
 * Query params (at least one required):
 *   ?phone=+263777123456       — exact/partial phone match (normalised)
 *   ?nationalId=63-123456P-78  — exact national ID match
 *   ?search=John Doe           — fuzzy name, phone or national ID search
 *   ?limit=20                  — max results (default 20, max 100)
 *
 * Returns: array of customer objects (may be empty).
 */
router.get("/external/customers", requireAppKey, async (req, res): Promise<void> => {
  const phone      = (req.query.phone      as string || "").trim();
  const nationalId = (req.query.nationalId as string || "").trim();
  const search     = (req.query.search     as string || "").trim();
  const limit      = Math.min(parseInt(req.query.limit as string || "20", 10), 100);

  if (!phone && !nationalId && !search) {
    res.status(400).json({ error: "Provide at least one of: phone, nationalId, search" });
    return;
  }

  let where: any;
  if (nationalId) {
    // Exact national ID — highest confidence match
    where = eq(customersTable.nationalId, nationalId);
  } else if (phone) {
    // Phone — try both original and normalised +263 form
    const norm = normaliseExternalPhone(phone);
    where = norm && norm !== phone
      ? or(ilike(customersTable.phone, `%${phone}%`), ilike(customersTable.phone, `%${norm}%`))
      : ilike(customersTable.phone, `%${phone}%`);
  } else {
    // General search across name, phone, national ID
    where = or(
      ilike(customersTable.fullName,  `%${search}%`),
      ilike(customersTable.phone,     `%${search}%`),
      ilike(customersTable.nationalId,`%${search}%`),
    );
  }

  const rows = await db
    .select()
    .from(customersTable)
    .where(where)
    .orderBy(desc(customersTable.updatedAt))
    .limit(limit);

  res.json(rows.map(formatCustomer));
});

/**
 * GET /api/external/customers/:id
 *
 * Fetch a single customer by their Central customer ID.
 * Returns 404 if not found.
 */
router.get("/external/customers/:id", requireAppKey, async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const [customer] = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, id));

  if (!customer) { res.status(404).json({ error: "Customer not found" }); return; }
  res.json(formatCustomer(customer));
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function normaliseExternalPhone(p: string): string | null {
  if (!p) return null;
  let s = p.replace(/[\s\-\(\)\.]/g, "");
  if (s.startsWith("+")) return s;
  if (s.startsWith("263") && s.length >= 12) return "+" + s;
  if (s.startsWith("0")) return "+263" + s.slice(1);
  if (/^7[0-9]{8}$/.test(s)) return "+263" + s;
  return s || null;
}

function formatCustomer(c: typeof customersTable.$inferSelect) {
  return {
    id:               c.id,
    fullName:         c.fullName,
    nationalId:       c.nationalId   ?? null,
    phone:            c.phone        ?? null,
    email:            c.email        ?? null,
    address:          c.address      ?? null,
    dateOfBirth:      c.dateOfBirth  ?? null,
    gender:           c.gender       ?? null,
    maritalStatus:    c.maritalStatus ?? null,
    isEmployed:       c.isEmployed   ?? null,
    employerName:     c.employerName ?? null,
    nok: {
      name:         c.nokName         ?? null,
      relationship: c.nokRelationship ?? null,
      nationalId:   c.nokNationalId   ?? null,
      phone:        c.nokPhone        ?? null,
      email:        c.nokEmail        ?? null,
      address:      c.nokAddress      ?? null,
    },
    xeroContactId:    c.xeroContactId    ?? null,
    formitizeCrmId:   c.formitizeCrmId   ?? null,
    retailerReference:c.retailerReference ?? null,
    loanProduct:      c.loanProduct      ?? null,
    updatedAt:        c.updatedAt,
    createdAt:        c.createdAt,
  };
}

export default router;
