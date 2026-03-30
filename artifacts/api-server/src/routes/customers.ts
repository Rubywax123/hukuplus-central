import { Router, type IRouter } from "express";
import { eq, ilike, or, desc, sql } from "drizzle-orm";
import { db, customersTable, agreementsTable, branchesTable, retailersTable } from "@workspace/db";
import multer from "multer";
import { parse } from "csv-parse/sync";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function normalisePhone(p: string): string | null {
  if (!p) return null;
  let s = p.replace(/[\s\-\(\)\.]/g, "");
  if (s.startsWith("+263")) s = "0" + s.slice(4);
  else if (s.startsWith("263") && s.length >= 12) s = "0" + s.slice(3);
  // Handle 9-digit Zim numbers missing the leading 0 (e.g. "777482993" → "0777482993")
  else if (/^7[0-9]{8}$/.test(s)) s = "0" + s;
  return s || null;
}

// ── List customers (admin only) ───────────────────────────────────────────────
router.get("/customers", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const search         = (req.query.search as string || "").trim();
  const incompleteOnly = req.query.incompleteOnly === "true";
  const limit          = Math.min(parseInt(req.query.limit as string || "50"), 200);
  const offset         = parseInt(req.query.offset as string || "0");

  // Build WHERE conditions
  const conditions: ReturnType<typeof ilike>[] = [];
  if (search) {
    conditions.push(
      or(
        ilike(customersTable.fullName, `%${search}%`),
        ilike(customersTable.phone, `%${search}%`),
        ilike(customersTable.nationalId, `%${search}%`),
        ilike(customersTable.email, `%${search}%`),
      ) as any
    );
  }
  if (incompleteOnly) {
    conditions.push(
      or(
        sql`${customersTable.phone} IS NULL`,
        sql`${customersTable.nationalId} IS NULL`,
        sql`${customersTable.email} IS NULL`,
      ) as any
    );
  }

  const where = conditions.length === 0 ? undefined
    : conditions.length === 1 ? conditions[0]
    : sql`${conditions[0]} AND ${conditions[1]}`;

  const rows = await db
    .select()
    .from(customersTable)
    .where(where)
    .orderBy(desc(customersTable.createdAt))
    .limit(limit)
    .offset(offset);

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

// ── CSV Enrichment — POST /api/customers/enrich-csv ──────────────────────────
// Accepts a CSV from Formitize (New Customer Application export) or any simple
// CSV with Name/Phone/National ID/Email/Address columns.
// Matches existing customers by phone (priority) or name, then fills in any
// blank fields using COALESCE logic (never overwrites existing values).
router.post("/customers/enrich-csv", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  // Log raw first line for debugging encoding/delimiter issues
  const rawText = req.file.buffer.toString("utf8").replace(/^\uFEFF/, ""); // strip BOM
  const firstLine = rawText.split(/\r?\n/)[0] ?? "";
  console.log(`[enrich-csv] raw first line (${firstLine.length} chars): ${firstLine.substring(0, 300)}`);

  let records: Record<string, string>[];
  try {
    records = parse(rawText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    }) as Record<string, string>[];
  } catch {
    res.status(400).json({ error: "Could not parse CSV — check the file format" });
    return;
  }

  // Log first record keys so we can see exactly what headers were parsed
  if (records.length > 0) {
    console.log(`[enrich-csv] parsed keys: ${Object.keys(records[0]).map(k => JSON.stringify(k)).join(", ")}`);
  }

  const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-\(\)\/\.]/g, "");

  // Two-pass matching: exact normalised match first, then "column contains needle" fallback.
  // This handles both Formitize field-ID headers (formtext_2) and human-readable labels
  // (e.g. "Customer Full Name", "National ID Number", "Phone Number").
  const getField = (row: Record<string, string>, ...needles: string[]): string | null => {
    // Pass 1 — exact
    for (const needle of needles) {
      const normNeedle = normalize(needle);
      for (const [k, v] of Object.entries(row)) {
        if (normalize(k) === normNeedle && v?.trim()) return v.trim();
      }
    }
    // Pass 2 — column header contains needle
    for (const needle of needles) {
      const normNeedle = normalize(needle);
      if (normNeedle.length < 3) continue; // skip too-short needles to avoid false positives
      for (const [k, v] of Object.entries(row)) {
        if (normalize(k).includes(normNeedle) && v?.trim()) return v.trim();
      }
    }
    return null;
  };

  const isPlaceholder = (v: string | null) =>
    !v || ["na", "n/a", "none", "nil", "-", "n.a", "null"].includes(v.toLowerCase().trim());

  // Log column headers from first row to help diagnose mismatches
  const columnHeaders = records.length > 0 ? Object.keys(records[0]) : [];
  console.log(`[enrich-csv] ${records.length} rows, columns: ${columnHeaders.join(" | ")}`);

  const results = {
    total: records.length,
    matched: 0,
    enriched: 0,
    notFound: 0,
    skipped: 0,
    columnHeaders,
    firstLine: firstLine.substring(0, 500),
    details: [] as { name: string; status: string; fields: string[] }[],
  };

  for (const row of records) {
    // Formitize field-ID headers AND human-readable label variants
    // "Billing Name" and "Primary Contact" are the CRM export column names for customer name
    const name      = getField(row,
      "formtext2", "formtext_2",
      "billingname", "billing name",
      "primarycontact", "primary contact",
      "customername", "customer name", "fullname", "full name", "name",
      "borrowername", "borrower name", "applicantname", "applicant name", "clientname", "client name"
    );
    const phoneRaw  = getField(row,
      "formtel1", "formtel_1", "formtel2", "formtel_2",
      "phone", "mobile", "contactnumber", "contact number",
      "phonenumber", "phone number", "cellphone", "cell phone",
      "borrowermobile", "borrower mobile"
    );
    const natId     = getField(row,
      "formtext7", "formtext_7",
      "nationalid", "national id", "nationalidnumber", "national id number",
      "idnumber", "id number", "nid", "id"
    );
    const emailRaw  = getField(row,
      "formemail1", "formemail_1", "formemail2", "formemail_2",
      "email", "emailaddress", "email address", "borroweremail", "borrower email"
    );
    const addrRaw   = getField(row,
      "formlocation1", "formlocation_1",
      "address", "homeaddress", "home address",
      "residentialaddress", "residential address", "physicaladdress", "physical address"
    );

    const email   = isPlaceholder(emailRaw) ? null : emailRaw;
    const address = isPlaceholder(addrRaw)  ? null : addrRaw;
    const normPhone = phoneRaw ? normalisePhone(phoneRaw) : null;

    if (!name && !normPhone) { results.skipped++; continue; }

    // Match customer — phone first (exact), then name (case-insensitive, unique)
    let customer: typeof customersTable.$inferSelect | null = null;
    if (normPhone) {
      const hits = await db.select().from(customersTable).where(eq(customersTable.phone, normPhone));
      if (hits.length === 1) customer = hits[0];
    }
    if (!customer && name) {
      const hits = await db.select().from(customersTable).where(ilike(customersTable.fullName, name));
      if (hits.length === 1) customer = hits[0];
    }

    if (!customer) {
      results.notFound++;
      results.details.push({ name: name || phoneRaw || "?", status: "not_found", fields: [] });
      continue;
    }

    results.matched++;

    // Only fill fields that are currently blank
    const updates: Partial<typeof customersTable.$inferInsert> = {};
    const filled: string[] = [];
    if (normPhone && !customer.phone)      { updates.phone      = normPhone; filled.push("phone"); }
    if (natId    && !customer.nationalId)  { updates.nationalId = natId;     filled.push("national_id"); }
    if (email    && !customer.email)       { updates.email      = email;     filled.push("email"); }
    if (address  && !customer.address)     { updates.address    = address;   filled.push("address"); }

    if (Object.keys(updates).length > 0) {
      await db.update(customersTable)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(customersTable.id, customer.id));
      results.enriched++;
      results.details.push({ name: customer.fullName, status: "enriched", fields: filled });
    } else {
      results.details.push({ name: customer.fullName, status: "already_complete", fields: [] });
    }
  }

  res.json(results);
});

export default router;
