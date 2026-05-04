# CRM enhancement plan (Central)

Complements **`docs/crm-field-sync-matrix.md`** (retailer / branch / LR / Revolver).

**Detailed customer column ↔ Formitize mapping:** **`docs/crm-customer-field-map.md`**.

This file covers **process** for customer depth and Formitize-driven profile enrichment.

## Principles

1. **Formitize remains the live intake** until you retire it; Central **enriches**, does not break webhooks.
2. **Typed columns** use **COALESCE** on update (fill empty only)—already the pattern in `formitize` webhook for existing customers.
3. **`raw_application_data`** holds the **full flat field map** from webhooks for gap analysis and PDFs; keys should **accumulate** across submissions (see implementation in `customerCrmMerge.ts` + `routes/formitize.ts`).

## Done (initial slice)

- **`mergeFlatFieldMaps`** — shallow merge helper for JSON field maps (`artifacts/api-server/src/lib/customerCrmMerge.ts`).
- **Webhook fix** — `raw_application_data` now merges with `COALESCE(existing, '{}') || incoming` so later Formitize submissions add/override keys instead of being ignored when JSON already exists.
- **Empty-column path** — when there are no sparse column updates but `fieldMap` is non-empty, still merge into `raw_application_data`.

## Next (phased)

| Phase | Task |
|-------|------|
| A | Ops-owned **customer field map** spreadsheet: Formitize label / internal id → Central `customers` column vs `raw_application_data` only. |
| B | Optional **admin trigger** to re-run enrichment from stored `raw_application_data` (repair job). |
| C | **Bulk backfill** from Formitize API with dry-run counts (separate feature flag / superAdmin only). |
| D | **Key frequency report** on `raw_application_data` → drives new columns vs JSON-only. |
| E | **Staff UI** completeness / source job link (after data stable). |

## Loan agreements

Defer automated in-Hub agreement drafting until customer CRM merge policy and field map (A) are agreed; see prior discussion on `novafeed-pdf` + `agreements.formData`.
