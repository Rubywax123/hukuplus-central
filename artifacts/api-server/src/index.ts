import app from "./app";
import { runMigrations } from "./lib/migrate";
import { syncHukuPlusStores, syncRevolverStores } from "./routes/sync";
import { syncXeroInvoices } from "./lib/syncXeroInvoices";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function startSyncScheduler() {
  const run = async () => {
    // Step 1: pull from HukuPlus into Central
    console.log("[sync] Starting scheduled HukuPlus sync...");
    try {
      const result = await syncHukuPlusStores();
      console.log(
        `[sync:hukuplus] Done — ${result.totalFromHukuPlus} stores checked, ` +
        `${result.retailersCreated} retailers created, ` +
        `${result.branchesCreated} branches added, ` +
        `${result.branchesSkipped} skipped.`
      );
    } catch (err: any) {
      console.error("[sync:hukuplus] Failed:", err.message);
    }

    // Step 2: push from Central into Revolver
    console.log("[sync] Starting scheduled Revolver sync...");
    try {
      const result = await syncRevolverStores();
      console.log(
        `[sync:revolver] Done — ` +
        `${result.retailersCreated} retailers created, ` +
        `${result.branchesCreated} branches pushed, ` +
        `${result.branchesSkipped} skipped.`
      );
    } catch (err: any) {
      console.error("[sync:revolver] Failed:", err.message);
    }

    // Step 3: pull Xero AUTHORISED loan invoices into Loan Register
    console.log("[sync] Starting scheduled Xero invoice sync...");
    try {
      const result = await syncXeroInvoices();
      console.log(
        `[sync:xero-invoices] Done — ` +
        `${result.checked} checked, ` +
        `${result.created} created, ` +
        `${result.skipped} skipped.`
      );
      if (result.errors.length > 0) {
        console.warn("[sync:xero-invoices] Warnings:", result.errors.join("; "));
      }
    } catch (err: any) {
      console.error("[sync:xero-invoices] Failed:", err.message);
    }
  };

  // Run immediately on startup, then every hour
  run();
  setInterval(run, SYNC_INTERVAL_MS);
  console.log("[sync] Scheduler started — syncing every 60 minutes.");
}

runMigrations()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
      startSyncScheduler();
    });
  })
  .catch((err) => {
    console.error("[migrate] Fatal migration error:", err);
    process.exit(1);
  });
