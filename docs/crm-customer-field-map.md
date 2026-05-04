# CRM customer field map (Central)

Living reference: **where each fact lives** and **how it is populated**. Update when forms or APIs change.

Related: **`crm-enhancement-plan.md`**, **`crm-field-sync-matrix.md`** (retailer/branch).

## Merge policies (today)

| Source | Typed columns (`customers.*`) | `raw_application_data` (jsonb) |
|--------|------------------------------|--------------------------------|
| **Formitize webhook** (`routes/formitize.ts`) | **Fill-empty only** (`COALESCE(col, inbound)`) | **Shallow merge** — `existing \|\| incoming` at top level (newer submission overwrites same key) |
| **Staff UI** (`PUT /api/customers/:id`) | **Full replace** per field sent in body | Not written from this route |
| **Backfill** (`POST /api/customers/backfill-from-form-data`) | Fill-empty | **Shallow merge** (same as webhook after alignment) |

**Excluded from staff UI:** `sales_rep_name` is treated as owned elsewhere (LR); see comment in `customers.ts`.

---

## A. Identity & contact

| Concept | Drizzle / DB column | Staff `PUT /customers/:id` | Formitize webhook (needles / notes) |
|---------|---------------------|-----------------------------|-------------------------------------|
| Full name | `full_name` | `fullName` | Webhook uses `customerName` from form (not COALESCE column on update — new row only); see handler |
| Phone | `phone` | `phone` (normalised) | `normPhone` from `customerPhone` / field map |
| Email | `email` | `email` | `customerEmail` + field map |
| National ID | `national_id` | `nationalId` | `nationalIdRaw` from form |
| Address | `address` | `address` | `customerAddress` |
| Formitize CRM id | `formitize_crm_id` | *(not exposed in PUT snippet)* | From `body.content` keys `formCRM*` nodes (`crmid`, etc.) |
| Xero contact | `xero_contact_id` | `xeroContactId` | Webhook auto-link / not from field map |

---

## B. Personal & employment

| Concept | DB column | Staff PUT | Formitize `findField` needles (representative) |
|---------|-----------|-----------|--------------------------------------------------|
| Gender | `gender` | `gender` | `applicantgender`, `gender` |
| Date of birth | `date_of_birth` | `dateOfBirth` | `applicantdateofbirth`, `dateofbirth`, `date of birth`, `dob` |
| Marital status | `marital_status` | `maritalStatus` | `maritalstatus`, `marital status` |
| Employed? | `is_employed` | `isEmployed` | `areyouemployed`, `employed`, `earnsalary` |
| Employer | `employer_name` | `employerName` | `employercompany`, `nameofemployer`, `employername`, `employer`, `placeofwork` |

---

## C. Next of kin

| Concept | DB column | Staff PUT | Formitize needles |
|---------|-----------|-----------|-------------------|
| NOK name | `nok_name` | `nokName` | `nextofkinfullname`, `nextofkinname`, …, `formtext_5` |
| Relationship | `nok_relationship` | `nokRelationship` | `relationshiptoborrower`, …, `formtext_7` |
| NOK ID | `nok_national_id` | `nokNationalId` | `nextofkinid`, …, `formtext_6` |
| NOK phone | `nok_phone` | `nokPhone` | `nextofkintelephone`, …, `formtext_8` |
| NOK email | `nok_email` | `nokEmail` | `nextofkinemail`, `nokemail`, … |
| NOK address | `nok_address` | `nokAddress` | `nextofkinaddress`, `nokaddress`, `kinaddress` |

---

## D. Store & application meta

| Concept | DB column | Staff PUT | Formitize / notes |
|---------|-----------|-----------|-------------------|
| Home retailer | `retailer_id` | `retailerId` | Resolved from branch/product rules; **COALESCE** on update (manual correction preserved) |
| Home branch | `branch_id` | `branchId` | Same |
| Extension officer (branch staff) | `extension_officer` | `extensionOfficer` | `nameofsalesrepresentative`, `salesrep`, …, **HukuPlus agreement:** `formtext_3`, `formtext_4` |
| Retailer reference | `retailer_reference` | `retailerReference` | `retailerreferencenumber`, `retailerreference`, … |
| Market type | `market_type` | `marketType` | `wheredoesthecustomersell`, `sellchickens`, `markettype`, `sellbirds` |
| Loan product (profile) | `loan_product` | `loanProduct` | Product string from form routing + `extendedFields` |
| Internal sales rep | `sales_rep_name` | **intentionally omitted** | Not set from Formitize block (reserved / LR-owned) |

---

## E. Free-form & agreements

| Concept | DB column | Notes |
|---------|-----------|--------|
| Staff notes | `notes` | Staff PUT only in practice |
| Full submission snapshot | `raw_application_data` | **All** normalized `fieldMap` keys merged per webhook; PDF + future gap analysis |
| Timestamps | `created_at`, `updated_at` | Auto |

**Agreements** (`agreements.form_data`) hold per-deal fields (amounts, dates, facility fee, etc.) — detail map belongs in a separate doc when you tackle loan formulation.

---

## F. Operational tasks (existing API)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/customers/backfill-from-form-data` | Replay `agreements.form_data` into customer columns + raw JSON (fill-empty + merge) |
| `POST /api/customers/enrich-csv` | CSV import / Formitize export → match by phone/name → COALESCE columns |

---

## G. Gaps for ops to complete (optional columns)

Add rows here when you discover stable Formitize keys that should become **first-class columns** (promote from `raw_application_data`):

| New concept | Proposed DB column | Source keys seen in prod | Priority |
|-------------|--------------------|---------------------------|----------|
| *—* | | | |

---

## Code pointers

- Schema: `lib/db/src/schema/customers.ts`
- Webhook enrichment: `artifacts/api-server/src/routes/formitize.ts` (~“Extract extended customer profile” through `UPDATE customers`)
- Staff update: `artifacts/api-server/src/routes/customers.ts` (`PUT /customers/:id`, backfill route)
- JSON merge helper: `artifacts/api-server/src/lib/customerCrmMerge.ts`
