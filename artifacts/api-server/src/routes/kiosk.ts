import { Router } from "express";
import { db, agreementsTable, branchesTable, retailersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";

const router = Router();

/**
 * GET /api/kiosk/:branchId
 *
 * Public endpoint — no auth required.
 * Returns the most recent PENDING agreement for a branch,
 * plus branch + retailer info for the kiosk display.
 */
router.get("/kiosk/:branchId", async (req, res): Promise<void> => {
  const branchId = parseInt(req.params.branchId, 10);
  if (isNaN(branchId)) {
    res.status(400).json({ error: "Invalid branch ID" });
    return;
  }

  const [branch] = await db
    .select({
      id: branchesTable.id,
      name: branchesTable.name,
      retailerId: branchesTable.retailerId,
    })
    .from(branchesTable)
    .where(eq(branchesTable.id, branchId));

  if (!branch) {
    res.status(404).json({ error: "Branch not found" });
    return;
  }

  const [retailer] = await db
    .select({ id: retailersTable.id, name: retailersTable.name })
    .from(retailersTable)
    .where(eq(retailersTable.id, branch.retailerId));

  // Ringfence: kiosk is exclusively for Novafeeds branches
  if (!retailer || !retailer.name.toLowerCase().includes("novafeed")) {
    res.status(403).json({ error: "Kiosk access is restricted to Novafeeds branches." });
    return;
  }

  // Get the most recent pending agreement for this branch
  const [agreement] = await db
    .select()
    .from(agreementsTable)
    .where(
      and(
        eq(agreementsTable.branchId, branchId),
        eq(agreementsTable.status, "pending")
      )
    )
    .orderBy(desc(agreementsTable.createdAt))
    .limit(1);

  const appUrl = process.env.APP_URL || "https://huku-plus-central.replit.app";

  res.json({
    branch: {
      id: branch.id,
      name: branch.name,
      retailerName: retailer?.name ?? "",
    },
    agreement: agreement
      ? {
          id: agreement.id,
          customerName: agreement.customerName,
          loanAmount: agreement.loanAmount,
          loanProduct: agreement.loanProduct,
          signingUrl: `${appUrl}/sign/${agreement.signingToken}`,
          formitizeFormUrl: agreement.formitizeFormUrl,
          createdAt: agreement.createdAt,
        }
      : null,
  });
});

/**
 * GET /api/branches-with-kiosk
 *
 * Staff-only: returns all branches with their kiosk URLs.
 * Used by the retailers page to show kiosk links.
 */
router.get("/branches-with-kiosk", async (req, res): Promise<void> => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const appUrl = process.env.APP_URL || "https://huku-plus-central.replit.app";

  const branches = await db
    .select({
      id: branchesTable.id,
      name: branchesTable.name,
      retailerId: branchesTable.retailerId,
    })
    .from(branchesTable);

  res.json(
    branches.map((b) => ({
      ...b,
      kioskUrl: `${appUrl}/kiosk/${b.id}`,
    }))
  );
});

export default router;
