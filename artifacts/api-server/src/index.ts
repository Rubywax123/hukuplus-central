import app from "./app";
import { runMigrations } from "./lib/migrate";
import { syncHukuPlusStores } from "./routes/sync";

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
    console.log("[sync] Starting scheduled HukuPlus sync...");
    try {
      const result = await syncHukuPlusStores();
      console.log(
        `[sync] Done — ${result.totalFromHukuPlus} stores checked, ` +
        `${result.retailersCreated} retailers created, ` +
        `${result.branchesCreated} branches added, ` +
        `${result.branchesSkipped} skipped.`
      );
    } catch (err: any) {
      console.error("[sync] Scheduled sync failed:", err.message);
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
