# CRM field sync matrix (poultry trio)

Central + Loan Register + Revolver. **PayrollDeduction / ChikweretiOne excluded.**

For **customer** profile enrichment (Formitize → `customers` / `raw_application_data`), see **`crm-enhancement-plan.md`**.

Use this when implementing Hub CRM: **mapping keys**, **truth sources**, and **what code paths touch today**.

## Legend

| Symbol | Meaning |
|--------|---------|
| **→** | Source overwrites destination on automated sync/API as implemented today |
| **—** | No automated sync |
| **UI** | Editable in that app’s staff UI (subject to auth) |
| **Key** | Join is via **`retailer_mappings`** / **`branch_mappings`** (`central_*_id` ↔ `hukuplus_*` ↔ `revolver_*`) |

**Schedulers**

- LR → Central: **`syncHukuPlusStores`** (hourly in `artifacts/api-server/src/index.ts`; see `routes/sync.ts`).
- Central → Revolver: **`syncRevolverStores`** + **`pushRetailerRenameToRevolver` / `pushBranchRenameToRevolver`** on Central rename (`routes/retailers.ts`).

---

## A. Retailer-level fields

Logical entity: **one retailer organisation** (`central_retailer_id` ⇄ LR `retailers.id` ⇄ Revolver `retailers.id` when mapped).

| Field (concept) | Central `retailers` column | LR `retailers` | Revolver `retailers` | LR → Central (pull) | Central → LR | Central UI → hub DB | Revolver UI | Central → Revolver push |
|-----------------|----------------------------|----------------|----------------------|-----------------------|--------------|---------------------|-------------|-------------------------|
| Primary key | `id` | `id` | `id` | **Key** mapping | — | UI | UI | — |
| Display name | `name` | `name` | `name` | **—** (hub name not updated from LR pull for existing row) | — | **UI** | **UI** | **→** `name` on scheduled sync if mapped or name-matched; **→** immediate PATCH on Central rename (`pushRetailerRenameToRevolver`) |
| HQ / generic email | `contact_email` | *none* | `contact_email` | **—** | — | **UI** | **UI** (`PATCH`) | **—** *(not PATCHed today)* |
| HQ / generic phone | `contact_phone` | *none* | `contact_phone` | **—** | — | **UI** | **UI** (`PATCH`) | **—** |
| Address | `address` | *none* | *none on retailer row* | **—** | — | **UI** | — | — |
| Active | `is_active` | — | Revolver uses `access_enabled` (different concept) | **—** | — | **UI** | **UI** (toggle access) | **—** |
| Xero bank code | — | — | `xero_bank_account_code` | **—** | — | — | **UI** | **—** |

**Gaps**

- **`syncHukuPlusStores`** ensures Central retailer **`name`** and LR **`hukuplus_retailer_id`** mapping when processing **stores**, but **does not** ingest LR retailer **`contact_*`** because LR `retailers` has no email/phone columns.
- **Central → Revolver** push never sends **`contact_email`**, **`contact_phone`** from Hub to Revolver (Revolver **`POST`** on create sends `{ name }` only in `sync.ts`).

---

## B. Branch / store fields

Logical entity: **one branch under one retailer** (`central_branch_id` ⇄ LR `stores.id` ⇄ Revolver `store_branches.id` when mapped).

| Field (concept) | Central `branches` column | LR `stores` | Revolver `store_branches` | LR → Central pull | Central → LR | Central UI | Revolver UI | Central → Revolver push |
|-----------------|---------------------------|-------------|---------------------------|-------------------|--------------|-----------|-------------|-------------------------|
| Primary key | `id` | `id` | `id` | **Key** | — | via parent CRUD | UI | — |
| Parent retailer FK | `retailer_id` | `retailer_id` | `retailer_id` | implied by sync | — | UI | UI | PATCH `retailerId` only when repositioning logic runs (scheduled sync); **`pushBranchRenameToRevolver` sends `name` only** |
| Display name | `name` | `name`; also `branch` text on LR store | `name` | **—** for name drift from LR *(pull does not PATCH Central `name` for existing matched branch unless you add logic)* — see note | — | **UI** | **UI** | **→** **`name`** on sync if differs; immediate rename on Hub branch rename |
| Branch email (**critical**) | `email` | `email` *(required NOT NULL in LR schema)* | `email` | **→** on pull: INSERT sets email; UPDATE sets email **if** LR `store.email` truthy AND differs *(does not clear Central if LR blanks email)* | **— today** *(no Hub→LR PATCH for stores)* | **UI** | **UI** | **— today** *(not PATCHed despite Revolver supporting `email`)* |
| Branch phone (**critical**) | `contact_phone` | *no column on `stores`* | *no column on `store_branches`* | **—** | — | **UI** | — | — |
| Location / address | `location` | *no direct column* Revolver-only address | `address` | **—** | — | **UI** | UI | — |
| Active / portal enable | `is_active` | `enabled` | `access_enabled` | **→** `is_active` from `stores.enabled` on pull | — | **UI** | toggle-access UI | — |

**Note (LR → Central branch name)**

- Matching uses **branch `name`** under **`centralRetailerId`**: case-insensitive equality (`sync.ts`).
- Existing Central branch **`name`** is **not** updated from LR `stores.name`/`branch` in the shown loop—only **`is_active`** and **`email`** (conditionally). Align with product intent before changing.

**Structural reconciliation**

- Unmapped Revolver branch: matched by **`(revolver retailer id, lowercase branch name)`**; unmapped retailer: **`lowercase`** name (**collision risk across chains—fix with mapping hygiene**).

---

## C. Extension officer / sales rep (FYI—not wired across Hub)

| System | Storage |
|--------|---------|
| **Central** | `customers.extension_officer`, `customers.sales_rep_name` (**text**) + agronomists in `portal_users` |
| **Revolver** | `extension_officers`, `sales_reps` tables + **`customers`** FK ids |
| **LR** | Customer/loan attribution via textual **`retailer`** / **`office_branch`** fields on loans |

**Implement later:** shared **`central_person_id`** or explicit sync rules—not part of retailer/branch sync today.

---

## D. Implementation checklist (suggested order)

1. Export + verify **`retailer_mappings`** and **`branch_mappings`**: full coverage for every live LR store / Revolver branch you care about; fix name-only merges.
2. Decide **hub SoT rules** per column (especially **branch email**, **branch phone**).
3. Add **minimal safe sync** from Central **`branches`** to Revolver **`store_branches`** for **`email`** (and **`address`** if hub stores it) guarded by **`revolver_branch_id`** mapping—after conflict policy.
4. If LR remains canonical for **`stores.email`**, add explicit **Central → LR `PATCH`/internal API** push or document **Central as read-mostly projection** only.
5. Extend **revision log** (`updated_at` / activity) for retailer/branch/contact changes once writes multiply.
