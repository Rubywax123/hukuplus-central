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
        ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id),
        ADD COLUMN IF NOT EXISTS form_type TEXT DEFAULT 'agreement';
    `);

    // ── Phase 2: make retailer_id / branch_id nullable (for non-HukuPlus products) ──
    await client.query(`ALTER TABLE agreements ALTER COLUMN retailer_id DROP NOT NULL`).catch(() => {});
    await client.query(`ALTER TABLE agreements ALTER COLUMN branch_id DROP NOT NULL`).catch(() => {});

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

    // Xero OAuth token storage (single row, id=1)
    await client.query(`
      CREATE TABLE IF NOT EXISTS xero_tokens (
        id INTEGER PRIMARY KEY DEFAULT 1,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        tenant_name TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
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

    // ── HukuPlus Repeat Loan Applications ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS loan_applications (
        id                    SERIAL PRIMARY KEY,
        customer_id           INTEGER REFERENCES customers(id),
        customer_name         TEXT NOT NULL,
        customer_phone        TEXT,
        retailer_id           INTEGER REFERENCES retailers(id),
        branch_id             INTEGER REFERENCES branches(id),
        collection_retailer_id INTEGER REFERENCES retailers(id),
        collection_branch_id   INTEGER REFERENCES branches(id),
        chick_count           INTEGER NOT NULL,
        chick_purchase_date   DATE NOT NULL,
        expected_collection_date DATE NOT NULL,
        amount_requested      NUMERIC(12,2) NOT NULL,
        amount_limit          NUMERIC(12,2) NOT NULL,
        status                VARCHAR(50) NOT NULL DEFAULT 'submitted',
        notes                 TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Revolver Drawdown Requests ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS drawdown_requests (
        id                      SERIAL PRIMARY KEY,
        customer_id             INTEGER REFERENCES customers(id),
        customer_name           TEXT NOT NULL,
        customer_phone          TEXT,
        agreement_id            INTEGER REFERENCES agreements(id),
        retailer_id             INTEGER REFERENCES retailers(id),
        branch_id               INTEGER REFERENCES branches(id),
        collection_retailer_id  INTEGER REFERENCES retailers(id),
        collection_branch_id    INTEGER REFERENCES branches(id),
        amount_requested        NUMERIC(12,2) NOT NULL,
        facility_limit          NUMERIC(12,2),
        facility_balance        NUMERIC(12,2),
        status                  VARCHAR(50) NOT NULL DEFAULT 'pending',
        store_notified_at       TIMESTAMPTZ,
        store_actioned_at       TIMESTAMPTZ,
        store_actioned_by       TEXT,
        notes                   TEXT,
        created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Formitize Task Notifications ────────────────────────────────────────────
    // One row per inbound Formitize form submission, deduplicated by job ID.
    // Covers all 3 products × 5 form types.
    await client.query(`
      CREATE TABLE IF NOT EXISTS formitize_notifications (
        id                  SERIAL PRIMARY KEY,
        formitize_job_id    TEXT,
        form_name           TEXT NOT NULL,
        task_type           TEXT NOT NULL,
        product             TEXT NOT NULL,
        customer_name       TEXT,
        customer_phone      TEXT,
        branch_name         TEXT,
        retailer_name       TEXT,
        status              TEXT NOT NULL DEFAULT 'new',
        notes               TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Unique index on formitize_job_id (excluding NULLs so nulls don't conflict)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS formitize_notifications_job_id_idx
        ON formitize_notifications (formitize_job_id)
        WHERE formitize_job_id IS NOT NULL;
    `);

    // ── In-App Messages (store portal notifications) ────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS in_app_messages (
        id              SERIAL PRIMARY KEY,
        retailer_id     INTEGER REFERENCES retailers(id),
        branch_id       INTEGER REFERENCES branches(id),
        reference_type  VARCHAR(50),
        reference_id    INTEGER,
        subject         TEXT NOT NULL,
        body            TEXT NOT NULL,
        is_read         BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── Data correction: NEW CUSTOMER APPLICATION webhook mis-mapped fields ─────
    // The first submission used formtext_1 (store name) as customer name.
    // Fix customer record and linked agreement to the correct values.
    await client.query(`
      UPDATE customers
      SET full_name   = 'Tamuka Tsigo',
          phone       = '0787087472',
          national_id = '15-114456 F 15',
          address     = 'Henderson Research Bag 2004, Mazowe'
      WHERE full_name = 'Mazowe Profarmer';
    `);
    await client.query(`
      UPDATE agreements
      SET
        customer_name = 'Tamuka Tsigo',
        retailer_id   = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1),
        branch_id     = (
          SELECT b.id FROM branches b
          JOIN retailers r ON r.id = b.retailer_id
          WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%mazow%'
          LIMIT 1
        )
      WHERE customer_name = 'Mazowe Profarmer';
    `);

    // ── Data correction: PHIRI YASSIN → FRANCIS CHIMISO ────────────────────────
    // New Customer Application form: formtext_2 = store manager, formtext_6 = actual customer.
    // The webhook incorrectly stored the store manager name as the customer name.
    await client.query(`
      UPDATE customers
      SET full_name = 'FRANCIS CHIMISO'
      WHERE full_name = 'PHIRI YASSIN';
    `);
    await client.query(`
      UPDATE agreements
      SET customer_name = 'FRANCIS CHIMISO'
      WHERE customer_name = 'PHIRI YASSIN';
    `);
    await client.query(`
      UPDATE activity
      SET description = REPLACE(description, 'PHIRI YASSIN', 'FRANCIS CHIMISO')
      WHERE description ILIKE '%phiri yassin%';
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET customer_name = 'FRANCIS CHIMISO'
      WHERE customer_name ILIKE '%phiri yassin%';
    `);

    // ── Data correction: Archiford Sibanda — wrong retailer/branch (Novafeeds → Profeeds Lupane) ──
    // formtext_5 = "Lupane" and storeemail_1 = "lupane@profeeds.co.zw" confirm Profeeds Lupane.
    // Fix agreement, activity, and notification records.
    await client.query(`
      UPDATE agreements
      SET
        retailer_id = (SELECT r.id FROM retailers r WHERE r.name ILIKE '%profeed%' LIMIT 1),
        branch_id   = (
          SELECT b.id FROM branches b
          JOIN retailers r ON r.id = b.retailer_id
          WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%lupane%'
          LIMIT 1
        )
      WHERE (customer_name ILIKE '%archiford sibanda%' OR customer_name ILIKE '%archford sibanda%')
        AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%novafeed%' LIMIT 1);
    `);
    await client.query(`
      UPDATE activity
      SET retailer_name = 'Profeeds', branch_name = 'Lupane'
      WHERE (description ILIKE '%archiford sibanda%' OR description ILIKE '%archford sibanda%')
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET retailer_name = 'Profeeds', branch_name = 'Lupane'
      WHERE (customer_name ILIKE '%archiford sibanda%' OR customer_name ILIKE '%archford sibanda%')
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);

    console.log("[migrate] All migrations complete.");
  } finally {
    client.release();
  }
}
