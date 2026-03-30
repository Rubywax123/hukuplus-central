import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { motion } from "framer-motion";
import {
  ClipboardList, Zap, Clock, CheckCircle, XCircle, AlertCircle,
  ChevronDown, ChevronUp, RefreshCw, MessageSquare, User, Store,
  Calendar, DollarSign, Egg, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = import.meta.env.VITE_API_URL ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LoanApplication {
  id: number;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  retailer_name: string | null;
  branch_name: string | null;
  collection_retailer_name: string | null;
  collection_branch_name: string | null;
  chick_count: number;
  chick_purchase_date: string;
  expected_collection_date: string;
  amount_requested: string;
  amount_limit: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface DrawdownRequest {
  id: number;
  customer_id: number | null;
  customer_name: string;
  customer_phone: string | null;
  retailer_name: string | null;
  branch_name: string | null;
  collection_retailer_name: string | null;
  collection_branch_name: string | null;
  amount_requested: string;
  facility_limit: string;
  facility_balance: string;
  status: string;
  store_notified_at: string | null;
  store_actioned_at: string | null;
  store_actioned_by: string | null;
  notes: string | null;
  created_at: string;
}

// ── Status config ─────────────────────────────────────────────────────────────

const LOAN_STATUS: Record<string, { label: string; color: string; icon: any }> = {
  submitted:    { label: "Submitted",    color: "text-amber-400 bg-amber-400/10 border-amber-400/20",    icon: Clock },
  under_review: { label: "Under Review", color: "text-blue-400 bg-blue-400/10 border-blue-400/20",      icon: AlertCircle },
  approved:     { label: "Approved",     color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", icon: CheckCircle },
  declined:     { label: "Declined",     color: "text-red-400 bg-red-400/10 border-red-400/20",          icon: XCircle },
};

const DRAWDOWN_STATUS: Record<string, { label: string; color: string; icon: any }> = {
  pending:   { label: "Pending",   color: "text-amber-400 bg-amber-400/10 border-amber-400/20",    icon: Clock },
  notified:  { label: "Notified",  color: "text-blue-400 bg-blue-400/10 border-blue-400/20",      icon: MessageSquare },
  actioned:  { label: "Actioned",  color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", icon: CheckCircle },
  cancelled: { label: "Cancelled", color: "text-red-400 bg-red-400/10 border-red-400/20",          icon: XCircle },
};

function StatusBadge({ status, map }: { status: string; map: Record<string, any> }) {
  const cfg = map[status] ?? map.pending ?? map.submitted;
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border", cfg.color)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

// ── Loan Application Row ──────────────────────────────────────────────────────

function LoanAppRow({ app }: { app: LoanApplication }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(app.status);
  const [notes, setNotes] = useState(app.notes || "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${API}/api/applications/loan/${app.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: notes || null }),
      });
      if (resp.ok) qc.invalidateQueries({ queryKey: ["loan-applications"] });
    } finally {
      setSaving(false);
    }
  };

  const fmt = (v: string) => `$${parseFloat(v).toFixed(2)}`;

  return (
    <div className="border border-white/10 rounded-xl bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
          <Egg className="w-5 h-5 text-orange-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{app.customer_name}</span>
            <StatusBadge status={app.status} map={LOAN_STATUS} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span>{app.chick_count} chicks</span>
            <span className="text-orange-400 font-medium">{fmt(app.amount_requested)}</span>
            <span>Limit: {fmt(app.amount_limit)}</span>
            {app.retailer_name && <span>{app.collection_retailer_name || app.retailer_name}</span>}
            <span>{format(new Date(app.created_at), "dd MMM yyyy")}</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground text-xs block">Phone</span><span className="text-white">{app.customer_phone || "—"}</span></div>
            <div><span className="text-muted-foreground text-xs block">Registered Store</span><span className="text-white">{app.retailer_name}{app.branch_name ? ` — ${app.branch_name}` : ""}</span></div>
            <div><span className="text-muted-foreground text-xs block">Collection Store</span><span className="text-white">{app.collection_retailer_name || app.retailer_name}{app.collection_branch_name ? ` — ${app.collection_branch_name}` : ""}</span></div>
            <div><span className="text-muted-foreground text-xs block">Chick Purchase Date</span><span className="text-white">{format(new Date(app.chick_purchase_date), "dd MMM yyyy")}</span></div>
            <div><span className="text-muted-foreground text-xs block">Expected Collection</span><span className="text-white">{format(new Date(app.expected_collection_date), "dd MMM yyyy")}</span></div>
            <div><span className="text-muted-foreground text-xs block">Submitted</span><span className="text-white">{format(new Date(app.created_at), "dd MMM yyyy HH:mm")}</span></div>
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              >
                {Object.entries(LOAN_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add internal notes..."
                className="w-full rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Drawdown Request Row ──────────────────────────────────────────────────────

function DrawdownRow({ req }: { req: DrawdownRequest }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(req.status);
  const [notes, setNotes] = useState(req.notes || "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${API}/api/applications/drawdown/${req.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: notes || null }),
      });
      if (resp.ok) qc.invalidateQueries({ queryKey: ["drawdown-requests"] });
    } finally {
      setSaving(false);
    }
  };

  const fmt = (v: string | null) => v ? `$${parseFloat(v).toFixed(2)}` : "—";

  return (
    <div className="border border-white/10 rounded-xl bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/5 transition-colors"
      >
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white text-sm">{req.customer_name}</span>
            <StatusBadge status={req.status} map={DRAWDOWN_STATUS} />
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="text-blue-400 font-medium">{fmt(req.amount_requested)}</span>
            <span>Balance: {fmt(req.facility_balance)}</span>
            {req.collection_retailer_name && <span>{req.collection_retailer_name}</span>}
            <span>{format(new Date(req.created_at), "dd MMM yyyy")}</span>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="border-t border-white/10 p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            <div><span className="text-muted-foreground text-xs block">Phone</span><span className="text-white">{req.customer_phone || "—"}</span></div>
            <div><span className="text-muted-foreground text-xs block">Default Store</span><span className="text-white">{req.retailer_name}{req.branch_name ? ` — ${req.branch_name}` : ""}</span></div>
            <div><span className="text-muted-foreground text-xs block">Collection Store</span><span className="text-white font-medium">{req.collection_retailer_name || req.retailer_name}{req.collection_branch_name ? ` — ${req.collection_branch_name}` : ""}</span></div>
            <div><span className="text-muted-foreground text-xs block">Facility Limit</span><span className="text-white">{fmt(req.facility_limit)}</span></div>
            <div><span className="text-muted-foreground text-xs block">Available Balance</span><span className="text-white">{fmt(req.facility_balance)}</span></div>
            <div><span className="text-muted-foreground text-xs block">Submitted</span><span className="text-white">{format(new Date(req.created_at), "dd MMM yyyy HH:mm")}</span></div>
            {req.store_notified_at && (
              <div><span className="text-muted-foreground text-xs block">Store Notified</span><span className="text-white">{format(new Date(req.store_notified_at), "dd MMM yyyy HH:mm")}</span></div>
            )}
            {req.store_actioned_at && (
              <div><span className="text-muted-foreground text-xs block">Actioned By</span><span className="text-white">{req.store_actioned_by} at {format(new Date(req.store_actioned_at), "dd MMM yyyy HH:mm")}</span></div>
            )}
          </div>

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {Object.entries(DRAWDOWN_STATUS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Add internal notes..."
                className="w-full rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApplicationsPage() {
  const [tab, setTab] = useState<"loans" | "drawdowns">("loans");
  const [loanStatus, setLoanStatus] = useState("all");
  const [drawdownStatus, setDrawdownStatus] = useState("all");

  const { data: loans = [], isLoading: loansLoading, refetch: refetchLoans } = useQuery<LoanApplication[]>({
    queryKey: ["loan-applications", loanStatus],
    queryFn: async () => {
      const url = loanStatus === "all"
        ? `${API}/api/applications/loan`
        : `${API}/api/applications/loan?status=${loanStatus}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const { data: drawdowns = [], isLoading: drawdownsLoading, refetch: refetchDrawdowns } = useQuery<DrawdownRequest[]>({
    queryKey: ["drawdown-requests", drawdownStatus],
    queryFn: async () => {
      const url = drawdownStatus === "all"
        ? `${API}/api/applications/drawdown`
        : `${API}/api/applications/drawdown?status=${drawdownStatus}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const pendingLoans = loans.filter(l => l.status === "submitted" || l.status === "under_review").length;
  const pendingDrawdowns = drawdowns.filter(d => d.status === "pending" || d.status === "notified").length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Customer Requests</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Repeat loan applications and Revolver drawdown requests</p>
        </div>
        <button
          onClick={() => { refetchLoans(); refetchDrawdowns(); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 text-muted-foreground hover:text-white hover:bg-white/5 text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1"><Egg className="w-4 h-4 text-orange-400" /><span className="text-xs text-muted-foreground">Total Applications</span></div>
          <div className="text-2xl font-bold text-white">{loans.length}</div>
        </div>
        <div className="bg-card border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-amber-400" /><span className="text-xs text-muted-foreground">Pending Review</span></div>
          <div className="text-2xl font-bold text-amber-400">{pendingLoans}</div>
        </div>
        <div className="bg-card border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1"><Zap className="w-4 h-4 text-blue-400" /><span className="text-xs text-muted-foreground">Total Drawdowns</span></div>
          <div className="text-2xl font-bold text-white">{drawdowns.length}</div>
        </div>
        <div className="bg-card border border-white/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1"><Clock className="w-4 h-4 text-amber-400" /><span className="text-xs text-muted-foreground">Pending Action</span></div>
          <div className="text-2xl font-bold text-amber-400">{pendingDrawdowns}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setTab("loans")}
          className={cn(
            "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
            tab === "loans"
              ? "border-orange-500 text-orange-400"
              : "border-transparent text-muted-foreground hover:text-white"
          )}
        >
          <Egg className="w-4 h-4" />
          HukuPlus Repeat Loans
          {pendingLoans > 0 && (
            <span className="bg-orange-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{pendingLoans}</span>
          )}
        </button>
        <button
          onClick={() => setTab("drawdowns")}
          className={cn(
            "flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors",
            tab === "drawdowns"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-muted-foreground hover:text-white"
          )}
        >
          <Zap className="w-4 h-4" />
          Revolver Drawdowns
          {pendingDrawdowns > 0 && (
            <span className="bg-blue-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">{pendingDrawdowns}</span>
          )}
        </button>
      </div>

      {/* Loan Applications Tab */}
      {tab === "loans" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <div className="flex gap-2 flex-wrap">
              {[["all", "All"], ...Object.entries(LOAN_STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setLoanStatus(k)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    loanStatus === k
                      ? "bg-orange-500 border-orange-500 text-white"
                      : "border-white/10 text-muted-foreground hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loansLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : loans.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
              <Egg className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No loan applications yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {loans.map(app => <LoanAppRow key={app.id} app={app} />)}
            </div>
          )}
        </div>
      )}

      {/* Drawdown Requests Tab */}
      {tab === "drawdowns" && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Filter className="w-4 h-4 text-muted-foreground" />
            <div className="flex gap-2 flex-wrap">
              {[["all", "All"], ...Object.entries(DRAWDOWN_STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setDrawdownStatus(k)}
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                    drawdownStatus === k
                      ? "bg-blue-500 border-blue-500 text-white"
                      : "border-white/10 text-muted-foreground hover:text-white"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {drawdownsLoading ? (
            <div className="text-center py-12 text-muted-foreground">Loading...</div>
          ) : drawdowns.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-white/10 rounded-xl">
              <Zap className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No drawdown requests yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {drawdowns.map(req => <DrawdownRow key={req.id} req={req} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
