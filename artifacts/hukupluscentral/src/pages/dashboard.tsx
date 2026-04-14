import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetDashboardStats, useGetRecentActivity, customFetch } from "@workspace/api-client-react";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import { Store, MapPin, CheckCircle, Clock, UserPlus, RefreshCw, FileCheck, Wifi, X, AlertTriangle, Building2, Phone, Trash2, TrendingUp } from "lucide-react";
import { format } from "date-fns";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend,
} from "recharts";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthlyMetrics {
  month: string;
  newApplications: { current: number; previous: number };
  reApplications: { current: number; previous: number };
  agreementsIssued: { current: number; previous: number };
}

interface MonthSnapshot {
  month: string;
  monthLabel: string;
  newApplications: number;
  reApplications: number;
  agreementsIssued: number;
  isLive: boolean;
}

interface ApplicationRow {
  formitize_job_id: string | null;
  form_name: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_id: number | null;
  branch_name: string | null;
  retailer_name: string | null;
  is_duplicate_warning: boolean;
  created_at: string;
}

interface ApplicationsDetail {
  total: number;
  rows: ApplicationRow[];
  duplicateCustomers: string[];
}

interface LeadsMonthlyStats {
  thisMonth: { leads: number; conversions: number };
  lastMonth: { leads: number; conversions: number };
}

// ─── Data hooks ───────────────────────────────────────────────────────────────

function useMonthlyMetrics() {
  return useQuery<MonthlyMetrics>({
    queryKey: ["/api/dashboard/monthly-metrics"],
    queryFn: () => customFetch<MonthlyMetrics>("/api/dashboard/monthly-metrics"),
    refetchInterval: 5 * 60 * 1000,
  });
}

function useMonthlyHistory() {
  return useQuery<MonthSnapshot[]>({
    queryKey: ["/api/dashboard/monthly-history"],
    queryFn: () => customFetch<MonthSnapshot[]>("/api/dashboard/monthly-history"),
    refetchInterval: 10 * 60 * 1000,
  });
}

function useLeadsMonthlyStats() {
  const BASE = (import.meta as any).env.BASE_URL.replace(/\/$/, "");
  return useQuery<LeadsMonthlyStats>({
    queryKey: ["leads-monthly-stats"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/leads/monthly-stats`, { credentials: "include" });
      if (!r.ok) return { thisMonth: { leads: 0, conversions: 0 }, lastMonth: { leads: 0, conversions: 0 } };
      return r.json();
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function delta(current: number, previous: number) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return { label: `+${current} vs last month`, positive: true };
  const diff = current - previous;
  if (diff === 0) return { label: "Same as last month", positive: true };
  return { label: `${diff > 0 ? "+" : ""}${diff} vs last month`, positive: diff >= 0 };
}

// ─── Components ───────────────────────────────────────────────────────────────

function MonthlyMetricCard({ title, subtitle, value, previous, icon: Icon, colorClass, bgClass, delay, onClick }: any) {
  const d = delta(value, previous);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <GlassCard
        className={`p-6 relative overflow-hidden group ${onClick ? "cursor-pointer hover:border-white/20 transition-colors" : ""}`}
        onClick={onClick}
      >
        <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity ${bgClass}`} />
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">{subtitle}</p>
          </div>
          <div className={`p-2 rounded-lg bg-white/5 ${colorClass}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <h3 className="text-5xl font-display font-bold text-white mt-2">{value}</h3>
        {d && (
          <p className={`text-xs mt-3 font-medium ${d.positive ? "text-emerald-400" : "text-rose-400"}`}>
            {d.label}
          </p>
        )}
        {onClick && (
          <p className="text-[10px] text-muted-foreground/40 mt-1">Click to view submissions</p>
        )}
      </GlassCard>
    </motion.div>
  );
}

// ── Leads Pipeline Card ───────────────────────────────────────────────────────

function LeadsPipelineCard({ stats, delay }: { stats: LeadsMonthlyStats | undefined; delay: number }) {
  const [, navigate] = useLocation();
  const leads = stats?.thisMonth.leads ?? 0;
  const conversions = stats?.thisMonth.conversions ?? 0;
  const prevLeads = stats?.lastMonth.leads ?? 0;
  const prevConversions = stats?.lastMonth.conversions ?? 0;
  const rate = leads > 0 ? Math.round((conversions / leads) * 100) : 0;
  const prevRate = prevLeads > 0 ? Math.round((prevConversions / prevLeads) * 100) : 0;
  const d = delta(leads, prevLeads);
  const rateUp = rate >= prevRate;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <GlassCard
        className="p-6 relative overflow-hidden group cursor-pointer hover:border-white/20 transition-colors"
        onClick={() => navigate("/activity")}
      >
        <div className="absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity bg-violet-400" />
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Leads Pipeline</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">Field sales this month</p>
          </div>
          <div className="p-2 rounded-lg bg-white/5 text-violet-400">
            <TrendingUp className="w-5 h-5" />
          </div>
        </div>

        <h3 className="text-5xl font-display font-bold text-white mt-2">{leads}</h3>

        {/* Conversions row */}
        <div className="flex items-center gap-2 mt-3">
          <span className="text-sm font-semibold text-emerald-400">{conversions} converted</span>
          {leads > 0 && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${rateUp ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
              {rate}%
            </span>
          )}
          {prevLeads > 0 && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto">
              last: {prevLeads} / {prevConversions} ({prevRate}%)
            </span>
          )}
        </div>

        {d && (
          <p className={`text-xs mt-2 font-medium ${d.positive ? "text-emerald-400" : "text-rose-400"}`}>
            {d.label} leads
          </p>
        )}
        <p className="text-[10px] text-muted-foreground/40 mt-1">Click to view pipeline</p>
      </GlassCard>
    </motion.div>
  );
}

// ── Applications Detail Panel ─────────────────────────────────────────────────

function ApplicationsDetailPanel({ type, title, onClose }: { type: "application" | "reapplication"; title: string; onClose: () => void }) {
  const BASE = (import.meta as any).env.BASE_URL.replace(/\/$/, "");
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ApplicationsDetail>({
    queryKey: ["applications-detail", type],
    queryFn: () => fetch(`${BASE}/api/dashboard/applications-detail?type=${type}`, { credentials: "include" }).then(r => r.json()),
  });

  const duplicateSet = new Set((data?.duplicateCustomers ?? []).map(n => n.trim().toLowerCase()));

  async function handleDelete(jobId: string) {
    setDeleting(jobId);
    try {
      await fetch(`${BASE}/api/dashboard/applications/${encodeURIComponent(jobId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: ["applications-detail", type] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/monthly-metrics"] });
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-end p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ x: 80, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 80, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
          className="w-full max-w-lg h-[calc(100vh-2rem)] bg-[#0f1117] border border-white/10 rounded-2xl shadow-2xl flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
            <div>
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">This month · {data?.total ?? "—"} submissions</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Duplicate warning banner */}
          {(data?.duplicateCustomers.length ?? 0) > 0 && (
            <div className="mx-4 mt-4 flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 shrink-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-400">Possible resubmissions detected</p>
                <p className="text-xs text-amber-400/70 mt-0.5">{data!.duplicateCustomers.join(", ")}</p>
              </div>
            </div>
          )}

          {/* List */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />
              ))
            ) : data?.rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                No submissions this month yet.
              </div>
            ) : (
              data?.rows.map((row, i) => {
                const isDupe = duplicateSet.has((row.customer_name ?? "").trim().toLowerCase());
                const jobId = row.formitize_job_id;
                const isConfirming = confirmDelete === jobId;
                const isDeleting = deleting === jobId;
                return (
                  <div
                    key={jobId ?? i}
                    className={`p-4 rounded-xl border ${isDupe ? "bg-amber-500/5 border-amber-500/20" : "bg-white/3 border-white/8"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-white truncate">{row.customer_name ?? "Unknown"}</p>
                          {isDupe && (
                            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                              MULTI
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                          {row.retailer_name && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Building2 className="w-3 h-3" />{row.retailer_name}
                              {row.branch_name ? ` · ${row.branch_name}` : ""}
                            </span>
                          )}
                          {row.customer_phone && (
                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                              <Phone className="w-3 h-3" />{row.customer_phone}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <p className="text-[11px] text-muted-foreground/60">
                          {format(new Date(row.created_at), "d MMM, HH:mm")}
                        </p>
                        {jobId && !isConfirming && (
                          <button
                            onClick={() => setConfirmDelete(jobId)}
                            className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-colors"
                            title="Delete submission"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isConfirming && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-[10px] px-2 py-1 rounded border border-white/10 text-muted-foreground hover:text-white transition-colors"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => jobId && handleDelete(jobId)}
                              disabled={isDeleting}
                              className="text-[10px] px-2 py-1 rounded bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 disabled:opacity-50 transition-colors"
                            >
                              {isDeleting ? "Deleting…" : "Confirm delete"}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                    {row.form_name && (
                      <p className="text-[10px] text-muted-foreground/40 mt-1.5 truncate">{row.form_name}</p>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function StatCard({ title, value, icon: Icon, colorClass, delay }: any) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <GlassCard className="p-6 relative overflow-hidden group">
        <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity ${colorClass}`} />
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className={`p-2 rounded-lg bg-white/5 ${colorClass}`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
        <h3 className="text-4xl font-display font-bold text-white">{value}</h3>
      </GlassCard>
    </motion.div>
  );
}

const TOOLTIP_STYLE = {
  backgroundColor: "#18181b",
  borderColor: "rgba(255,255,255,0.1)",
  borderRadius: "12px",
  fontSize: "12px",
};

function HistoryChart({ data }: { data: MonthSnapshot[] }) {
  const chartData = data.map((s) => ({
    name: s.monthLabel.replace(" 20", " '"), // "March '26" to save space
    "New Apps": s.newApplications,
    "Re-Apps": s.reApplications,
    "Agreements": s.agreementsIssued,
    isLive: s.isLive,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis dataKey="name" stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke="rgba(255,255,255,0.4)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
        <RechartsTooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number, name: string, props: any) => {
            const suffix = props.payload?.isLive ? " (live)" : "";
            return [`${value}${suffix}`, name];
          }}
        />
        <Legend iconType="circle" wrapperStyle={{ fontSize: "12px", color: "#9ca3af" }} />
        <Bar dataKey="New Apps" fill="#38bdf8" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Re-Apps"  fill="#fbbf24" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Agreements" fill="#34d399" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function HistoryTable({ data }: { data: MonthSnapshot[] }) {
  const reversed = [...data].reverse(); // most recent first
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10">
            <th className="text-left pb-3 pr-4 text-muted-foreground font-medium text-xs uppercase tracking-wider">Month</th>
            <th className="text-right pb-3 pr-4 text-sky-400 font-medium text-xs uppercase tracking-wider">New Apps</th>
            <th className="text-right pb-3 pr-4 text-amber-400 font-medium text-xs uppercase tracking-wider">Re-Apps</th>
            <th className="text-right pb-3 text-emerald-400 font-medium text-xs uppercase tracking-wider">Agreements</th>
          </tr>
        </thead>
        <tbody>
          {reversed.map((s) => {
            const total = s.newApplications + s.reApplications;
            const newPct = total > 0 ? Math.round((s.newApplications / total) * 100) : 0;
            return (
              <tr key={s.month} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                <td className="py-3 pr-4 font-medium text-white">
                  <div className="flex items-center gap-2">
                    {s.monthLabel}
                    {s.isLive && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">
                        <Wifi className="w-2.5 h-2.5" /> live
                      </span>
                    )}
                  </div>
                  {total > 0 && (
                    <p className="text-[11px] text-muted-foreground/60 mt-0.5">
                      {newPct}% new · {100 - newPct}% repeat
                    </p>
                  )}
                </td>
                <td className="py-3 pr-4 text-right text-sky-300 font-semibold tabular-nums">{s.newApplications}</td>
                <td className="py-3 pr-4 text-right text-amber-300 font-semibold tabular-nums">{s.reApplications}</td>
                <td className="py-3 text-right text-emerald-300 font-semibold tabular-nums">{s.agreementsIssued}</td>
              </tr>
            );
          })}
        </tbody>
        {data.length > 1 && (() => {
          const totals = data.reduce((acc, s) => ({
            newApplications: acc.newApplications + s.newApplications,
            reApplications:  acc.reApplications  + s.reApplications,
            agreementsIssued: acc.agreementsIssued + s.agreementsIssued,
          }), { newApplications: 0, reApplications: 0, agreementsIssued: 0 });
          const grandTotal = totals.newApplications + totals.reApplications;
          const newPct = grandTotal > 0 ? Math.round((totals.newApplications / grandTotal) * 100) : 0;
          return (
            <tfoot>
              <tr className="border-t border-white/20">
                <td className="pt-3 pr-4 font-semibold text-white text-xs uppercase tracking-wider">
                  All time
                  {grandTotal > 0 && (
                    <span className="block text-[11px] text-muted-foreground/60 font-normal normal-case tracking-normal mt-0.5">
                      {newPct}% new · {100 - newPct}% repeat
                    </span>
                  )}
                </td>
                <td className="pt-3 pr-4 text-right text-sky-300 font-bold tabular-nums">{totals.newApplications}</td>
                <td className="pt-3 pr-4 text-right text-amber-300 font-bold tabular-nums">{totals.reApplications}</td>
                <td className="pt-3 text-right text-emerald-300 font-bold tabular-nums">{totals.agreementsIssued}</td>
              </tr>
            </tfoot>
          );
        })()}
      </table>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity();
  const { data: monthly, isLoading: monthlyLoading } = useMonthlyMetrics();
  const { data: history, isLoading: historyLoading } = useMonthlyHistory();
  const { data: leadsStats } = useLeadsMonthlyStats();
  const [drillDown, setDrillDown] = useState<"application" | "reapplication" | null>(null);

  if (statsLoading || activityLoading || monthlyLoading) {
    return <div className="h-96 flex items-center justify-center animate-pulse text-primary">Loading dashboard data...</div>;
  }

  const monthLabel = monthly?.month ?? new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="pb-10">
      <PageHeader
        title="Overview"
        description="Real-time performance across all loan products and retailers."
      />

      {drillDown && (
        <ApplicationsDetailPanel
          type={drillDown}
          title={drillDown === "application" ? "New Applications — This Month" : "Re-Applications — This Month"}
          onClose={() => setDrillDown(null)}
        />
      )}

      {/* ── Monthly this-month summary ── */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }} className="mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Monthly Totals</h2>
          <span className="text-xs text-muted-foreground/50 font-medium">· {monthLabel}</span>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <MonthlyMetricCard
          delay={0.08} title="New Applications" subtitle="First-time customer applications"
          value={monthly?.newApplications.current ?? 0} previous={monthly?.newApplications.previous ?? 0}
          icon={UserPlus} colorClass="text-sky-400" bgClass="bg-sky-400"
          onClick={() => setDrillDown("application")}
        />
        <MonthlyMetricCard
          delay={0.14} title="Re-Applications" subtitle="Returning customer applications"
          value={monthly?.reApplications.current ?? 0} previous={monthly?.reApplications.previous ?? 0}
          icon={RefreshCw} colorClass="text-amber-400" bgClass="bg-amber-400"
          onClick={() => setDrillDown("reapplication")}
        />
        <MonthlyMetricCard
          delay={0.20} title="Agreements Issued" subtitle="Loan agreements generated this month"
          value={monthly?.agreementsIssued.current ?? 0} previous={monthly?.agreementsIssued.previous ?? 0}
          icon={FileCheck} colorClass="text-emerald-400" bgClass="bg-emerald-400"
        />
        <LeadsPipelineCard stats={leadsStats} delay={0.26} />
      </div>

      {/* ── Historical comparison ── */}
      {!historyLoading && history && history.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Month-by-Month History
            </h2>
            {history.length === 1 && (
              <span className="text-xs text-muted-foreground/50">· Comparison builds as months complete</span>
            )}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Trend chart — wider */}
            <GlassCard className="p-6 lg:col-span-3">
              <h3 className="text-sm font-semibold text-muted-foreground mb-5 uppercase tracking-wider">Trend</h3>
              <div className="h-64">
                <HistoryChart data={history} />
              </div>
            </GlassCard>

            {/* Data table — narrower */}
            <GlassCard className="p-6 lg:col-span-2">
              <h3 className="text-sm font-semibold text-muted-foreground mb-5 uppercase tracking-wider">
                Breakdown · New vs Repeat
              </h3>
              <HistoryTable data={history} />
            </GlassCard>
          </div>
        </motion.div>
      )}

      {/* ── System stats ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard delay={0.30} title="Total Retailers" value={stats?.totalRetailers || 0} icon={Store} colorClass="text-blue-400 bg-blue-400" />
        <StatCard delay={0.35} title="Active Branches" value={stats?.totalBranches || 0} icon={MapPin} colorClass="text-purple-400 bg-purple-400" />
        <StatCard delay={0.40} title="Pending Signatures" value={stats?.pendingSignatures || 0} icon={Clock} colorClass="text-amber-400 bg-amber-400" />
        <StatCard delay={0.45} title="Signed Today" value={stats?.signedToday || 0} icon={CheckCircle} colorClass="text-emerald-400 bg-emerald-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Agreements by product chart */}
        <GlassCard className="p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold mb-6">Agreements by Product</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats?.loanProducts || []} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="product" stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="rgba(255,255,255,0.4)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <RechartsTooltip cursor={{ fill: "rgba(255,255,255,0.05)" }} contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="total" name="Total Agreements" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Activity feed */}
        <GlassCard className="p-6 flex flex-col">
          <h3 className="text-lg font-semibold mb-6">Recent Activity</h3>
          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
            {!activity?.length && <p className="text-muted-foreground text-sm">No recent activity.</p>}
            {activity?.map((item) => (
              <div key={item.id} className="relative pl-6 before:absolute before:left-[11px] before:top-2 before:bottom-[-24px] last:before:bottom-0 before:w-px before:bg-white/10">
                <div className="absolute left-0 top-1 w-6 h-6 rounded-full bg-card border-2 border-primary/50 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                </div>
                <div className="bg-white/5 rounded-xl p-3 border border-white/5">
                  <p className="text-sm text-foreground">{item.description}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground font-medium">
                    <span>{format(new Date(item.timestamp), "MMM d, h:mm a")}</span>
                    {item.loanProduct && (
                      <>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className="text-primary">{item.loanProduct}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
