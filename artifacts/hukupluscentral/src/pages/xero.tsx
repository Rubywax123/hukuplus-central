import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import {
  RefreshCw, CheckCircle2, Clock, AlertCircle, Zap,
  ExternalLink, ChevronRight, Info, Wifi, WifiOff, ArrowRightLeft,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface XeroStatus {
  connected: boolean;
  tenantName?: string;
  expiresAt?: string;
}

interface SyncStatus {
  lastSync: string | null;
  totalSynced: number;
  activeSynced: number;
}

interface SyncResult {
  success: boolean;
  checked: number;
  pushed: number;
  skipped: number;
  errors: string[];
}

interface PendingInvoice {
  invoiceId: string;
  invoiceNumber: string;
  contactName: string;
  date: string;
  dueDate: string;
  total: number;
  amountDue: number;
  xeroStatus: string;
  imported: boolean;
  lrStatus: string | null;
  tracking: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  if (!d) return "—";
  try { return format(parseISO(d.split("T")[0]), "d MMM yyyy"); } catch { return d; }
}

function fmtCurrency(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatusBadge({ imported, lrStatus }: { imported: boolean; lrStatus: string | null }) {
  if (imported) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" /> Imported
        {lrStatus && <span className="opacity-60">· {lrStatus}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/20">
      <Clock className="w-3 h-3" /> Pending
    </span>
  );
}

function XeroStatusBadge({ status }: { status: string }) {
  const colours: Record<string, string> = {
    AUTHORISED: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    PARTIAL: "text-violet-400 bg-violet-500/10 border-violet-500/20",
    PAID: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  };
  const cls = colours[status] ?? "text-muted-foreground bg-white/5 border-white/10";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cls}`}>
      {status}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function XeroIntegrationPage() {
  const qc = useQueryClient();
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const { data: xeroStatus, isLoading: statusLoading } = useQuery<XeroStatus>({
    queryKey: ["/api/xero/status"],
    queryFn: () => customFetch<XeroStatus>("/api/xero/status"),
    refetchInterval: 60_000,
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["/api/xero/sync-invoices/status"],
    queryFn: () => customFetch<SyncStatus>("/api/xero/sync-invoices/status"),
    refetchInterval: 30_000,
    enabled: xeroStatus?.connected,
  });

  const {
    data: invoices,
    isLoading: invoicesLoading,
    refetch: refetchInvoices,
  } = useQuery<PendingInvoice[]>({
    queryKey: ["/api/xero/pending-invoices"],
    queryFn: () => customFetch<PendingInvoice[]>("/api/xero/pending-invoices"),
    enabled: xeroStatus?.connected,
    staleTime: 60_000,
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      customFetch<SyncResult>("/api/xero/sync-invoices", { method: "POST" }),
    onSuccess: (data) => {
      setSyncResult(data);
      setSyncError(null);
      qc.invalidateQueries({ queryKey: ["/api/xero/sync-invoices/status"] });
      refetchInvoices();
    },
    onError: (err: any) => {
      setSyncError(err.message ?? "Sync failed");
    },
  });

  // "Pending" = needs to be pushed to the Loan Register — only AUTHORISED/PARTIAL
  // PAID+not-imported are historical invoices that predate Central; no action needed, so excluded.
  const pendingInvoices = invoices?.filter((i) => !i.imported && i.xeroStatus !== "PAID") ?? [];
  const importedInvoices = invoices?.filter((i) => i.imported) ?? [];

  if (statusLoading) {
    return <div className="h-96 flex items-center justify-center animate-pulse text-primary">Loading Xero integration...</div>;
  }

  return (
    <div className="pb-10">
      <PageHeader
        title="Xero Integration"
        description="Manage the connection between Xero invoices and the Loan Register."
      />

      {/* ── Connection status ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <GlassCard className="p-6 relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Connection</p>
              {xeroStatus?.connected
                ? <Wifi className="w-4 h-4 text-emerald-400" />
                : <WifiOff className="w-4 h-4 text-rose-400" />}
            </div>
            {xeroStatus?.connected ? (
              <>
                <p className="text-lg font-bold text-white">{xeroStatus.tenantName ?? "Tefco Finance"}</p>
                <p className="text-xs text-emerald-400 mt-1 font-medium">Connected · token auto-refreshes</p>
                <a
                  href={`${BASE}/api/xero/auth`}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-white transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Reconnect
                </a>
              </>
            ) : (
              <>
                <p className="text-base font-semibold text-rose-400">Not Connected</p>
                <p className="text-xs text-muted-foreground mt-1">Xero OAuth token missing or expired.</p>
                <a
                  href={`${BASE}/api/xero/auth`}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-[#13b5ea]/10 hover:bg-[#13b5ea]/20 text-[#13b5ea] border border-[#13b5ea]/30 rounded-lg text-sm font-semibold transition-all"
                >
                  Connect Xero <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </>
            )}
          </GlassCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10 }}>
          <GlassCard className="p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Last Auto-Sync</p>
            <p className="text-lg font-bold text-white">
              {syncStatus?.lastSync
                ? format(new Date(syncStatus.lastSync), "d MMM, h:mm a")
                : "Never"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">Runs automatically every 5 minutes</p>
            <p className="text-xs text-sky-400 mt-3 font-medium">
              {syncStatus?.activeSynced ?? 0} active · {syncStatus?.totalSynced ?? 0} total synced
            </p>
          </GlassCard>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <GlassCard className="p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Invoice Status</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Pending push</span>
                <span className="text-amber-400 font-bold text-lg">{invoicesLoading ? "…" : pendingInvoices.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Imported (30 days)</span>
                <span className="text-emerald-400 font-bold text-lg">{invoicesLoading ? "…" : importedInvoices.length}</span>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      </div>

      {/* ── Sync Now button + result ── */}
      {xeroStatus?.connected && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.20 }} className="mb-8">
          <div className="flex items-center gap-4 flex-wrap">
            <button
              onClick={() => { setSyncResult(null); setSyncError(null); syncMutation.mutate(); }}
              disabled={syncMutation.isPending}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl font-semibold text-sm transition-all disabled:opacity-50 shadow-lg shadow-primary/20"
            >
              {syncMutation.isPending
                ? <><RefreshCw className="w-4 h-4 animate-spin" /> Syncing…</>
                : <><Zap className="w-4 h-4" /> Sync Now</>}
            </button>
            <p className="text-xs text-muted-foreground">
              Fetches all AUTHORISED/PARTIAL invoices from Xero and pushes any new ones to the Loan Register automatically.
            </p>
          </div>

          {syncResult && (
            <div className={`mt-4 p-4 rounded-xl border text-sm ${
              syncResult.errors.length > 0
                ? "bg-amber-500/10 border-amber-500/20 text-amber-300"
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
            }`}>
              <div className="flex items-start gap-2">
                {syncResult.errors.length > 0
                  ? <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
                <div>
                  <p className="font-semibold">
                    Sync complete — {syncResult.checked} checked, {syncResult.pushed} pushed to Loan Register, {syncResult.skipped} skipped
                  </p>
                  {syncResult.errors.map((e, i) => <p key={i} className="text-xs opacity-80 mt-1">{e}</p>)}
                </div>
              </div>
            </div>
          )}
          {syncError && (
            <div className="mt-4 p-4 rounded-xl border bg-rose-500/10 border-rose-500/20 text-rose-300 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" /> {syncError}
            </div>
          )}
        </motion.div>
      )}

      {/* ── Invoice table ── */}
      {xeroStatus?.connected && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Invoices · Last 30 Days
            </h2>
            <button
              onClick={() => refetchInvoices()}
              className="p-1.5 rounded-lg hover:bg-white/5 text-muted-foreground hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {invoicesLoading ? (
            <GlassCard className="p-8 text-center text-muted-foreground animate-pulse">Loading invoices from Xero…</GlassCard>
          ) : !invoices || invoices.length === 0 ? (
            <GlassCard className="p-8 text-center text-muted-foreground">
              No invoices found in the last 30 days.
            </GlassCard>
          ) : (
            <GlassCard className="overflow-hidden">
              {/* Pending first, then imported */}
              {[...pendingInvoices, ...importedInvoices].map((inv, idx) => (
                <div
                  key={inv.invoiceId}
                  className={`flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/3 ${
                    idx > 0 ? "border-t border-white/5" : ""
                  } ${!inv.imported ? "bg-amber-500/3" : ""}`}
                >
                  {/* Invoice number + contact */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-mono text-sm font-bold text-white">{inv.invoiceNumber}</span>
                      <XeroStatusBadge status={inv.xeroStatus} />
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{inv.contactName}</p>
                    {inv.tracking && (
                      <p className="text-[11px] text-muted-foreground/50 mt-0.5">{inv.tracking}</p>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="hidden md:block text-right shrink-0">
                    <p className="text-xs text-white">{fmtDate(inv.date)}</p>
                    <p className="text-[11px] text-muted-foreground">due {fmtDate(inv.dueDate)}</p>
                  </div>

                  {/* Amount */}
                  <div className="text-right shrink-0 w-24">
                    <p className="text-sm font-semibold text-white">{fmtCurrency(inv.total)}</p>
                    {inv.amountDue !== inv.total && (
                      <p className="text-[11px] text-muted-foreground">{fmtCurrency(inv.amountDue)} due</p>
                    )}
                  </div>

                  {/* Status badge */}
                  <div className="shrink-0">
                    <StatusBadge imported={inv.imported} lrStatus={inv.lrStatus} />
                  </div>
                </div>
              ))}
            </GlassCard>
          )}

          {/* Info callout */}
          <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground/60 px-1">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p>
              Only <strong className="text-muted-foreground/80">AUTHORISED</strong> and <strong className="text-muted-foreground/80">PARTIAL</strong> invoices are pushed to the Loan Register.
              PAID invoices require no action and are not shown. "Sync Now" processes all pending invoices in one pass; the automated sync also runs every 5 minutes.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Not connected message ── */}
      {!xeroStatus?.connected && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }}>
          <GlassCard className="p-10 text-center">
            <ArrowRightLeft className="w-10 h-10 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Xero not connected</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
              Connect your Xero account to enable automated invoice syncing to the Loan Register.
            </p>
            <a
              href={`${BASE}/api/xero/auth`}
              className="inline-flex items-center gap-2 px-6 py-3 bg-[#13b5ea]/10 hover:bg-[#13b5ea]/20 text-[#13b5ea] border border-[#13b5ea]/30 rounded-xl text-sm font-semibold transition-all"
            >
              Connect Xero <ExternalLink className="w-4 h-4" />
            </a>
          </GlassCard>
        </motion.div>
      )}
    </div>
  );
}
