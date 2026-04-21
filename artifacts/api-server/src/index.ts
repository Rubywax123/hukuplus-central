import app from "./app";
import { runMigrations } from "./lib/migrate";
import { syncHukuPlusStores, syncRevolverStores, syncRevolverData } from "./routes/sync";
import { syncXeroInvoices } from "./lib/syncXeroInvoices";
import { autoSnapshotPreviousMonth } from "./lib/snapshotMonths";

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

const STORE_SYNC_INTERVAL_MS     = 60 * 60 * 1000; // 1 hour  — HukuPlus + Revolver store data
const XERO_SYNC_INTERVAL_MS      =  5 * 60 * 1000; // 5 minutes — Xero invoice → Loan Register
const SNAPSHOT_CHECK_INTERVAL_MS =  6 * 60 * 60 * 1000; // 6 hours — monthly snapshot rollover

async function runStoreSync() {
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

  // Step 2: push from Central into Revolver (structure)
  console.log("[sync] Starting scheduled Revolver store sync...");
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

  // Step 3: pull from Revolver into Central (customers, facilities, drawdowns)
  console.log("[sync] Starting Revolver data pull...");
  try {
    const result = await syncRevolverData();
    console.log(
      `[sync:revolver-data] Done — ` +
      `${result.customersUpserted} customers, ` +
      `${result.facilitiesUpserted} facilities, ` +
      `${result.drawdownsUpserted} drawdowns, ` +
      `${result.matched} matched to Central customers.`
    );
  } catch (err: any) {
    console.error("[sync:revolver-data] Failed:", err.message);
  }
}

async function runXeroSync() {
  console.log("[sync] Starting Xero invoice sync...");
  try {
    const result = await syncXeroInvoices();
    console.log(
      `[sync:xero-invoices] Done — ` +
      `${result.checked} checked, ` +
      `${result.pushed} pushed to Loan Register, ` +
      `${result.skipped} skipped.`
    );
    if (result.errors.length > 0) {
      console.warn("[sync:xero-invoices] Warnings:", result.errors.join("; "));
    }
  } catch (err: any) {
    console.error("[sync:xero-invoices] Failed:", err.message);
  }
}

async function runSnapshotCheck() {
  try {
    await autoSnapshotPreviousMonth();
  } catch (err: any) {
    console.error("[snapshot] Auto-snapshot check failed:", err.message);
  }
}

function startSyncScheduler() {
  // Store sync: run once on startup, then every hour
  runStoreSync();
  setInterval(runStoreSync, STORE_SYNC_INTERVAL_MS);

  // Xero invoice sync: run once on startup, then every 5 minutes
  // Short interval ensures new Xero invoices are auto-imported into the Loan Register quickly
  runXeroSync();
  setInterval(runXeroSync, XERO_SYNC_INTERVAL_MS);

  // Monthly snapshot check: run once on startup, then every 6 hours
  // Automatically locks in the previous month's totals on rollover
  runSnapshotCheck();
  setInterval(runSnapshotCheck, SNAPSHOT_CHECK_INTERVAL_MS);

  console.log("[sync] Scheduler started — stores every 60 min, Xero every 5 min, snapshot check every 6 h.");
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
