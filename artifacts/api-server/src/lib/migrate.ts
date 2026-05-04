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
    // Normalise phone to +263 international format for consistent storage.
    const normalisePhone = (p: string) => {
      if (!p) return null;
      let s = p.replace(/[\s\-\(\)\.]/g, "");
      if (s.startsWith("+")) return s || null;
      if (s.startsWith("263") && s.length >= 12) return "+" + s;
      if (s.startsWith("0")) return "+263" + s.slice(1);
      if (/^7[0-9]{8}$/.test(s)) return "+263" + s;
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
          phone       = '+263787087472',
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
      SET retailer_name = 'Profeeds',
          branch_name   = 'Lupane',
          description   = REPLACE(description, '@ Novafeeds', '@ Profeeds')
      WHERE (description ILIKE '%archiford sibanda%' OR description ILIKE '%archford sibanda%')
        AND description ILIKE '%novafeeds%';
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET retailer_name = 'Profeeds', branch_name = 'Lupane'
      WHERE (customer_name ILIKE '%archiford sibanda%' OR customer_name ILIKE '%archford sibanda%')
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);

    // ── Data correction: Gift Tatenda Marufu — wrong retailer/branch (Novafeeds → Profeeds Rusape) ──
    // storeemail_1 = "rusape@profeeds.co.zw", formtext_5 = "Rusape"
    await client.query(`
      UPDATE agreements
      SET
        retailer_id = (SELECT r.id FROM retailers r WHERE r.name ILIKE '%profeed%' LIMIT 1),
        branch_id   = (
          SELECT b.id FROM branches b
          JOIN retailers r ON r.id = b.retailer_id
          WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%rusap%'
          LIMIT 1
        )
      WHERE customer_name ILIKE '%gift tatenda marufu%'
        AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%novafeed%' LIMIT 1);
    `);
    await client.query(`
      UPDATE activity
      SET retailer_name = 'Profeeds',
          branch_name   = 'Rusape',
          description   = REPLACE(description, '@ Novafeeds', '@ Profeeds')
      WHERE description ILIKE '%gift tatenda marufu%'
        AND description ILIKE '%novafeeds%';
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET retailer_name = 'Profeeds', branch_name = 'Rusape'
      WHERE customer_name ILIKE '%gift tatenda marufu%'
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);

    // ── Data correction: Desmond Hwete — wrong retailer/branch (Novafeeds → Profeeds Mazowe) ──
    // formtext_5 = "Mazowe Pro Farmer", storeemail_1 = "mazowe@profeeds.co.zw"
    await client.query(`
      UPDATE agreements
      SET
        retailer_id = (SELECT r.id FROM retailers r WHERE r.name ILIKE '%profeed%' LIMIT 1),
        branch_id   = (
          SELECT b.id FROM branches b
          JOIN retailers r ON r.id = b.retailer_id
          WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%mazow%'
          LIMIT 1
        )
      WHERE customer_name ILIKE '%desmond hwete%'
        AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%novafeed%' LIMIT 1);
    `);
    await client.query(`
      UPDATE activity
      SET retailer_name = 'Profeeds',
          branch_name   = 'Mazowe',
          description   = REPLACE(description, '@ Novafeeds', '@ Profeeds')
      WHERE description ILIKE '%desmond hwete%'
        AND description ILIKE '%novafeeds%';
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET retailer_name = 'Profeeds', branch_name = 'Mazowe'
      WHERE customer_name ILIKE '%desmond hwete%'
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);

    // ── Data correction: Ever Nyangadza — re-application received with no store email/branch
    // fields populated so retailer resolution fell back to Novafeeds; confirmed Profeeds Rusape ──
    await client.query(`
      UPDATE agreements
      SET
        retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1),
        branch_id   = (
          SELECT b.id FROM branches b
          JOIN retailers r ON r.id = b.retailer_id
          WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%rusape%'
          LIMIT 1
        )
      WHERE customer_name ILIKE '%ever nyangadza%'
        AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%novafeed%' LIMIT 1);
    `);
    await client.query(`
      UPDATE activity
      SET retailer_name = 'Profeeds',
          branch_name   = 'Rusape',
          description   = REPLACE(description, '@ Novafeeds', '@ Profeeds')
      WHERE description ILIKE '%ever nyangadza%'
        AND (retailer_name ILIKE '%novafeed%' OR description ILIKE '%novafeeds%');
    `);
    await client.query(`
      UPDATE activity
      SET retailer_name = 'Profeeds', branch_name = 'Rusape'
      WHERE description ILIKE '%ever nyangadza%'
        AND (retailer_name IS NULL OR retailer_name = '');
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET retailer_name = 'Profeeds', branch_name = 'Rusape'
      WHERE customer_name ILIKE '%ever nyangadza%'
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);

    // ── Add disbursement_date, repayment_date, repayment_amount columns to agreements ──
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS disbursement_date TEXT;`);
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS repayment_date TEXT;`);
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS repayment_amount NUMERIC(12,2);`);

    // ── Data correction: Gerald Matanda — loan amount came in as 0, branch resolved to Main
    // Formitize sent amount in formtext_1="$620.00"; branch "Nova Blufhill" → Bluff Hill (id=13) ──
    await client.query(`
      UPDATE agreements
      SET loan_amount = 620.00,
          branch_id   = 13,
          disbursement_date = '31 Mar 2026',
          repayment_date    = '12 May 2026'
      WHERE LOWER(customer_name) LIKE '%gerald%matanda%'
        AND (loan_amount = 0 OR loan_amount IS NULL);
    `);

    // ── Retailer and Branch mapping tables (cross-system ID tracking) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS retailer_mappings (
        id                   SERIAL PRIMARY KEY,
        central_retailer_id  INTEGER NOT NULL UNIQUE REFERENCES retailers(id) ON DELETE CASCADE,
        revolver_retailer_id INTEGER,
        hukuplus_retailer_id INTEGER,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS branch_mappings (
        id                  SERIAL PRIMARY KEY,
        central_branch_id   INTEGER NOT NULL UNIQUE REFERENCES branches(id) ON DELETE CASCADE,
        revolver_branch_id  INTEGER,
        hukuplus_store_id   INTEGER,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Backfill mapping rows for all existing retailers and branches (with no external IDs yet)
    await client.query(`
      INSERT INTO retailer_mappings (central_retailer_id)
      SELECT id FROM retailers
      ON CONFLICT (central_retailer_id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO branch_mappings (central_branch_id)
      SELECT id FROM branches
      ON CONFLICT (central_branch_id) DO NOTHING;
    `);

    // ── payment_amount column on formitize_notifications ───────────────────
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12,2);`);

    // ── duplicate warning + processing error on formitize_notifications ─────
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS is_duplicate_warning BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS processing_error TEXT;`);
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;`);

    // ── delinquency warning on formitize_notifications ─────────────────────
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS is_delinquent_warning BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS delinquent_match TEXT;`);

    // ── Extended customer profile fields (from application form) ──────────
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS gender TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS date_of_birth TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS marital_status TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS employer_name TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_employed TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nok_name TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nok_relationship TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nok_national_id TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nok_phone TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nok_email TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS nok_address TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS extension_officer TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS sales_rep_name TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS retailer_reference TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS market_type TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS loan_product TEXT;`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS raw_application_data JSONB;`);

    // ── Retailer Xero bank account codes ──────────────────────────────────
    await client.query(`ALTER TABLE retailers ADD COLUMN IF NOT EXISTS xero_bank_account_code TEXT;`);
    await client.query(`UPDATE retailers SET xero_bank_account_code = '101' WHERE name ILIKE '%profeeds%' AND xero_bank_account_code IS NULL;`);
    await client.query(`UPDATE retailers SET xero_bank_account_code = '102' WHERE name ILIKE '%novafeeds%' AND xero_bank_account_code IS NULL;`);
    await client.query(`UPDATE retailers SET xero_bank_account_code = '104' WHERE name ILIKE '%gain%' AND xero_bank_account_code IS NULL;`);
    await client.query(`UPDATE retailers SET xero_bank_account_code = '108' WHERE name ILIKE '%feedmix%' AND xero_bank_account_code IS NULL;`);

    // ── Disbursement tracking on formitize_notifications ───────────────────
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS xero_bank_transaction_id TEXT;`);
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS disbursed_at TIMESTAMPTZ;`);
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS disbursement_amount NUMERIC(12,2);`);

    // ── Customer link on formitize_notifications ────────────────────────────
    await client.query(`ALTER TABLE formitize_notifications ADD COLUMN IF NOT EXISTS customer_id INTEGER REFERENCES customers(id);`);

    // ── Ensure partial unique index on formitize_job_id (required for ON CONFLICT) ──
    // A partial index (WHERE NOT NULL) is the safest form for nullable job_id columns.
    // Uses a distinct name so it is always created regardless of the old non-partial index.
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS formitize_notifications_job_id_notnull_idx ON formitize_notifications (formitize_job_id) WHERE formitize_job_id IS NOT NULL;`);

    // ── Financial fields on agreements ──────────────────────────────────────
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS facility_fee_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS interest_amount NUMERIC(12,2);`);
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS monthly_instalment NUMERIC(12,2);`);
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS loan_tenor_months INTEGER;`);

    // ── WhatsApp messages table ─────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id               SERIAL PRIMARY KEY,
        conversation_id  TEXT NOT NULL,
        wa_id            TEXT NOT NULL,
        sender_name      TEXT,
        message_text     TEXT,
        message_type     TEXT NOT NULL DEFAULT 'text',
        direction        TEXT NOT NULL,
        wati_message_id  TEXT UNIQUE,
        is_read          BOOLEAN NOT NULL DEFAULT FALSE,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_wa_messages_wa_id ON whatsapp_messages(wa_id);
      CREATE INDEX IF NOT EXISTS idx_wa_messages_created ON whatsapp_messages(created_at DESC);
    `);

    // ── Message status on whatsapp_messages ────────────────────────────────
    await client.query(`ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';`);

    // ── Signed documents on agreements ─────────────────────────────────────
    // Stores an array of {url, name} objects uploaded via the document upload form.
    await client.query(`ALTER TABLE agreements ADD COLUMN IF NOT EXISTS signed_documents JSONB DEFAULT '[]'::jsonb;`);

    // ── Backfill formitize_notifications from agreements (applications/reapplications) ──
    // Agreements (application/reapplication form types) were captured before upsertNotification
    // was added to the agreement webhook path, so the notifications feed was missing them.
    await client.query(`
      INSERT INTO formitize_notifications
        (formitize_job_id, form_name, task_type, product, customer_name, customer_id,
         customer_phone, branch_name, retailer_name, status, created_at)
      SELECT
        a.formitize_job_id,
        CASE a.form_type
          WHEN 'application'   THEN 'NEW CUSTOMER APPLICATION'
          WHEN 'reapplication' THEN 'HUKUPLUS RE-APPLICATION'
          ELSE UPPER(a.form_type)
        END,
        a.form_type,
        a.loan_product,
        a.customer_name,
        a.customer_id,
        a.customer_phone,
        b.name,
        r.name,
        CASE WHEN a.status = 'application' THEN 'new' ELSE 'actioned' END,
        a.created_at
      FROM agreements a
      LEFT JOIN branches  b ON b.id = a.branch_id
      LEFT JOIN retailers r ON r.id = a.retailer_id
      WHERE a.form_type IN ('application', 'reapplication')
        AND a.formitize_job_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM formitize_notifications fn
          WHERE fn.formitize_job_id = a.formitize_job_id
        );
    `);

    // ── Normalise customer phone numbers to +263 international format ────────
    // Local Zimbabwean numbers stored as "07XXXXXXXX" → "+2637XXXXXXXX".
    // Numbers already prefixed with "+" (any country code) are left untouched.
    // Numbers stored as "263XXXXXXXXX" (no leading +) get the "+" prepended.
    await client.query(`
      UPDATE customers
      SET phone = CASE
        WHEN phone LIKE '0%'              THEN '+263' || SUBSTR(phone, 2)
        WHEN phone ~ '^263' AND phone NOT LIKE '+%' THEN '+' || phone
        ELSE phone
      END
      WHERE phone IS NOT NULL
        AND phone NOT LIKE '+%';
    `);

    // ── Xero invoice sync columns on agreements ──────────────────────────────
    // source: 'formitize' (default) or 'xero_sync'
    // xero_invoice_id: unique Xero InvoiceID for deduplication
    // dismissed: soft-hide / remove erroneous synced invoices
    // loan_register_id: matching loan ID in the external Loan Register app
    await client.query(`
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS xero_invoice_id TEXT;
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'formitize';
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS loan_register_id INTEGER;
    `);

    // ── Mark Done: staff can dismiss a kiosk row without changing its status ─
    await client.query(`
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS marked_done_at TIMESTAMPTZ;
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS marked_done_by TEXT;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS agreements_xero_invoice_id_uniq
        ON agreements(xero_invoice_id)
        WHERE xero_invoice_id IS NOT NULL;
    `);

    // ── System settings table (key-value store for internal config) ───────
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── One-time data fix: Angeline Shoko payment receipt (job 23498021) ───
    // formcurrency_1 was not extracted by webhook handler — fix payment_amount,
    // branch_name and retailer_name from the known Formitize payload.
    await client.query(`
      UPDATE formitize_notifications
      SET payment_amount = 1935,
          branch_name    = COALESCE(branch_name, 'Bindura CBD'),
          retailer_name  = COALESCE(retailer_name, 'Gain')
      WHERE formitize_job_id = '23498021'
        AND payment_amount IS NULL;
    `);

    // Enable pg_trgm for fuzzy name matching on customer search
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm;`);

    // ── One-time fix: Remap duplicate Xero-sync agreements to original LR IDs ──
    // On 2026-04-02 the Xero sync imported 37 invoices that already had active
    // Loan Register entries (created by a previous sync run). The agreements rows
    // were created pointing to the new (now-deleted) duplicate LR entries. This
    // update re-points them to the original entries so payment routing is correct.
    await client.query(`
      UPDATE agreements SET loan_register_id = CASE loan_register_id
        WHEN 958 THEN 770 WHEN 959 THEN 772 WHEN 960 THEN 773 WHEN 961 THEN 780
        WHEN 962 THEN 791 WHEN 963 THEN 793 WHEN 964 THEN 797 WHEN 965 THEN 799
        WHEN 966 THEN 804 WHEN 967 THEN 807 WHEN 968 THEN 33  WHEN 969 THEN 811
        WHEN 970 THEN 813 WHEN 972 THEN 816 WHEN 973 THEN 817 WHEN 974 THEN 789
        WHEN 975 THEN 818 WHEN 976 THEN 819 WHEN 977 THEN 880 WHEN 978 THEN 881
        WHEN 980 THEN 883 WHEN 981 THEN 885 WHEN 982 THEN 886 WHEN 983 THEN 887
        WHEN 984 THEN 888 WHEN 985 THEN 889 WHEN 986 THEN 891 WHEN 987 THEN 892
        WHEN 988 THEN 890 WHEN 989 THEN 34  WHEN 990 THEN 894 WHEN 991 THEN 895
        WHEN 992 THEN 896 WHEN 993 THEN 897 WHEN 994 THEN 898 WHEN 995 THEN 899
        WHEN 996 THEN 900
      END
      WHERE loan_register_id IN (
        958,959,960,961,962,963,964,965,966,967,968,969,970,972,973,974,
        975,976,977,978,980,981,982,983,984,985,986,987,988,989,990,991,
        992,993,994,995,996
      );
    `);

    // ── One-time fix: delete March 2026 snapshot so it is recreated with ─────
    // the Loan Register disbursement-date based agreement count (ground truth).
    // Guarded via system_settings so it runs exactly once and never wipes a
    // snapshot that has been correctly rebuilt after the fix.
    const marchSnapshotResetDone = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_march_snapshot_reset_v1'`
    );
    if (!marchSnapshotResetDone.rows[0]) {
      await client.query(`
        DELETE FROM monthly_snapshots WHERE month = '2026-03-01'
      `);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_march_snapshot_reset_v1', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── One-time fix v5: delete March 2026 snapshot to rebuild with disbursementDate-only filter
    // Previous builds used creditApprovalDate & completedAt; now only disbursementDate + loanType.
    const marchSnapshotResetV5Done = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_march_snapshot_reset_v5'`
    );
    if (!marchSnapshotResetV5Done.rows[0]) {
      await client.query(`DELETE FROM monthly_snapshots WHERE month = '2026-03-01'`);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_march_snapshot_reset_v5', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── One-time fix v4: delete March 2026 snapshot to rebuild with completedAt filter
    // Previous snapshot used status="active" filter; now using !completedAt which
    // matches the LR "Active Loans" view (includes overdue/late loans too).
    const marchSnapshotResetV4Done = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_march_snapshot_reset_v4'`
    );
    if (!marchSnapshotResetV4Done.rows[0]) {
      await client.query(`DELETE FROM monthly_snapshots WHERE month = '2026-03-01'`);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_march_snapshot_reset_v4', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── One-time fix v3: delete March 2026 snapshot to rebuild with loanType filter ─
    // Previous snapshot counted all loan types; now only HukuPlus is counted.
    const marchSnapshotResetV3Done = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_march_snapshot_reset_v3'`
    );
    if (!marchSnapshotResetV3Done.rows[0]) {
      await client.query(`DELETE FROM monthly_snapshots WHERE month = '2026-03-01'`);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_march_snapshot_reset_v3', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── One-time fix v2: delete March 2026 snapshot saved with count=0 ────────
    // The v1 migration deleted the old 113-count snapshot, but the rebuilt one
    // was saved with agreements_issued=0 because the LR API was returning 401.
    // Delete it again so it gets recalculated with the corrected auth + fallback.
    const marchSnapshotResetV2Done = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_march_snapshot_reset_v2'`
    );
    if (!marchSnapshotResetV2Done.rows[0]) {
      await client.query(`
        DELETE FROM monthly_snapshots WHERE month = '2026-03-01' AND agreements_issued = 0
      `);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_march_snapshot_reset_v2', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── One-time fix: reset upload notifications from auto-actioned → new ────
    // Previously, document uploads were auto-marked "actioned" immediately,
    // bypassing the Activity queue. This was a one-time correction for
    // pre-existing data. Guarded by system_settings so it runs exactly once
    // and never resets items that have been manually actioned by staff.
    const uploadResetDone = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_upload_reset_v1'`
    );
    if (!uploadResetDone.rows[0]) {
      await client.query(`
        UPDATE formitize_notifications
        SET status = 'new'
        WHERE task_type = 'upload' AND status = 'actioned'
      `);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_upload_reset_v1', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── Monthly snapshot store ───────────────────────────────────────────────
    // Permanently stores end-of-month business totals for historical comparison.
    // Current month is always computed live; past months are locked in here.
    await client.query(`
      CREATE TABLE IF NOT EXISTS monthly_snapshots (
        id           SERIAL PRIMARY KEY,
        month        DATE NOT NULL UNIQUE, -- first day of the month, e.g. '2026-04-01'
        new_applications   INT NOT NULL DEFAULT 0,
        re_applications    INT NOT NULL DEFAULT 0,
        agreements_issued  INT NOT NULL DEFAULT 0,
        notes        TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── One-time fix: Martha Fashibeyi (job 23505199) was assigned to ────────
    // Novafeeds Main Branch because the HUKUPLUS LOAN AGREEMENT form didn't
    // include formtext_5 (branch name), triggering the Novafeeds fallback.
    // Her store email chivu@profeeds.co.zw correctly identifies her as a
    // Profeeds Chivu customer. Correct both the agreement and the notification.
    await client.query(`
      UPDATE agreements
      SET branch_id = 24, retailer_id = 1
      WHERE id = 82
        AND branch_id = 3
        AND customer_name ILIKE '%Fashibeyi%'
    `);
    await client.query(`
      UPDATE formitize_notifications
      SET branch_name = 'Chivu', retailer_name = 'Profeeds'
      WHERE formitize_job_id = '23505199'
        AND branch_name = 'Main Branch'
        AND retailer_name = 'Novafeeds'
    `);

    // ── Reset Xero sync timestamp once to force 7-day backfill ───────────────
    // The previous sync logic used date-only ModifiedAfter which caused new
    // invoices to be missed past page 1. Clear the timestamp once so the first
    // run after this fix fetches a 7-day window and catches pending invoices.
    // Guarded: once the sync has run and written a new ISO-format timestamp,
    // this no longer triggers.
    const xeroResetDone = await client.query(
      `SELECT value FROM system_settings WHERE key = 'migration_xero_ts_reset_v1'`
    );
    if (!xeroResetDone.rows[0]) {
      await client.query(`DELETE FROM system_settings WHERE key = 'xero_invoice_last_sync'`);
      await client.query(`
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ('migration_xero_ts_reset_v1', 'done', NOW())
        ON CONFLICT (key) DO NOTHING
      `);
    }

    // ── Fix mislabelled payroll/salary deduction notifications ───────────────
    // Any Formitize notification whose form_name includes "payroll deduction"
    // or "salary deduction" should be product=ChikweretiOne, not HukuPlus.
    // This applies retroactively to any records created before the detection
    // logic was updated (tracking category: "Tefco Salary Deduction").
    await client.query(`
      UPDATE formitize_notifications
      SET product = 'ChikweretiOne'
      WHERE product = 'HukuPlus'
        AND (
          LOWER(form_name) LIKE '%payroll deduction%' OR
          LOWER(form_name) LIKE '%salary deduction%' OR
          LOWER(form_name) LIKE '%payroll / salary%'
        )
    `);

    // Same fix for customers table — loanProduct was set from the notification
    await client.query(`
      UPDATE customers
      SET loan_product = 'ChikweretiOne'
      WHERE loan_product = 'HukuPlus'
        AND id IN (
          SELECT customer_id FROM formitize_notifications
          WHERE product = 'ChikweretiOne'
            AND customer_id IS NOT NULL
        )
    `);

    // ── Lead per-user dismissals (feed read receipts) ────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_dismissals (
        id SERIAL PRIMARY KEY,
        lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        staff_email TEXT NOT NULL,
        dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(lead_id, staff_email)
      );
    `);

    // ── Leads (field sales prospect recording) ──────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id SERIAL PRIMARY KEY,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        retailer_id INTEGER REFERENCES retailers(id),
        branch_id INTEGER REFERENCES branches(id),
        retailer_name TEXT,
        branch_name TEXT,
        flock_size INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'acknowledged', 'converted', 'dropped')),
        notes TEXT,
        submitted_by TEXT,
        acknowledged_at TIMESTAMPTZ,
        acknowledged_by TEXT,
        converted_at TIMESTAMPTZ,
        converted_customer_id INTEGER REFERENCES customers(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Add loan_product to leads table
    await client.query(`
      ALTER TABLE leads
        ADD COLUMN IF NOT EXISTS loan_product TEXT NOT NULL DEFAULT 'HukuPlus';
    `);

    // ── Home store columns on customers (retailer_id + branch_id) ─────────────
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS retailer_id INTEGER REFERENCES retailers(id);`);
    await client.query(`ALTER TABLE customers ADD COLUMN IF NOT EXISTS branch_id   INTEGER REFERENCES branches(id);`);

    // ── Data correction: Edna Makonese — New Customer Application (Profeeds Masvingo)
    // Store email masvingo@profeeds.co.zw was not matched by the hardcoded field name list
    // so retailer resolution fell back to Novafeeds; confirmed Profeeds Masvingo ──
    await client.query(`
      UPDATE formitize_notifications
      SET retailer_name = 'Profeeds', branch_name = 'Masvingo'
      WHERE customer_name ILIKE '%edna%makonese%'
        AND (retailer_name ILIKE '%novafeed%' OR retailer_name IS NULL);
    `);
    await client.query(`
      UPDATE agreements
      SET
        retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1),
        branch_id   = (
          SELECT b.id FROM branches b
          JOIN retailers r ON r.id = b.retailer_id
          WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%masving%'
          LIMIT 1
        )
      WHERE customer_name ILIKE '%edna%makonese%'
        AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%novafeed%' LIMIT 1);
    `);
    await client.query(`
      UPDATE activity
      SET retailer_name = 'Profeeds', branch_name = 'Masvingo',
          description   = REPLACE(description, 'Novafeeds', 'Profeeds')
      WHERE description ILIKE '%edna%makonese%'
        AND (retailer_name ILIKE '%novafeed%' OR description ILIKE '%novafeeds%');
    `);

    // ── Remove phantom "Main Branch" for Profeeds ────────────────────────────
    // "Main Branch" (id=1) was created during initial setup and does not represent
    // a real location. Reassign the two known Kwekwe applications, null out any
    // remaining references, then delete the branch so it no longer pollutes matching.
    await client.query(`
      -- Reassign Tafadzwa Munengwa and Shingirayi Mavhunga → Kwekwe
      UPDATE agreements
      SET branch_id = (
        SELECT b.id FROM branches b
        JOIN retailers r ON r.id = b.retailer_id
        WHERE r.name ILIKE '%profeed%' AND b.name ILIKE '%kwekwe%'
        LIMIT 1
      )
      WHERE id IN (3451, 3452)
        AND branch_id = (SELECT id FROM branches WHERE name = 'Main Branch' AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1) LIMIT 1);
    `);
    await client.query(`
      -- Null out any remaining agreements still pointing at "Main Branch"
      UPDATE agreements
      SET branch_id = NULL
      WHERE branch_id = (
        SELECT id FROM branches WHERE name = 'Main Branch'
          AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1)
        LIMIT 1
      );
    `);
    await client.query(`
      -- Null out any customers still pointing at "Main Branch"
      UPDATE customers
      SET branch_id = NULL
      WHERE branch_id = (
        SELECT id FROM branches WHERE name = 'Main Branch'
          AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1)
        LIMIT 1
      );
    `);
    await client.query(`
      -- Delete the phantom branch now that all references are cleared
      DELETE FROM branches
      WHERE name = 'Main Branch'
        AND retailer_id = (SELECT id FROM retailers WHERE name ILIKE '%profeed%' LIMIT 1)
        AND NOT EXISTS (
          SELECT 1 FROM agreements WHERE branch_id = branches.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM customers WHERE branch_id = branches.id
        );
    `);

    // ── messaged_at on leads ──────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS messaged_at TIMESTAMPTZ;
    `);

    // ── dismissed_at on leads (global team-wide mark-done) ────────────────────
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS dismissed_by TEXT;
    `);

    // ── dropped_at on leads (permanently inconvertible) ───────────────────────
    await client.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS dropped_at TIMESTAMPTZ;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS dropped_by TEXT;
    `);

    // ── email column on branches (populated by LR sync) ──────────────────────
    await client.query(`
      ALTER TABLE branches ADD COLUMN IF NOT EXISTS email TEXT;
    `);

    // ── Widen leads status check constraint to include 'dropped' ──────────────
    // Drop the old constraint (name may vary) and recreate with the full set.
    await client.query(`
      ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
      ALTER TABLE leads ADD CONSTRAINT leads_status_check
        CHECK (status IN ('new', 'acknowledged', 'converted', 'dropped'));
    `);

    // ── Revolver mirror tables (Revolver → Central read sync) ─────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS revolver_customers (
        revolver_id       INTEGER PRIMARY KEY,
        name              TEXT,
        email             TEXT,
        phone             TEXT,
        phone_norm        TEXT,
        company           TEXT,
        revolver_retailer_id    INTEGER,
        revolver_branch_id      INTEGER,
        central_customer_id     INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        central_retailer_id     INTEGER REFERENCES retailers(id) ON DELETE SET NULL,
        central_branch_id       INTEGER REFERENCES branches(id)  ON DELETE SET NULL,
        access_enabled    BOOLEAN DEFAULT TRUE,
        weekly_tray_target INTEGER,
        raw               JSONB,
        synced_at         TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS revolver_facilities (
        revolver_id            INTEGER PRIMARY KEY,
        revolver_customer_id   INTEGER,
        central_customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        status                 TEXT,
        credit_limit           NUMERIC,
        outstanding_balance    NUMERIC,
        available_balance      NUMERIC,
        raw                    JSONB,
        synced_at              TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS revolver_drawdown_requests (
        revolver_id            INTEGER PRIMARY KEY,
        revolver_facility_id   INTEGER,
        revolver_customer_id   INTEGER,
        central_customer_id    INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        amount                 NUMERIC,
        status                 TEXT,
        raw                    JSONB,
        synced_at              TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // ── Dismissed flag on agreements (bookings pipeline dismiss) ──────────────
    await client.query(`
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT FALSE;
    `);

    // ── Store raw Formitize form name on agreements (for precise pipeline filtering) ─
    // Allows the pipeline to filter by exact form name rather than the coarse form_type
    // classification — prevents expense claim forms from appearing as applications.
    await client.query(`
      ALTER TABLE agreements ADD COLUMN IF NOT EXISTS form_name TEXT;
    `);

    // ── Dismiss known expense-claim records that were mis-classified as applications ─
    // Kudakwashe Muchuchu submitted an expense claim form whose name contained
    // "application", causing it to be stored as status='application'. These are not
    // loan applications and must not appear in the bookings pipeline.
    await client.query(`
      UPDATE agreements
      SET dismissed = true
      WHERE LOWER(customer_name) LIKE '%muchuchu%'
        AND status = 'application'
        AND (form_type = 'application' OR form_type = 'unknown');
    `);

    // ── 2026-05-01: Dedup resubmission agreements (5-day window) ──────────────
    // Formitize workflows sometimes re-submit the same form with a fresh jobId.
    // If the same customer+product+form_type has multiple open rows within 5 days,
    // keep the most recent one (highest id) and dismiss the older duplicates.
    await client.query(`
      UPDATE agreements a
      SET dismissed = true
      WHERE a.status IN ('application', 'reapplication')
        AND (a.dismissed IS NULL OR a.dismissed = false)
        AND EXISTS (
          SELECT 1 FROM agreements newer
          WHERE LOWER(TRIM(newer.customer_name)) = LOWER(TRIM(a.customer_name))
            AND newer.form_type = a.form_type
            AND newer.loan_product = a.loan_product
            AND newer.id > a.id
            AND newer.created_at BETWEEN a.created_at AND a.created_at + INTERVAL '5 days'
        );
    `);
    // Mark older duplicate notifications (same customer+type+product within 5 days)
    // as actioned so they don't clutter the Activity 'New' feed.
    await client.query(`
      UPDATE formitize_notifications fn
      SET status = 'actioned'
      WHERE fn.status = 'new'
        AND fn.task_type IN ('application', 'reapplication')
        AND EXISTS (
          SELECT 1 FROM formitize_notifications newer
          WHERE LOWER(TRIM(newer.customer_name)) = LOWER(TRIM(fn.customer_name))
            AND newer.task_type = fn.task_type
            AND newer.product = fn.product
            AND newer.id > fn.id
            AND newer.created_at BETWEEN fn.created_at AND fn.created_at + INTERVAL '5 days'
        );
    `);

    // ── 2026-05-01: Auto-dismiss pending bookings converted to live agreements ──
    // When a real loan agreement arrives for a customer, dismiss any open
    // application/re-application that was submitted SHORTLY BEFORE it (within 30 days).
    // IMPORTANT: Only match agreements created AFTER the application — do NOT dismiss
    // re-applications just because the customer had a completed loan months ago.
    await client.query(`
      UPDATE agreements a
      SET dismissed = true
      WHERE a.status IN ('application', 'reapplication')
        AND (a.dismissed IS NULL OR a.dismissed = false)
        AND EXISTS (
          SELECT 1 FROM agreements newer
          WHERE LOWER(newer.customer_name) = LOWER(a.customer_name)
            AND newer.form_type = 'agreement'
            AND newer.status IN ('pending', 'active', 'completed')
            AND newer.id != a.id
            AND newer.created_at > a.created_at
            AND newer.created_at < a.created_at + INTERVAL '30 days'
        );
    `);

    // ── 2026-05-01: Restore re-application agreements to Bookings pipeline ─────
    // Re-applications that were previously dismissed from the Bookings page via
    // the X button had dismissed=true, but staff later used "Push to Bookings"
    // to set a disbursement_date without clearing the dismissed flag. This caused
    // them to remain invisible in the Bookings pipeline despite having a date set.
    // Un-dismiss any re-application with a future (>= today) disbursement_date,
    // UNLESS the customer was recently converted (new agreement within 30 days after).
    await client.query(`
      UPDATE agreements a
      SET dismissed = false
      WHERE a.form_type = 'reapplication'
        AND a.dismissed = true
        AND a.disbursement_date IS NOT NULL
        AND TRIM(a.disbursement_date) != ''
        AND a.disbursement_date::date >= CURRENT_DATE
        AND NOT EXISTS (
          SELECT 1 FROM agreements live
          WHERE LOWER(live.customer_name) = LOWER(a.customer_name)
            AND live.form_type = 'agreement'
            AND live.status IN ('pending', 'active', 'completed')
            AND live.id != a.id
            AND live.created_at > a.created_at
            AND live.created_at < a.created_at + INTERVAL '30 days'
        );
    `);

    // ── 2026-05-01: Repair incorrectly dismissed applications (old-loan false positive) ─
    // The earlier version of the auto-dismiss migration had no time constraint, so
    // it dismissed applications/re-applications for customers who had OLD completed
    // loans — even when no new agreement had been created since the application.
    // Restore these so April walk-ins and May re-applications reappear correctly.
    await client.query(`
      UPDATE agreements a
      SET dismissed = false
      WHERE a.dismissed = true
        AND a.form_type IN ('application', 'reapplication')
        AND NOT EXISTS (
          SELECT 1 FROM agreements live
          WHERE LOWER(TRIM(live.customer_name)) = LOWER(TRIM(a.customer_name))
            AND live.form_type = 'agreement'
            AND live.status IN ('pending', 'active', 'completed')
            AND live.id != a.id
            AND live.created_at > a.created_at
            AND live.created_at < a.created_at + INTERVAL '30 days'
        )
        AND EXISTS (
          SELECT 1 FROM agreements any_live
          WHERE LOWER(TRIM(any_live.customer_name)) = LOWER(TRIM(a.customer_name))
            AND any_live.form_type = 'agreement'
            AND any_live.id != a.id
        );
    `);

    // ── 2026-05-04: Dismiss applications where a fuzzy-matched agreement exists ───
    // The old auto-dismiss used exact name matching, so name variants (reversed
    // word order like "Memory Tapera" vs "Tapera Memory", or added middle names
    // like "Mackenzie Mugove Chipangura" vs "Mackenzie Chipangura") caused
    // applications to remain open even after the loan was created. Dismiss any
    // open application/re-application where a pending/active/completed agreement
    // with a trigram similarity > 0.6 was created within 30 days after it.
    await client.query(`
      UPDATE agreements a
      SET dismissed = true
      WHERE a.status IN ('application', 'reapplication')
        AND (a.dismissed IS NULL OR a.dismissed = false)
        AND a.created_at > NOW() - INTERVAL '60 days'
        AND EXISTS (
          SELECT 1 FROM agreements live
          WHERE similarity(LOWER(TRIM(live.customer_name)), LOWER(TRIM(a.customer_name))) > 0.6
            AND live.form_type = 'agreement'
            AND live.status IN ('pending', 'active', 'completed')
            AND live.id != a.id
            AND live.created_at > a.created_at
            AND live.created_at < a.created_at + INTERVAL '30 days'
        );
    `);

    console.log("[migrate] All migrations complete.");
  } finally {
    client.release();
  }
}
