import { Router } from "express";
import { db, retailersTable, branchesTable, customersTable } from "@workspace/db";
import { eq, ilike, or, desc } from "drizzle-orm";

const router = Router();

/**
 * Middleware: authenticate external apps via Bearer token.
 * Accepts the HUKUPLUS_API_KEY secret (set in environment variables).
 */
function requireAppKey(req: any, res: any, next: any) {
  const apiKey = process.env.HUKUPLUS_API_KEY;
  const header = req.headers["authorization"] ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!apiKey || token !== apiKey) {
    res.status(401).json({ error: "Unauthorized — invalid or missing API key" });
    return;
  }
  next();
}

/**
 * GET /api/external/retailers
 *
 * Returns all active retailers.
 * Response: [{ id, name, email }]
 */
router.get("/external/retailers", requireAppKey, async (req, res): Promise<void> => {
  const retailers = await db
    .select()
    .from(retailersTable)
    .where(eq(retailersTable.isActive, true))
    .orderBy(retailersTable.name);

  res.json(retailers.map(r => ({
    id: r.id,
    name: r.name,
    email: r.contactEmail ?? null,
  })));
});

/**
 * GET /api/external/stores
 *
 * Returns all active stores (branches) with their parent retailer.
 * Response: [{ id, name, email, retailer_id }]
 *
 * Also supports grouped format with ?format=grouped:
 * [{ retailerId, retailerName, branches: [{ id, name }] }]
 */
router.get("/external/stores", requireAppKey, async (req, res): Promise<void> => {
  const branches = await db
    .select()
    .from(branchesTable)
    .where(eq(branchesTable.isActive, true))
    .orderBy(branchesTable.name);

  if (req.query.format === "grouped") {
    const retailers = await db
      .select()
      .from(retailersTable)
      .where(eq(retailersTable.isActive, true))
      .orderBy(retailersTable.name);

    const grouped = retailers.map(r => ({
      retailerId: r.id,
      retailerName: r.name,
      branches: branches
        .filter(b => b.retailerId === r.id)
        .map(b => ({ id: b.id, name: b.name })),
    }));
    res.json(grouped);
    return;
  }

  res.json(branches.map(b => ({
    id: b.id,
    name: b.name,
    email: null,
    retailer_id: b.retailerId,
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
