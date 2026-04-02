import { Router } from "express";
import { db, retailersTable, branchesTable, retailerMappingsTable, branchMappingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { backfillCompletedLoanPayments } from "../lib/syncXeroInvoices";
import { requireStaffAuth, requireSuperAdmin } from "../middlewares/staffAuthMiddleware";

const REVOLVER_URL = "https://credit-facility-manager.replit.app";
const CENTRAL_API_KEY = process.env.CENTRAL_API_KEY ?? "";

const router = Router();

const HUKUPLUS_API_URL = process.env.HUKUPLUS_API_URL ?? "https://loan-manager-automate.replit.app";
const HUKUPLUS_API_KEY = process.env.HUKUPLUS_API_KEY ?? "";

type HukuStore = {
  id: number;
  retailer_id: number;
  name: string;
  retailer_name: string;
  branch: string;
  email: string;
  enabled: boolean;
};

type RevolverRetailer = { id: number; name: string };
type RevolverBranch   = { id: number; name: string; retailerId: number };

// ─── Revolver HTTP helpers ────────────────────────────────────────────────────

function revolverHeaders() {
  return {
    "Authorization": `Bearer ${CENTRAL_API_KEY}`,
    "Content-Type":  "application/json",
  };
}

async function patchRevolverRetailer(revolverRetailerId: number, payload: { name?: string }) {
  const res = await fetch(`${REVOLVER_URL}/api/retailers/${revolverRetailerId}`, {
    method: "PATCH",
    headers: revolverHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 404 && res.status !== 405) {
    throw new Error(`Revolver PATCH retailer ${revolverRetailerId}: ${res.status} ${await res.text()}`);
  }
  return res.ok;
}

async function patchRevolverBranch(revolverBranchId: number, payload: { name?: string; retailerId?: number }) {
  const res = await fetch(`${REVOLVER_URL}/api/store-branches/${revolverBranchId}`, {
    method: "PATCH",
    headers: revolverHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 404 && res.status !== 405) {
    throw new Error(`Revolver PATCH branch ${revolverBranchId}: ${res.status} ${await res.text()}`);
  }
  return res.ok;
}

// ─── Exported real-time patch helpers (called from retailers route on edit) ──

export async function pushRetailerRenameToRevolver(centralRetailerId: number, newName: string) {
  if (!CENTRAL_API_KEY) return;
  const [mapping] = await db.select().from(retailerMappingsTable).where(eq(retailerMappingsTable.centralRetailerId, centralRetailerId));
  if (!mapping?.revolverRetailerId) return;
  await patchRevolverRetailer(mapping.revolverRetailerId, { name: newName }).catch(err =>
    console.warn("[sync:revolver] real-time retailer patch failed:", err.message)
  );
}

export async function pushBranchRenameToRevolver(centralBranchId: number, newName: string) {
  if (!CENTRAL_API_KEY) return;
  const [mapping] = await db.select().from(branchMappingsTable).where(eq(branchMappingsTable.centralBranchId, centralBranchId));
  if (!mapping?.revolverBranchId) return;
  await patchRevolverBranch(mapping.revolverBranchId, { name: newName }).catch(err =>
    console.warn("[sync:revolver] real-time branch patch failed:", err.message)
  );
}

// ─── HukuPlus → Central pull ─────────────────────────────────────────────────

export async function syncHukuPlusStores() {
  if (!HUKUPLUS_API_KEY) throw new Error("HUKUPLUS_API_KEY not configured");

  const response = await fetch(`${HUKUPLUS_API_URL}/api/central/stores`, {
    headers: { Authorization: `Bearer ${HUKUPLUS_API_KEY}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HukuPlus API returned ${response.status}: ${text.slice(0, 200)}`);
  }

  const stores: HukuStore[] = await response.json();

  const results = {
    retailersCreated: 0,
    branchesCreated:  0,
    branchesSkipped:  0,
    errors:           [] as string[],
    totalFromHukuPlus: stores.length,
  };

  const retailerCache: Record<string, number> = {};

  for (const store of stores) {
    const rName = (store.retailer_name ?? "").trim();
    const bName = (store.branch ?? "").trim();

    if (!rName || !bName) {
      results.errors.push(`Skipped: missing retailer or branch name on store id ${store.id}`);
      continue;
    }

    try {
      // ── Ensure Central retailer exists and mapping is stored ──
      if (!(rName in retailerCache)) {
        const [existing] = await db.select().from(retailersTable).where(eq(retailersTable.name, rName));

        let centralRetailerId: number;
        if (existing) {
          centralRetailerId = existing.id;
        } else {
          const [created] = await db.insert(retailersTable).values({ name: rName, isActive: true }).returning();
          centralRetailerId = created.id;
          results.retailersCreated++;
        }

        retailerCache[rName] = centralRetailerId;

        // Upsert retailer mapping with HukuPlus retailer_id
        await db
          .insert(retailerMappingsTable)
          .values({ centralRetailerId, hukuplusRetailerId: store.retailer_id })
          .onConflictDoUpdate({
            target: retailerMappingsTable.centralRetailerId,
            set: { hukuplusRetailerId: store.retailer_id },
          });
      }

      const centralRetailerId = retailerCache[rName];

      // ── Ensure Central branch exists and mapping is stored ──
      const existingBranches = await db.select().from(branchesTable).where(eq(branchesTable.retailerId, centralRetailerId));
      const matched = existingBranches.find(b => b.name.toLowerCase() === bName.toLowerCase());

      if (!matched) {
        const [created] = await db
          .insert(branchesTable)
          .values({ retailerId: centralRetailerId, name: bName, isActive: store.enabled ?? true })
          .returning();

        // Store mapping with HukuPlus store ID
        await db
          .insert(branchMappingsTable)
          .values({ centralBranchId: created.id, hukuplusStoreId: store.id })
          .onConflictDoUpdate({
            target: branchMappingsTable.centralBranchId,
            set: { hukuplusStoreId: store.id },
          });

        results.branchesCreated++;
      } else {
        // Update isActive if it changed; upsert mapping with HukuPlus store ID
        const hukuActive = store.enabled ?? true;
        if (matched.isActive !== hukuActive) {
          await db.update(branchesTable).set({ isActive: hukuActive }).where(eq(branchesTable.id, matched.id));
        }

        await db
          .insert(branchMappingsTable)
          .values({ centralBranchId: matched.id, hukuplusStoreId: store.id })
          .onConflictDoUpdate({
            target: branchMappingsTable.centralBranchId,
            set: { hukuplusStoreId: store.id },
          });

        results.branchesSkipped++;
      }
    } catch (err: any) {
      results.errors.push(`"${rName} / ${bName}": ${err.message}`);
    }
  }

  return results;
}

// ─── Central → Revolver push ──────────────────────────────────────────────────

export async function syncRevolverStores() {
  if (!CENTRAL_API_KEY) throw new Error("CENTRAL_API_KEY not configured");

  const headers = revolverHeaders();

  // 1. Load Central's retailers + branches + mappings
  const centralRetailers   = await db.select().from(retailersTable);
  const centralBranches    = await db.select().from(branchesTable);
  const retailerMappings   = await db.select().from(retailerMappingsTable);
  const branchMappings     = await db.select().from(branchMappingsTable);

  // Build lookup maps from Central ID → mapping row
  const retailerMappingByCentral = new Map(retailerMappings.map(m => [m.centralRetailerId, m]));
  const branchMappingByCentral   = new Map(branchMappings.map(m => [m.centralBranchId, m]));

  // 2. Load Revolver's current retailers + branches
  const [rRetailersRes, rBranchesRes] = await Promise.all([
    fetch(`${REVOLVER_URL}/api/retailers`,      { headers }),
    fetch(`${REVOLVER_URL}/api/store-branches`, { headers }),
  ]);

  if (!rRetailersRes.ok || !rBranchesRes.ok) {
    throw new Error(`Revolver API error: retailers=${rRetailersRes.status} branches=${rBranchesRes.status}`);
  }

  const revolverRetailers: RevolverRetailer[] = await rRetailersRes.json();
  const revolverBranches:  RevolverBranch[]   = await rBranchesRes.json();

  // Build name → Revolver ID lookup (for initial matching of unmapped records)
  const rRetailerByName = new Map(revolverRetailers.map(r => [r.name.toLowerCase(), r]));
  const rRetailerById   = new Map(revolverRetailers.map(r => [r.id, r]));
  const rBranchById     = new Map(revolverBranches.map(b => [b.id, b]));
  const rBranchSet      = new Set(revolverBranches.map(b => `${b.retailerId}:${b.name.toLowerCase()}`));

  const results = {
    retailersCreated: 0,
    retailersUpdated: 0,
    branchesCreated:  0,
    branchesUpdated:  0,
    branchesSkipped:  0,
    errors:           [] as string[],
  };

  // Central ID → Revolver ID (built up as we go, needed for branch resolution)
  const centralToRevolverRetailerId = new Map<number, number>();

  // 3. Process each Central retailer
  for (const cr of centralRetailers) {
    const mapping = retailerMappingByCentral.get(cr.id);

    if (mapping?.revolverRetailerId) {
      // We know the Revolver ID — check if name has drifted and patch if so
      centralToRevolverRetailerId.set(cr.id, mapping.revolverRetailerId);
      const rRecord = rRetailerById.get(mapping.revolverRetailerId);
      if (rRecord && rRecord.name !== cr.name) {
        try {
          const patched = await patchRevolverRetailer(mapping.revolverRetailerId, { name: cr.name });
          if (patched) results.retailersUpdated++;
        } catch (err: any) {
          results.errors.push(`Update retailer "${cr.name}": ${err.message}`);
        }
      }
    } else {
      // No known Revolver ID — try to match by name, or create
      const existing = rRetailerByName.get(cr.name.toLowerCase());
      if (existing) {
        // Found by name — store the mapping
        centralToRevolverRetailerId.set(cr.id, existing.id);
        await db
          .insert(retailerMappingsTable)
          .values({ centralRetailerId: cr.id, revolverRetailerId: existing.id })
          .onConflictDoUpdate({
            target: retailerMappingsTable.centralRetailerId,
            set: { revolverRetailerId: existing.id },
          });
      } else {
        // Not in Revolver yet — create it
        try {
          const res = await fetch(`${REVOLVER_URL}/api/retailers`, {
            method: "POST",
            headers,
            body: JSON.stringify({ name: cr.name }),
          });
          if (!res.ok) throw new Error(await res.text());
          const created: RevolverRetailer = await res.json();
          centralToRevolverRetailerId.set(cr.id, created.id);
          // Store mapping
          await db
            .insert(retailerMappingsTable)
            .values({ centralRetailerId: cr.id, revolverRetailerId: created.id })
            .onConflictDoUpdate({
              target: retailerMappingsTable.centralRetailerId,
              set: { revolverRetailerId: created.id },
            });
          results.retailersCreated++;
        } catch (err: any) {
          results.errors.push(`Create retailer "${cr.name}": ${err.message}`);
        }
      }
    }
  }

  // 4. Process each Central branch
  for (const cb of centralBranches) {
    if (cb.name.toLowerCase() === "main branch") {
      results.branchesSkipped++;
      continue;
    }

    const revolverRetailerId = centralToRevolverRetailerId.get(cb.retailerId);
    if (!revolverRetailerId) continue;

    const mapping = branchMappingByCentral.get(cb.id);

    if (mapping?.revolverBranchId) {
      // We know the Revolver branch ID — check if name has drifted and patch if so
      const rBranch = rBranchById.get(mapping.revolverBranchId);
      if (rBranch && rBranch.name !== cb.name) {
        try {
          const patched = await patchRevolverBranch(mapping.revolverBranchId, { name: cb.name });
          if (patched) results.branchesUpdated++;
        } catch (err: any) {
          results.errors.push(`Update branch "${cb.name}": ${err.message}`);
        }
      } else {
        results.branchesSkipped++;
      }
    } else {
      // No known Revolver branch ID — check if it exists by name
      const nameKey = `${revolverRetailerId}:${cb.name.toLowerCase()}`;
      const existingRBranch = revolverBranches.find(
        b => b.retailerId === revolverRetailerId && b.name.toLowerCase() === cb.name.toLowerCase()
      );

      if (existingRBranch) {
        // Found — store the mapping
        await db
          .insert(branchMappingsTable)
          .values({ centralBranchId: cb.id, revolverBranchId: existingRBranch.id })
          .onConflictDoUpdate({
            target: branchMappingsTable.centralBranchId,
            set: { revolverBranchId: existingRBranch.id },
          });
        results.branchesSkipped++;
      } else if (!rBranchSet.has(nameKey)) {
        // Doesn't exist — create it
        try {
          const res = await fetch(`${REVOLVER_URL}/api/store-branches`, {
            method: "POST",
            headers,
            body: JSON.stringify({ name: cb.name, retailerId: revolverRetailerId }),
          });
          if (!res.ok) throw new Error(await res.text());
          const created: RevolverBranch = await res.json();
          // Store mapping
          await db
            .insert(branchMappingsTable)
            .values({ centralBranchId: cb.id, revolverBranchId: created.id })
            .onConflictDoUpdate({
              target: branchMappingsTable.centralBranchId,
              set: { revolverBranchId: created.id },
            });
          results.branchesCreated++;
        } catch (err: any) {
          results.errors.push(`Create branch "${cb.name}": ${err.message}`);
        }
      } else {
        results.branchesSkipped++;
      }
    }
  }

  return results;
}

// ─── Manual trigger routes ────────────────────────────────────────────────────

router.post("/sync/hukuplus", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const results = await syncHukuPlusStores();
    res.json({ ok: true, ...results });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/sync/revolver", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const results = await syncRevolverStores();
    res.json({ ok: true, ...results });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// ─── POST /api/sync/backfill-loan-payments ─────────────────────────────────────
// One-time (and re-runnable) backfill: sets paymentsReceived on ALL completed
// loans in the Loan Register where paymentsReceived is currently 0.
// Safe to run multiple times — loans that already have paymentsReceived > 0 are skipped.
router.post("/sync/backfill-loan-payments", requireStaffAuth, requireSuperAdmin, async (_req, res): Promise<void> => {
  try {
    console.log("[sync] Starting completed-loan payments backfill...");
    const result = await backfillCompletedLoanPayments();
    console.log(`[sync] Backfill done — updated: ${result.updated}, skipped: ${result.skipped}, errors: ${result.errors.length}`);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[sync] Backfill failed:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
