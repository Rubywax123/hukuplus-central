# AGENTS.md

## Cursor Cloud specific instructions

### Architecture overview

pnpm workspace monorepo — **HukuPlusCentral** — a central command platform for Tefco Finance's three loan products. See `replit.md` for the full structure, API routes, and schema details.

| Workspace | Path | Role |
|---|---|---|
| `@workspace/api-server` | `artifacts/api-server` | Express 5 API backend (port from `PORT` env) |
| `@workspace/hukupluscentral` | `artifacts/hukupluscentral` | React + Vite frontend SPA |
| `@workspace/db` | `lib/db` | Drizzle ORM schema + PostgreSQL connection |
| `@workspace/api-client-react` | `lib/api-client-react` | Generated React Query hooks (Orval codegen from OpenAPI) |
| `@workspace/api-zod` | `lib/api-zod` | Generated Zod validation schemas |

### Running services locally

**Prerequisites:** Node.js 24, pnpm, PostgreSQL 16 running with a database configured via `DATABASE_URL`.

**Start API server:**
```
DATABASE_URL="postgresql://hukucentral:hukucentral@localhost:5432/hukupluscentral" PORT=3001 pnpm --filter @workspace/api-server dev
```

**Start frontend dev server:**
```
PORT=5173 pnpm --filter @workspace/hukupluscentral dev
```

**Important — reverse proxy required for local dev:** The frontend makes API calls to relative paths (`/api/...`). On Replit, both services share one domain. Locally, you must proxy both through a single port. An nginx config is set up at `/etc/nginx/sites-available/hukucentral` routing port 8080: `/api/*` → localhost:3001, everything else → localhost:5173. Start nginx with `nginx` (or `nginx -s reload` if already running).

### Fresh database gotcha

The API server's startup migration (`artifacts/api-server/src/lib/migrate.ts`) references the `monthly_snapshots` and `leads` tables in one-time data-fix migrations **before** those tables' `CREATE TABLE IF NOT EXISTS` statements. On a production DB this is fine (tables already exist), but on a **fresh** local DB these early references fail.

**Fix:** Before first API server start, pre-create these two tables:
```sql
-- Run against your local DB:
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  id SERIAL PRIMARY KEY, month DATE NOT NULL UNIQUE,
  new_applications INT NOT NULL DEFAULT 0, re_applications INT NOT NULL DEFAULT 0,
  agreements_issued INT NOT NULL DEFAULT 0, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY, customer_name TEXT NOT NULL, phone TEXT NOT NULL,
  retailer_id INTEGER, branch_id INTEGER, retailer_name TEXT, branch_name TEXT,
  flock_size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','acknowledged','converted','dropped')),
  notes TEXT, submitted_by TEXT, acknowledged_at TIMESTAMPTZ, acknowledged_by TEXT,
  converted_at TIMESTAMPTZ, converted_customer_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
After that, `pnpm --filter @workspace/api-server dev` will run all remaining migrations successfully.

### DB schema push

`pnpm --filter db push` runs `drizzle-kit push` to sync the Drizzle-managed tables. Note: not all tables are in the Drizzle schema — many are created by raw SQL in the migration file above.

### Seeded admin account

The migration seeds a super_admin staff user: `simon.reid@marishoma.com` / `206362`. Login via `POST /api/staff/login`.

### Typecheck

`pnpm run typecheck` — runs `tsc --build` on libs, then per-artifact typechecks. Pre-existing TS errors exist in `lib/api-zod` (duplicate exports) and `lib/replit-auth-web` (missing `ImportMeta.env`); these do not block the app from running.

### Lint

No ESLint config exists. Prettier is available: `npx prettier --check .`

### External integrations (all optional)

Xero, WATI (WhatsApp), Formitize, the three external loan apps, and Gmail SMTP all require secrets not present locally. The app runs fine without them — sync tasks log warnings and skip gracefully.

### This is a live production system

Do **not** modify code unless specifically asked. Audit thoroughly before making changes. External integrations connect to real business services (Xero accounting, WhatsApp messaging, Formitize forms, three separate Replit-hosted loan apps).
