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

    // Add multi-signature columns to agreements (idempotent)
    await client.query(`
      ALTER TABLE agreements
        ADD COLUMN IF NOT EXISTS customer_signature_2 TEXT,
        ADD COLUMN IF NOT EXISTS customer_signature_3 TEXT,
        ADD COLUMN IF NOT EXISTS manager_signature TEXT,
        ADD COLUMN IF NOT EXISTS formitize_form_url TEXT,
        ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS created_by TEXT;
    `);

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
