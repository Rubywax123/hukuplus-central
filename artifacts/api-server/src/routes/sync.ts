import { Router } from "express";
import { db, retailersTable, branchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// ─── Core sync logic (used by both the route and the scheduler) ───────────────

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
    branchesCreated: 0,
    branchesSkipped: 0,
    errors: [] as string[],
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
      if (!(rName in retailerCache)) {
        const [existing] = await db
          .select()
          .from(retailersTable)
          .where(eq(retailersTable.name, rName));

        if (existing) {
          retailerCache[rName] = existing.id;
        } else {
          const [created] = await db
            .insert(retailersTable)
            .values({ name: rName, isActive: true })
            .returning();
          retailerCache[rName] = created.id;
          results.retailersCreated++;
        }
      }

      const retailerId = retailerCache[rName];

      const existingBranches = await db
        .select()
        .from(branchesTable)
        .where(eq(branchesTable.retailerId, retailerId));

      const branchExists = existingBranches.some(
        b => b.name.toLowerCase() === bName.toLowerCase()
      );

      if (!branchExists) {
        await db.insert(branchesTable).values({ retailerId, name: bName, isActive: true });
        results.branchesCreated++;
      } else {
        results.branchesSkipped++;
      }
    } catch (err: any) {
      results.errors.push(`"${rName} / ${bName}": ${err.message}`);
    }
  }

  return results;
}

// ─── Revolver sync: push Central stores → Revolver ───────────────────────────

type RevolverRetailer = { id: number; name: string };
type RevolverBranch   = { id: number; name: string; retailerId: number };

export async function syncRevolverStores() {
  if (!CENTRAL_API_KEY) throw new Error("CENTRAL_API_KEY not configured");

  const headers = {
    "Authorization": `Bearer ${CENTRAL_API_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. Load Central's retailers + branches
  const centralRetailers = await db.select().from(retailersTable);
  const centralBranches  = await db.select().from(branchesTable);

  // 2. Load Revolver's current retailers + branches
  const [rRetailersRes, rBranchesRes] = await Promise.all([
    fetch(`${REVOLVER_URL}/api/retailers`,     { headers }),
    fetch(`${REVOLVER_URL}/api/store-branches`, { headers }),
  ]);

  if (!rRetailersRes.ok || !rBranchesRes.ok) {
    throw new Error(`Revolver API error: retailers=${rRetailersRes.status} branches=${rBranchesRes.status}`);
  }

  const revolverRetailers: RevolverRetailer[] = await rRetailersRes.json();
  const revolverBranches:  RevolverBranch[]   = await rBranchesRes.json();

  const results = {
    retailersCreated: 0,
    branchesCreated:  0,
    branchesSkipped:  0,
    errors: [] as string[],
  };

  // 3. Build name → Revolver retailer ID map; create missing retailers
  const nameToRevolverId: Record<string, number> = {};
  for (const rr of revolverRetailers) {
    nameToRevolverId[rr.name.toLowerCase()] = rr.id;
  }

  for (const cr of centralRetailers) {
    const key = cr.name.toLowerCase();
    if (!(key in nameToRevolverId)) {
      try {
        const res = await fetch(`${REVOLVER_URL}/api/retailers`, {
          method: "POST",
          headers,
          body: JSON.stringify({ name: cr.name }),
        });
        if (!res.ok) throw new Error(await res.text());
        const created: RevolverRetailer = await res.json();
        nameToRevolverId[key] = created.id;
        results.retailersCreated++;
      } catch (err: any) {
        results.errors.push(`Retailer "${cr.name}": ${err.message}`);
      }
    }
  }

  // 4. Build set of existing Revolver branches: "retailerId:branchName"
  const existingBranches = new Set(
    revolverBranches.map(b => `${b.retailerId}:${b.name.toLowerCase()}`)
  );

  // 5. Build Central retailer ID → name map
  const centralIdToName: Record<number, string> = {};
  for (const cr of centralRetailers) {
    centralIdToName[cr.id] = cr.name;
  }

  // 6. Push missing branches (skip "Main Branch" placeholder)
  for (const cb of centralBranches) {
    if (cb.name.toLowerCase() === "main branch") {
      results.branchesSkipped++;
      continue;
    }

    const retailerName = centralIdToName[cb.retailerId];
    if (!retailerName) continue;

    const revolverRetailerId = nameToRevolverId[retailerName.toLowerCase()];
    if (!revolverRetailerId) continue;

    const key = `${revolverRetailerId}:${cb.name.toLowerCase()}`;
    if (existingBranches.has(key)) {
      results.branchesSkipped++;
      continue;
    }

    try {
      const res = await fetch(`${REVOLVER_URL}/api/store-branches`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: cb.name, retailerId: revolverRetailerId }),
      });
      if (!res.ok) throw new Error(await res.text());
      results.branchesCreated++;
    } catch (err: any) {
      results.errors.push(`Branch "${retailerName}/${cb.name}": ${err.message}`);
    }
  }

  return results;
}

// ─── Manual trigger routes ────────────────────────────────────────────────────

router.post("/sync/hukuplus", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const results = await syncHukuPlusStores();
    res.json({ ok: true, ...results });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

router.post("/sync/revolver", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const results = await syncRevolverStores();
    res.json({ ok: true, ...results });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
