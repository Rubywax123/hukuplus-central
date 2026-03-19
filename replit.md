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

### Loan Products
- **HukuPlus** — Broiler feed loans
- **Revolver** — Revolving feed wallet for layers
- **Salary** — Salary payroll deduction loans

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

## Frontend Routes

- `/` — Login screen (if unauthenticated) or redirect to dashboard
- `/dashboard` — Stats + activity feed
- `/retailers` — Retailer and branch management
- `/agreements` — Loan agreement list + create
- `/team` — Team member role management
- `/sign/:token` — **PUBLIC** loan agreement signing gateway

## Future Roadmap

- Gmail integration for email-based communications
- WhatsApp Business API (Twilio) for mass messaging to customers/stores
- AI credit decision layer (ML-based approvals)
- Formitize webhook integration for automatic agreement generation
- Connection to HukuPlus, Revolver, Salary app APIs
