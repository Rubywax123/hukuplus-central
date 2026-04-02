import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader, GlassCard, Badge } from "@/components/ui-extras";
import {
  RefreshCw, Loader2, XCircle, CheckCircle2, Clock, RotateCcw,
  ExternalLink, BookOpen, AlertTriangle, EyeOff, Eye,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type LoanEntry = {
  id: number;
  customer_name: string;
  customer_phone: string | null;
  loan_product: string;
  loan_amount: string | number;
  facility_fee_amount: string | null;
  interest_amount: string | null;
  repayment_amount: string | null;
  status: string;
  source: string;
  dismissed: boolean;
  xero_invoice_id: string | null;
  disbursement_date: string | null;
  repayment_date: string | null;
  branch_name: string | null;
  retailer_name: string | null;
  created_at: string;
};

type SyncStatus = {
  lastSync: string | null;
  totalSynced: number;
  activeSynced: number;
};

const fmt = (v: string | number | null | undefined) =>
  v != null ? parseFloat(String(v)).toLocaleString("en-ZW", { minimumFractionDigits: 2 }) : "—";

const statusConfig: Record<string, { label: string; badge: "success" | "warning" | "neutral" | "danger" }> = {
  active:    { label: "Active",     badge: "success" },
  completed: { label: "Completed",  badge: "neutral" },
  pending:   { label: "Pending",    badge: "warning" },
  expired:   { label: "Expired",    badge: "danger"  },
};

export default function LoanRegisterPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "completed" | "dismissed">("active");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ created: number; errors: string[] } | null>(null);
  const [search, setSearch] = useState("");

  const { data: entries = [], isLoading } = useQuery<LoanEntry[]>({
    queryKey: ["/api/loan-register"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/loan-register`);
      if (!r.ok) throw new Error("Failed to load Loan Register");
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ["/api/xero/sync-invoices/status"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/xero/sync-invoices/status`);
      if (!r.ok) return { lastSync: null, totalSynced: 0, activeSynced: 0 };
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ id, dismissed }: { id: number; dismissed: boolean }) => {
      const r = await fetch(`${BASE}/api/agreements/${id}/dismiss`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed }),
      });
      if (!r.ok) throw new Error("Failed to update");
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/loan-register"] }),
  });

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await fetch(`${BASE}/api/xero/sync-invoices`, { method: "POST" });
      const data = await r.json();
      setSyncResult({ created: data.created ?? 0, errors: data.errors ?? [] });
      qc.invalidateQueries({ queryKey: ["/api/loan-register"] });
      qc.invalidateQueries({ queryKey: ["/api/xero/sync-invoices/status"] });
    } catch {
      setSyncResult({ created: 0, errors: ["Sync request failed — check Xero connection."] });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = entries.filter((e) => {
    if (tab === "active")    return !e.dismissed && e.status !== "completed";
    if (tab === "completed") return !e.dismissed && e.status === "completed";
    if (tab === "dismissed") return e.dismissed;
    return true;
  }).filter((e) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      e.customer_name.toLowerCase().includes(s) ||
      (e.branch_name ?? "").toLowerCase().includes(s) ||
      (e.customer_phone ?? "").includes(s)
    );
  });

  const counts = {
    active:    entries.filter((e) => !e.dismissed && e.status !== "completed").length,
    completed: entries.filter((e) => !e.dismissed && e.status === "completed").length,
    dismissed: entries.filter((e) => e.dismissed).length,
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="HukuPlus Loan Register"
        description="All HukuPlus loan agreements — pulled from Formitize and Xero. Approved invoices sync automatically every hour."
      />

      {/* ── Sync controls ────────────────────────────────────────────────── */}
      <GlassCard className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 text-sm text-muted-foreground">
          {syncStatus?.lastSync ? (
            <>
              Last synced from Xero{" "}
              <span className="text-foreground font-medium">
                {formatDistanceToNow(new Date(syncStatus.lastSync), { addSuffix: true })}
              </span>
              {" "}· {syncStatus.totalSynced} invoice{syncStatus.totalSynced !== 1 ? "s" : ""} pulled in total
            </>
          ) : (
            "No Xero sync has run yet — click Sync Now to pull approved loan invoices."
          )}
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncing ? "Syncing…" : "Sync from Xero Now"}
        </button>

        {syncResult && (
          <div className={`text-xs rounded-lg px-3 py-1.5 ${syncResult.errors.length ? "bg-red-500/10 text-red-300" : "bg-emerald-500/10 text-emerald-300"}`}>
            {syncResult.errors.length
              ? syncResult.errors[0]
              : syncResult.created > 0
                ? `✓ ${syncResult.created} new loan${syncResult.created !== 1 ? "s" : ""} added`
                : "✓ Already up to date"}
          </div>
        )}
      </GlassCard>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {(["active", "completed", "dismissed"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all border ${
              tab === t
                ? "bg-white/10 border-white/20 text-white"
                : "bg-transparent border-white/5 text-muted-foreground hover:text-foreground hover:bg-white/5"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            <span className="ml-2 text-xs opacity-70">{counts[t]}</span>
          </button>
        ))}

        <div className="flex-1" />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or branch…"
          className="px-3 py-2 text-sm rounded-xl bg-white/5 border border-white/10 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-white/20 w-56"
        />
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <GlassCard className="overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading loan register…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <BookOpen className="w-8 h-8 opacity-40" />
            <p className="text-sm">
              {tab === "active"
                ? "No active HukuPlus loans. Click \"Sync from Xero Now\" to pull approved invoices."
                : tab === "dismissed"
                  ? "No dismissed entries."
                  : "No completed loans yet."}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left font-medium">Customer</th>
                <th className="px-4 py-3 text-left font-medium">Branch</th>
                <th className="px-4 py-3 text-right font-medium">Loan</th>
                <th className="px-4 py-3 text-right font-medium">Fee</th>
                <th className="px-4 py-3 text-right font-medium">Interest</th>
                <th className="px-4 py-3 text-right font-medium">Total Due</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-left font-medium">Source</th>
                <th className="px-4 py-3 text-left font-medium">Date</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const cfg = statusConfig[e.status] ?? { label: e.status, badge: "neutral" as const };
                return (
                  <tr
                    key={e.id}
                    className={`border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors ${e.dismissed ? "opacity-50" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{e.customer_name}</div>
                      {e.customer_phone && (
                        <div className="text-xs text-muted-foreground">{e.customer_phone}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {e.branch_name ?? e.retailer_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-foreground">
                      ${fmt(e.loan_amount)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {e.facility_fee_amount ? `$${fmt(e.facility_fee_amount)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {e.interest_amount ? `$${fmt(e.interest_amount)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-foreground font-medium">
                      {e.repayment_amount ? `$${fmt(e.repayment_amount)}` : `$${fmt(e.loan_amount)}`}
                    </td>
                    <td className="px-4 py-3">
                      <Badge status={cfg.badge}>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {e.source === "xero_sync" ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/20">
                          <ExternalLink className="w-3 h-3" />
                          Xero
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Formitize</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {e.disbursement_date
                        ? format(new Date(e.disbursement_date), "dd MMM yy")
                        : format(new Date(e.created_at), "dd MMM yy")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {e.dismissed ? (
                        <button
                          onClick={() => dismissMutation.mutate({ id: e.id, dismissed: false })}
                          disabled={dismissMutation.isPending}
                          title="Restore"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-muted-foreground hover:text-emerald-300 transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          Restore
                        </button>
                      ) : (
                        <button
                          onClick={() => dismissMutation.mutate({ id: e.id, dismissed: true })}
                          disabled={dismissMutation.isPending}
                          title="Dismiss — hide without affecting Xero data"
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-white/5 hover:bg-red-500/10 border border-white/10 text-muted-foreground hover:text-red-300 transition-colors"
                        >
                          <EyeOff className="w-3 h-3" />
                          Dismiss
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-white/5 text-xs text-muted-foreground">
            Showing {filtered.length} of {entries.length} entries
            {tab === "dismissed" && (
              <span className="ml-2 text-amber-400/70">
                · Dismissed entries are hidden from the Active view — Xero data is unaffected
              </span>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
