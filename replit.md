# HukuPlusCentral Workspace

## Overview

pnpm workspace monorepo using TypeScript. Central command platform for HukuPlus loan management business.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Auth**: Replit Auth (OIDC/PKCE) via `@workspace/replit-auth-web`
- **Frontend**: React + Vite (Wouter routing, TanStack Query, Shadcn/UI)
- **Build**: esbuild (CJS bundle)

## Project: HukuPlusCentral

Central command platform connecting three loan apps (HukuPlus - Broiler Feed Loans, Revolver - Revolving Feed Wallet, Salary - Payroll Deduction Loans).

### Two Zones

1. **Internal Zone** (requires login): Dashboard, Retailers, Agreements, Team management, Notifications feed
2. **Public Zone** (`/sign/:token`): Secure loan agreement signing gateway — no login required, three-factor identity verification (Retailer + Branch + Customer Name)

### Loan Products & App URLs
| Product | Description | App URL | Env Var |
|---|---|---|---|
| **HukuPlus** | Broiler feed loans (42-day) | https://loan-manager-automate.replit.app | `HUKUPLUS_URL` |
| **Revolver** | Revolving feed wallet for layers | https://credit-facility-manager.replit.app | `REVOLVER_URL` |
| **ChikweretiOne** | Payroll deduction loans (3–12 months) | https://loan-mastermind--cz86dbq6qp.replit.app | `CHIKWERETION_URL` |

All three apps have protected APIs (return 401/Authentication Required). To enable live data sync, each app must be updated to accept a Bearer API token. Set `HUKUPLUS_API_KEY`, `REVOLVER_API_KEY`, `CHIKWERETION_API_KEY` in this project's secrets once each app's API key support is enabled.

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (auth, retailers, agreements, dashboard, users)
│   ├── hukupluscentral/    # React+Vite frontend (previewPath: /)
│   └── mockup-sandbox/     # Design prototyping sandbox
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   ├── replit-auth-web/    # Browser auth package (useAuth hook)
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Database Schema

- `sessions` — Replit Auth session storage
- `users` — Team users (id, email, firstName, lastName, profileImageUrl, role, createdAt)
- `retailers` — Retailer companies (name, contactEmail, contactPhone, address, isActive)
- `branches` — Store branches per retailer (name, location, contactPhone, isActive)
- `agreements` — Loan agreements (retailerId, branchId, customerName, loanProduct, loanAmount, formitizeJobId, formitizeFormUrl, signingToken, status, signedAt, signatureData)
- `activity` — Activity feed log

## API Routes

All routes mounted at `/api`:

### Auth
- `GET /api/auth/user` — current user
- `GET /api/login` — OIDC login redirect
- `GET /api/callback` — OIDC callback
- `GET /api/logout` — logout redirect

### Retailers & Branches
- `GET/POST /api/retailers`
- `GET/PATCH /api/retailers/:id`
- `GET/POST /api/retailers/:id/branches`
- `PATCH/DELETE /api/retailers/:id/branches/:id`

### Agreements
- `GET/POST /api/agreements`
- `GET /api/agreements/:id`

### Public Signing Gateway (no auth required)
- `GET /api/sign/:token` — get signing session info
- `POST /api/sign/:token/verify` — verify Retailer+Branch+Customer identity
- `GET /api/sign/:token/agreement.pdf` — download agreement as PDF (token is the credential; no staff auth required; used for kiosk PDF viewer + WATI delivery URL)
- `POST /api/sign/:token/submit` — submit all 4 digital signatures; triggers background delivery (WhatsApp via WATI + Formitize job attachment)

### Dashboard
- `GET /api/dashboard/stats`
- `GET /api/dashboard/recent-activity`
- `GET /api/dashboard/disbursement-pipeline` — returns open applications (status='application'|'reapplication') grouped into thisMonth / nextMonth / noDate buckets by disbursement date; items fall away automatically when status changes to pending/signed/expired

#### LR Loan Count Logic (Resolved)
- Loan counts (agreements_issued) come from the LR API: `GET /api/central/loans` with `Authorization: Bearer HUKUPLUS_API_KEY`
- **Filter**: `loanType === "hukuplus"` + `disbursementDate` starts with `YYYY-MM` only
- **disbursementDate ONLY** — other date fields (creditApprovalDate, createdAt) are NOT used; they fall in different months and cause overcounting
- No status/completedAt filter — historical months count all loans ever issued, matching the LR web UI
- Confirmed correct: March = 63, April = 11 (as shown in LR web UI)

### Users
- `GET /api/users`
- `PATCH /api/users/:id/role`

### Integrations
- `GET /api/integrations/apps` — list all three loan apps + API key status
- `GET /api/integrations/apps/:id/ping` — health check a specific loan app (hukuplus | revolver | chikweretion)

## Frontend Routes

- `/` — Login screen (if unauthenticated) or redirect to dashboard
- `/retailers` — Retailer and branch management
- `/agreements` — Loan agreement list + create
- `/loan-apps` — Loan Apps hub (quick launch + API connectivity status for all 3 apps)
- `/team` — Team member role management
- `/sign/:token` — **PUBLIC** loan agreement signing gateway

## WhatsApp Flyers (attached_assets)
- `HukuPlusWhatsapp_1773897032482.jpg` — Orange, broiler chicken branding
- `RevolverWhatsapp_1773897032483.PNG` — Blue, layers/eggs branding
- `ChikweretiOneWhatsapp_1773897032481.jpg` — Dark/gold, salary loans branding
- All three share contact: +263775900563 (Tefco Finance)

## Retailer Portal

A separate login system at `/portal/login` for retail partners (not Tefco staff).

### Roles
- `retailer_admin` — sees all branches for their retailer
- `store_staff` — sees only their own branch

### Portal API Routes (no Replit Auth)
- `POST /api/portal/login` — email + password login
- `POST /api/portal/logout`
- `GET /api/portal/me`
- `POST /api/portal/change-password`
- `GET /api/portal/agreements` — filtered by role/branchId
- `GET /api/portal/agreements/:id`

### Portal User Management (Tefco staff only, Replit Auth required)
- `GET /api/portal/users`
- `POST /api/portal/users` — create retailer/store account
- `PATCH /api/portal/users/:id`
- `DELETE /api/portal/users/:id` (soft deactivate)

### Formitize Webhook
- `POST /api/formitize/webhook` — auto-creates agreement from Formitize form submission
- Secured by `FORMITIZE_WEBHOOK_SECRET` env var (optional)
- Maps: retailer_name, branch_name, customer_name, customer_phone, loan_product, loan_amount, job_id, form_url
- **Customer enrichment on arrival**: On application/agreement webhook, also extracts and stores on the customer record:
  - Personal: gender, date_of_birth, marital_status, is_employed, employer_name
  - Next-of-Kin: nok_name, nok_relationship, nok_national_id, nok_phone, nok_email, nok_address
  - Application meta: sales_rep_name, retailer_reference, market_type, loan_product
  - Raw application JSONB stored for future extraction
- **Xero auto-link**: After creating a new customer, searches Xero contacts by name and links if unique match found
- **National ID dedup**: Also matches existing customers by national_id (added as 3rd dedup step)

### DB Schema
- `portal_users` — id, name, email, passwordHash, retailerId, branchId, role, isActive, mustChangePassword

## Phase 4 — Customer Requests (Communications)

### HukuPlus Repeat Loan Applications
- Public form at `/apply/hukuplus` — customers verify by name + phone
- Validation: amount limit = 2.06 × chick count; collection date >= chick date + 12 days
- On submit: email sent to operations@marishoma.com + in-app notification to registered store
- Admin page at `/applications` (tab: HukuPlus Repeat Loans) — status management

### Revolver Drawdown Requests
- Public form at `/apply/revolver` — customers verify by name + phone
- Shows facility limit + calculated available balance (limit minus actioned drawdowns)
- Customer picks collection store (defaults to their registered store, can override)
- On submit: email to operations@marishoma.com + store email(s) + in-app store notification
- Store portal: amber banner shows pending drawdowns with "Confirm Actioned" button
- Admin page at `/applications` (tab: Revolver Drawdowns) — status management

### New API Routes
- `POST /api/applications/customer-verify` — verify customer by name + phone (public)
- `POST /api/applications/loan` — submit HukuPlus repeat loan application (public)
- `GET /api/applications/loan` — list all loan applications (admin)
- `PUT /api/applications/loan/:id` — update status/notes (admin)
- `POST /api/applications/drawdown` — submit Revolver drawdown request (public)
- `GET /api/applications/drawdown` — list all drawdown requests (admin)
- `PUT /api/applications/drawdown/:id` — update status (admin)
- `PUT /api/applications/drawdown/:id/confirm` — store confirms actioned (portal)
- `GET /api/applications/drawdown/store` — store's own drawdown requests (portal)
- `GET /api/applications/messages` — in-app messages for store (portal)
- `GET /api/applications/messages/unread-count` — unread count (portal)
- `PUT /api/applications/messages/:id/read` — mark message read (portal)
- `GET /api/applications/retailers` — store picker for public forms (public)

### New DB Tables
- `loan_applications` — HukuPlus repeat loan application records
- `drawdown_requests` — Revolver drawdown request records  
- `in_app_messages` — in-app notifications for store portal

### Email (SMTP)
- Provider: Gmail/Google Workspace SMTP (smtp.gmail.com:587)
- From: operations@marishoma.com
- Secrets: EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_SMTP_USER, EMAIL_SMTP_PASS

## Phase 5 — Staff Roles & Sales Agent

### Staff Roles (staff_users table)
- `super_admin` — Principal Admin: full access including staff management
- `admin` — Admin: broad operational access
- `staff` — Standard Staff: operational access, leads-only Activity tab
- `sales_agent` — Sales Agent: restricted to leads submission (Activity) + My Customers page only

### Agronomist Role (portal_users table)
- `agronomist` — Portal user tied to a retailer; can submit leads + view own history at `/portal/agronomist`
- Managed by staff at Customers → Agronomists tab

### Sales Agent Flow
- Created via Customers → Staff → Add Staff Member (select Sales Agent role)
- After login, sees only: Activity (leads tab) + My Customers
- My Customers page (`/my-customers`): shows customers where `sales_rep_name` matches agent's name + all their loan agreements
- SalesAgentGuard in App.tsx redirects to /activity if they navigate to restricted pages

### Lead Attribution
- `submitted_by` on leads tracks who submitted: staff by email, agronomists as "Name <email>"
- Both staff and portal agronomist sessions can POST /api/leads

### Loan Register (customers.tsx)
- Customer list table has a "Sales Agent" column (shows `sales_rep_name`, xl: breakpoint)
- Customer detail Application Info section shows "Sales Agent" field explicitly

### New API Routes
- `GET /api/customers/assigned/mine` — returns customers where sales_rep_name ILIKE agent's name, with agreements

## Pending Configuration (action required)

### Wati Webhook Registration
Wati must be told where to forward inbound customer messages. Without this, messages are not logged to Central.
1. Log into Wati at app.wati.io
2. Go to Settings → API (or Integrations → Webhook)
3. Paste this URL as the webhook endpoint:
   `https://huku-plus-central.replit.app/api/whatsapp/webhook`
4. Save

Both env vars are already set:
- `WATI_API_URL` = https://live-mt-server.wati.io/10123607
- `WATI_API_TOKEN` = (set in secrets)

Once registered, all inbound WhatsApp messages will appear in the WhatsApp tab in Activity and be logged to the database for ML purposes.

## Future Roadmap

- Phase 5: APS (Automated Payment System) integration
- Phase 6: AI/ML credit decision layer
- WhatsApp template automation — trigger outbound messages from activity queue events (payment processed, application received, disbursement sent)
- "Send WhatsApp" button on activity notification cards
- Customer phone → Wati contact auto-linking
- AI analysis of captured conversation and application data
