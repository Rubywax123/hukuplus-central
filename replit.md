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

1. **Internal Zone** (requires login): Dashboard, Retailers, Agreements, Team management
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
- `POST /api/sign/:token/submit` — submit digital signature

### Dashboard
- `GET /api/dashboard/stats`
- `GET /api/dashboard/recent-activity`

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

## Future Roadmap

- Enable API key support in each loan app → live data sync in HukuPlusCentral
- Gmail integration for email-based communications
- WhatsApp Business API (Twilio) for mass messaging to customers/stores using flyer assets
- AI credit decision layer (ML-based approvals)
- Formitize webhook integration for automatic agreement generation
