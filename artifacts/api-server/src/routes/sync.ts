import { Router } from "express";
import { db, retailersTable, branchesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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

// ─── Manual trigger route ─────────────────────────────────────────────────────

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

export default router;
