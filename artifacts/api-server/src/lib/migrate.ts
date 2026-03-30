import { pool } from "@workspace/db";
import bcrypt from "bcryptjs";

export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log("[migrate] Running startup migrations...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS retailers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        contact_email TEXT,
        contact_phone TEXT,
        address TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        retailer_id INTEGER NOT NULL REFERENCES retailers(id),
        name TEXT NOT NULL,
        location TEXT,
        contact_phone TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agreements (
        id SERIAL PRIMARY KEY,
        retailer_id INTEGER NOT NULL REFERENCES retailers(id),
        branch_id INTEGER REFERENCES branches(id),
        customer_name TEXT NOT NULL,
        customer_phone TEXT,
        customer_id_number TEXT,
        loan_product TEXT NOT NULL,
        loan_amount NUMERIC(12, 2),
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        signing_token TEXT UNIQUE,
        signed_at TIMESTAMPTZ,
        signed_ip TEXT,
        signature_data TEXT,
        formitize_job_id TEXT,
        form_url TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS portal_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        retailer_id INTEGER NOT NULL REFERENCES retailers(id),
        branch_id INTEGER REFERENCES branches(id),
        role VARCHAR(50) NOT NULL DEFAULT 'store_staff',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'staff',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity (
        id SERIAL PRIMARY KEY,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        meta JSON,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Unified customers table ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        full_name TEXT NOT NULL,
        national_id TEXT,
        phone TEXT,
        email TEXT,
        formitize_crm_id TEXT,
        xero_contact_id TEXT,
        address TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Unique indexes for deduplication (idempotent)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS customers_formitize_crm_id_idx
        ON customers(formitize_crm_id) WHERE formitize_crm_id IS NOT NULL;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS customers_national_id_idx
        ON customers(national_id) WHERE national_id IS NOT NULL;
    `);

    // Add multi-signature + customer_id columns to agreements (idempotent)
    await client.query(`
      ALTER TABLE agreements
        ADD COLUMN IF NOT EXISTS customer_signature_2 TEXT,
        ADD COLUMN IF NOT EXISTS customer_signature_3 TEXT,
        ADD COLUMN IF NOT EXISTS manager_signature TEXT,
        ADD COLUMN IF NOT EXISTS formitize_form_url TEXT,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS created_by TEXT,
        ADD COLUMN IF NOT EXISTS form_data JSONB,
        ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);
    `);

    // ── Backfill: create customer records for existing agreements ─────────────
    // Normalise phone: strip spaces/dashes, convert 263xxx → 0xxx
    const normalisePhone = (p: string) => {
      if (!p) return null;
      let s = p.replace(/[\s\-\(\)\.]/g, "");
      if (s.startsWith("+263")) s = "0" + s.slice(4);
      else if (s.startsWith("263") && s.length >= 12) s = "0" + s.slice(3);
      return s || null;
    };

    const orphans = await client.query(
      `SELECT id, customer_name, customer_phone FROM agreements WHERE customer_id IS NULL ORDER BY id`
    );

    let backfilled = 0;
    for (const row of orphans.rows) {
      const phone = normalisePhone(row.customer_phone || "");
      let customerId: number | null = null;

      // Try match by phone
      if (phone) {
        const hit = await client.query(
          "SELECT id FROM customers WHERE phone = $1 LIMIT 1", [phone]
        );
        if (hit.rows.length) customerId = hit.rows[0].id;
      }

      // Try match by name (exact, case-insensitive) as last resort
      if (!customerId) {
        const hit = await client.query(
          "SELECT id FROM customers WHERE lower(full_name) = lower($1) LIMIT 1",
          [row.customer_name]
        );
        if (hit.rows.length) customerId = hit.rows[0].id;
      }

      // Create new customer record if no match
      if (!customerId) {
        const ins = await client.query(
          `INSERT INTO customers (full_name, phone) VALUES ($1, $2) RETURNING id`,
          [row.customer_name, phone]
        );
        customerId = ins.rows[0].id;
      }

      await client.query(
        "UPDATE agreements SET customer_id = $1 WHERE id = $2",
        [customerId, row.id]
      );
      backfilled++;
    }
    if (backfilled > 0) console.log(`[migrate] Backfilled ${backfilled} agreements → customer records.`);

    // Add missing columns to activity table (idempotent)
    await client.query(`
      ALTER TABLE activity
        ADD COLUMN IF NOT EXISTS retailer_name TEXT,
        ADD COLUMN IF NOT EXISTS branch_name TEXT,
        ADD COLUMN IF NOT EXISTS loan_product TEXT,
        ADD COLUMN IF NOT EXISTS reference_id INTEGER;
    `);

    // Seed principal admin if not exists
    const adminEmail = "simon.reid@marishoma.com";
    const existing = await client.query(
      "SELECT id FROM staff_users WHERE email = $1",
      [adminEmail]
    );

    if (existing.rows.length === 0) {
      console.log("[migrate] Seeding principal admin account...");
      const hash = await bcrypt.hash("206362", 12);
      await client.query(
        `INSERT INTO staff_users (name, email, password_hash, role, is_active, must_change_password)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ["Simon Reid", adminEmail, hash, "super_admin", true, false]
      );
      console.log("[migrate] Principal admin created.");
    }

    // Seed retailers (from HukuPlus) if none exist
    const retailerCount = await client.query("SELECT COUNT(*) FROM retailers");
    if (parseInt(retailerCount.rows[0].count) === 0) {
      console.log("[migrate] Seeding retailers from HukuPlus...");
      const retailerNames = ["Profeeds", "Gain", "Novafeeds", "Feedmix"];
      for (const name of retailerNames) {
        const result = await client.query(
          `INSERT INTO retailers (name, is_active) VALUES ($1, true) RETURNING id`,
          [name]
        );
        const retailerId = result.rows[0].id;
        await client.query(
          `INSERT INTO branches (retailer_id, name, is_active) VALUES ($1, 'Main Branch', true)`,
          [retailerId]
        );
      }
      console.log("[migrate] Retailers seeded.");
    }

    console.log("[migrate] All migrations complete.");
  } finally {
    client.release();
  }
}
