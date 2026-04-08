import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useLocation } from "wouter";
import { useStaffAuth } from "@/hooks/useStaffAuth";
import {
  Bell, CheckCheck, ChevronDown, ChevronRight, ChevronUp, Clock, User, Store,
  RefreshCw, MessageSquare, Zap, Egg, Filter, CheckCircle, XCircle, AlertCircle,
  Send, CheckCircle2, Plus, Loader2, X, ArrowDownCircle, MessageCircle, Phone,
  DollarSign, CreditCard, FileText, AlertTriangle, ArrowRight, Lock, ExternalLink,
  LayoutTemplate, Search, Link2,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Shared helpers ─────────────────────────────────────────────────────────────

function fmt(d: string) {
  try { return format(new Date(d), "d MMM yyyy, HH:mm"); } catch { return d; }
}
function ago(d: string) {
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return ""; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 1 — FORMITIZE NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

const PRODUCTS = ["All", "HukuPlus", "Revolver", "ChikweretiOne"] as const;

const TASK_TYPES = [
  { value: "all",           label: "All Types" },
  { value: "application",   label: "Applications" },
  { value: "reapplication", label: "Re-Applications" },
  { value: "agreement",     label: "Agreements" },
  { value: "upload",        label: "Document Uploads" },
  { value: "payment",       label: "Payment Notifications" },
  { value: "drawdown",      label: "Drawdowns" },
  { value: "approval",      label: "Approvals" },
  { value: "undertaking",   label: "Undertakings" },
] as const;

// Task types that require explicit action — sorted to the top and visually highlighted
const ACTIONABLE_TYPES = new Set(["payment", "drawdown", "approval", "undertaking"]);

function sortNotifications(ns: FNotification[]): FNotification[] {
  return [...ns].sort((a, b) => {
    const aAction = ACTIONABLE_TYPES.has(a.task_type) ? 0 : 1;
    const bAction = ACTIONABLE_TYPES.has(b.task_type) ? 0 : 1;
    const aNew = a.status === "new" ? 0 : 1;
    const bNew = b.status === "new" ? 0 : 1;
    // Primary: new actionable → new informational → actioned
    const priority = (aNew * 2 + aAction) - (bNew * 2 + bAction);
    if (priority !== 0) return priority;
    // Secondary: most recent first
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

const PRODUCT_COLORS: Record<string, { bg: string; text: string; dot: string; border: string }> = {
  HukuPlus:      { bg: "bg-amber-500/10",  text: "text-amber-300",  dot: "bg-amber-400",  border: "border-amber-500/20" },
  Revolver:      { bg: "bg-blue-500/10",   text: "text-blue-300",   dot: "bg-blue-400",   border: "border-blue-500/20"  },
  ChikweretiOne: { bg: "bg-green-500/10",  text: "text-green-300",  dot: "bg-green-400",  border: "border-green-500/20" },
};

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  application:   { bg: "bg-purple-500/15",  text: "text-purple-300"  },
  reapplication: { bg: "bg-indigo-500/15",  text: "text-indigo-300"  },
  agreement:     { bg: "bg-emerald-500/15", text: "text-emerald-300" },
  upload:        { bg: "bg-sky-500/15",     text: "text-sky-300"     },
  payment:       { bg: "bg-yellow-500/15",  text: "text-yellow-300"  },
  drawdown:      { bg: "bg-pink-500/15",    text: "text-pink-300"    },
  approval:      { bg: "bg-teal-500/15",    text: "text-teal-300"    },
  undertaking:   { bg: "bg-orange-500/15",  text: "text-orange-300"  },
};

interface FNotification {
  id: number;
  formitize_job_id: string | null;
  form_name: string;
  task_type: string;
  product: string;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  branch_name: string | null;
  retailer_name: string | null;
  payment_amount: number | null;
  disbursement_amount: number | null;
  xero_bank_transaction_id: string | null;
  disbursed_at: string | null;
  is_duplicate_warning: boolean;
  processing_error: string | null;
  processed_at: string | null;
  status: "new" | "actioned";
  notes: string | null;
  created_at: string;
}

interface CountsResponse {
  breakdown: Array<{ product: string; task_type: string; status: string; count: string }>;
  newTotal: number;
}

const DISBURSEMENT_TYPES = new Set(["upload", "drawdown"]);

const FILE_DOC_TYPES = [
  { value: "Invoice",       label: "Invoice"        },
  { value: "ID Document",   label: "ID Document"    },
  { value: "Missing Docs",  label: "Missing Docs"   },
  { value: "Other",         label: "Other"          },
];

function NotificationCard({ n, onAction, loading, onProcessPayment, onProcessDisbursement, onFileCRM, onViewProfile }: {
  n: FNotification;
  onAction: () => void;
  loading: boolean;
  onProcessPayment?: () => void;
  onProcessDisbursement?: () => void;
  onFileCRM?: (note: string) => void;
  onViewProfile?: () => void;
}) {
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState("");
  const colors = PRODUCT_COLORS[n.product] ?? PRODUCT_COLORS["HukuPlus"];
  const typeBadge = TYPE_BADGE[n.task_type] ?? { bg: "bg-white/10", text: "text-white/60" };
  const isNew = n.status === "new";
  const isActionable = ACTIONABLE_TYPES.has(n.task_type);
  const typeLabel = TASK_TYPES.find(x => x.value === n.task_type)?.label ?? n.task_type;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className={`flex flex-col p-4 rounded-xl border transition-colors ${
        isNew && isActionable
          ? "bg-amber-500/[0.04] border-amber-500/25 border-l-[3px] border-l-amber-400/70 hover:bg-amber-500/[0.07]"
          : isNew
          ? "bg-white/5 border-white/10 hover:bg-white/8"
          : "bg-white/[0.02] border-white/5 opacity-60 hover:opacity-80"
      }`}
    >
    <div className="flex items-start gap-4">
      <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${colors.bg} border ${colors.border}`}>
        <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border}`}>{n.product}</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeBadge.bg} ${typeBadge.text}`}>{typeLabel}</span>
          {isNew && isActionable && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 border border-amber-400/30">⚡ ACTION REQUIRED</span>}
          {isNew && !isActionable && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/50">NEW</span>}
          {n.is_duplicate_warning && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">⚠ POSSIBLE DUPLICATE</span>}
          {n.processing_error && isNew && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/25">RETRY NEEDED</span>}
        </div>
        <p className="text-sm font-medium text-white truncate">{n.form_name}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50 flex-wrap">
          {n.customer_name && <span className="flex items-center gap-1"><User className="w-3 h-3" />{n.customer_name}</span>}
          {n.retailer_name && <span className="flex items-center gap-1"><Store className="w-3 h-3" />{n.retailer_name}{n.branch_name ? ` — ${n.branch_name}` : ""}</span>}
          <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" />{ago(n.created_at)}</span>
        </div>
        {n.customer_phone && <p className="text-xs text-white/30 mt-1">{n.customer_phone}</p>}
        {n.payment_amount && <p className="text-xs text-amber-300/70 mt-1 font-medium">Payment: ${Number(n.payment_amount).toFixed(2)}</p>}
        {n.disbursement_amount && n.disbursed_at && (
          <p className="text-xs text-emerald-300/70 mt-1 font-medium">Disbursed: ${Number(n.disbursement_amount).toFixed(2)} · {fmt(n.disbursed_at)}</p>
        )}
        {n.xero_bank_transaction_id && (
          <p className="text-xs text-white/30 mt-0.5">Xero TX: {n.xero_bank_transaction_id}</p>
        )}
        {n.notes && !isNew && (
          <p className="text-xs text-sky-300/60 mt-1 flex items-center gap-1">
            <FileText className="w-3 h-3" />{n.notes}
          </p>
        )}
        {n.processing_error && isNew && (
          <p className="text-xs text-orange-300/70 mt-1 font-medium truncate">Last error: {n.processing_error}</p>
        )}
      </div>
      <div className="flex-shrink-0 flex flex-col gap-1.5 items-end">
        {n.customer_id && onViewProfile && (
          <button
            onClick={onViewProfile}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 transition-all"
            title="Open customer profile"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View Profile
          </button>
        )}
        {n.task_type === "payment" && onProcessPayment && isNew && (
          <button
            onClick={onProcessPayment}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all"
          >
            <DollarSign className="w-3.5 h-3.5" />
            Process Payment
          </button>
        )}
        {DISBURSEMENT_TYPES.has(n.task_type) && isNew && (
          <>
            {onProcessDisbursement && (
              <button
                onClick={onProcessDisbursement}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all"
              >
                <ArrowDownCircle className="w-3.5 h-3.5" />
                Disburse
              </button>
            )}
            {onFileCRM && !showFilePicker && (
              <button
                onClick={() => { setShowFilePicker(true); setSelectedDocType(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/15 border border-sky-500/30 text-sky-300 hover:bg-sky-500/25 transition-all"
              >
                <FileText className="w-3.5 h-3.5" />
                File to CRM
              </button>
            )}
          </>
        )}
        <button
          onClick={onAction}
          disabled={loading}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 ${
            isNew
              ? "bg-white/5 border border-white/10 text-white/40 hover:text-white/60"
              : "bg-white/5 border border-white/10 text-white/40 hover:text-white/60"
          }`}
        >
          <CheckCheck className="w-3.5 h-3.5" />
          {isNew ? "Mark Done" : "Reopen"}
        </button>
      </div>
    </div>

      {/* Inline file-to-CRM picker — expands below the main row */}
      {showFilePicker && onFileCRM && (
        <div className="w-full mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-muted-foreground mb-2 font-medium">What type of document is this?</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {FILE_DOC_TYPES.map(dt => (
              <button
                key={dt.value}
                onClick={() => setSelectedDocType(dt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  selectedDocType === dt.value
                    ? "bg-sky-500/25 border-sky-500/50 text-sky-200"
                    : "bg-white/5 border-white/15 text-white/50 hover:text-white/70 hover:bg-white/8"
                }`}
              >
                {dt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setShowFilePicker(false); setSelectedDocType(""); }}
              className="px-3 py-1.5 rounded-lg text-xs text-white/40 hover:text-white/60 transition-colors"
            >
              Cancel
            </button>
            <button
              disabled={!selectedDocType}
              onClick={() => {
                if (selectedDocType) {
                  onFileCRM(`Filed to CRM: ${selectedDocType}`);
                  setShowFilePicker(false);
                }
              }}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-sky-500/20 border border-sky-500/35 text-sky-300 hover:bg-sky-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Confirm — File {selectedDocType || "…"}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function FormitizeTab() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [activeProduct, setActiveProduct] = useState<string>("All");
  const [activeType, setActiveType] = useState<string>("all");
  const [showActioned, setShowActioned] = useState(false);
  const [paymentNotification, setPaymentNotification] = useState<FNotification | null>(null);
  const [disbursementNotification, setDisbursementNotification] = useState<FNotification | null>(null);

  const statusFilter = showActioned ? "all" : "new";

  const { data: notifications = [], isLoading, refetch } = useQuery<FNotification[]>({
    queryKey: ["notifications", activeProduct, activeType, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeProduct !== "All") params.set("product", activeProduct);
      if (activeType !== "all") params.set("task_type", activeType);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const r = await fetch(`${BASE}/api/formitize/notifications?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const { data: counts } = useQuery<CountsResponse>({
    queryKey: ["notification-counts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/formitize/notifications/counts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const markOneMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: number; status: string; notes?: string }) => {
      const r = await fetch(`${BASE}/api/formitize/notifications/${id}/status`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ status, ...(notes !== undefined ? { notes } : {}) }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["notification-counts"] }); },
  });

  const markAllMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {};
      if (activeProduct !== "All") body.product = activeProduct;
      if (activeType !== "all") body.task_type = activeType;
      const r = await fetch(`${BASE}/api/formitize/notifications/mark-all`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["notification-counts"] }); },
  });

  const newCount = counts?.newTotal ?? 0;
  const productNewCount = (p: string) => {
    if (!counts) return 0;
    if (p === "All") return newCount;
    return counts.breakdown.filter(r => r.product === p && r.status === "new").reduce((s, r) => s + parseInt(r.count), 0);
  };
  const visibleNew = notifications.filter(n => n.status === "new").length;

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">{newCount > 0 ? `${newCount} unactioned` : "All caught up"}</p>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {visibleNew > 0 && (
            <button onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 transition-colors disabled:opacity-50">
              <CheckCheck className="w-3.5 h-3.5" /> Mark all actioned
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
        {PRODUCTS.map(p => {
          const cnt = productNewCount(p);
          return (
            <button key={p} onClick={() => setActiveProduct(p)}
              className={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeProduct === p ? "bg-white/10 text-white shadow-sm" : "text-white/50 hover:text-white/80"}`}>
              {p}
              {cnt > 0 && <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-[10px] font-bold text-black">{cnt > 9 ? "9+" : cnt}</span>}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {TASK_TYPES.slice(0, 6).map(tt => (
            <button key={tt.value} onClick={() => setActiveType(tt.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${activeType === tt.value ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"}`}>
              {tt.label}
            </button>
          ))}
          <div className="relative group">
            <button className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium text-white/40 hover:text-white/70 hover:bg-white/5 transition-all">
              More <ChevronDown className="w-3 h-3" />
            </button>
            <div className="absolute left-0 top-full mt-1 z-20 hidden group-hover:flex flex-col bg-card border border-white/10 rounded-xl shadow-xl p-1 min-w-[160px]">
              {TASK_TYPES.slice(6).map(tt => (
                <button key={tt.value} onClick={() => setActiveType(tt.value)}
                  className={`px-3 py-2 rounded-lg text-xs text-left transition-colors ${activeType === tt.value ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                  {tt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-white/50 cursor-pointer select-none">
          <input type="checkbox" checked={showActioned} onChange={e => setShowActioned(e.target.checked)} className="w-3.5 h-3.5 accent-amber-500" />
          Show actioned
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-white/40"><RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-white/40">
          <Bell className="w-10 h-10 mb-3 opacity-30" />
          <p className="text-base font-medium">No notifications</p>
          <p className="text-sm mt-1">{showActioned ? "Nothing here yet" : "No unactioned items — you're all caught up"}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <AnimatePresence initial={false}>
            {sortNotifications(notifications).map(n => (
              <NotificationCard key={n.id} n={n}
                onAction={() => markOneMutation.mutate({ id: n.id, status: n.status === "new" ? "actioned" : "new" })}
                loading={markOneMutation.isPending}
                onProcessPayment={n.task_type === "payment" ? () => setPaymentNotification(n) : undefined}
                onProcessDisbursement={DISBURSEMENT_TYPES.has(n.task_type) ? () => setDisbursementNotification(n) : undefined}
                onFileCRM={DISBURSEMENT_TYPES.has(n.task_type) ? (note) => markOneMutation.mutate({ id: n.id, status: "actioned", notes: note }) : undefined}
                onViewProfile={n.customer_id ? () => navigate(`/customers?customerId=${n.customer_id}`) : undefined}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>

    <AnimatePresence>
      {paymentNotification && (
        <PaymentModal
          notification={paymentNotification}
          onClose={() => setPaymentNotification(null)}
          onDone={() => {
            setPaymentNotification(null);
            qc.invalidateQueries({ queryKey: ["notifications"] });
            qc.invalidateQueries({ queryKey: ["notification-counts"] });
          }}
        />
      )}
    </AnimatePresence>
    <AnimatePresence>
      {disbursementNotification && (
        <DisbursementModal
          notification={disbursementNotification}
          onClose={() => setDisbursementNotification(null)}
          onDone={() => {
            setDisbursementNotification(null);
            qc.invalidateQueries({ queryKey: ["notifications"] });
            qc.invalidateQueries({ queryKey: ["notification-counts"] });
          }}
        />
      )}
    </AnimatePresence>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2 — LOAN APPLICATIONS
// ═══════════════════════════════════════════════════════════════════════════════

interface LoanApplication {
  id: number;
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

const LOAN_STATUS: Record<string, { label: string; color: string; icon: any }> = {
  submitted:    { label: "Submitted",    color: "text-amber-400 bg-amber-400/10 border-amber-400/20",     icon: Clock },
  under_review: { label: "Under Review", color: "text-blue-400 bg-blue-400/10 border-blue-400/20",       icon: AlertCircle },
  approved:     { label: "Approved",     color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", icon: CheckCircle },
  declined:     { label: "Declined",     color: "text-red-400 bg-red-400/10 border-red-400/20",           icon: XCircle },
};

function StatusBadge({ status, map }: { status: string; map: Record<string, any> }) {
  const cfg = map[status] ?? Object.values(map)[0];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border", cfg.color)}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function LoanAppRow({ app }: { app: LoanApplication }) {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(app.status);
  const [notes, setNotes] = useState(app.notes || "");
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      const resp = await fetch(`${BASE}/api/applications/loan/${app.id}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, notes: notes || null }),
      });
      if (resp.ok) qc.invalidateQueries({ queryKey: ["loan-applications"] });
    } finally { setSaving(false); }
  };

  const fmtAmt = (v: string) => `$${parseFloat(v).toFixed(2)}`;

  return (
    <div className="border border-white/10 rounded-xl bg-card overflow-hidden">
      <button onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/5 transition-colors">
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
            <span className="text-orange-400 font-medium">{fmtAmt(app.amount_requested)}</span>
            <span>Limit: {fmtAmt(app.amount_limit)}</span>
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
            <div><span className="text-muted-foreground text-xs block">Chick Purchase</span><span className="text-white">{format(new Date(app.chick_purchase_date), "dd MMM yyyy")}</span></div>
            <div><span className="text-muted-foreground text-xs block">Expected Collection</span><span className="text-white">{format(new Date(app.expected_collection_date), "dd MMM yyyy")}</span></div>
            <div><span className="text-muted-foreground text-xs block">Submitted</span><span className="text-white">{format(new Date(app.created_at), "dd MMM yyyy HH:mm")}</span></div>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500">
                {Object.entries(LOAN_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-40">
              <label className="text-xs text-muted-foreground block mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add internal notes..."
                className="w-full rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500" />
            </div>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LoansTab() {
  const [loanStatus, setLoanStatus] = useState("all");

  const { data: loans = [], isLoading, refetch } = useQuery<LoanApplication[]>({
    queryKey: ["loan-applications", loanStatus],
    queryFn: async () => {
      const url = loanStatus === "all" ? `${BASE}/api/applications/loan` : `${BASE}/api/applications/loan?status=${loanStatus}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const pendingLoans = loans.filter(l => l.status === "submitted" || l.status === "under_review").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">{pendingLoans > 0 ? `${pendingLoans} awaiting review` : "No pending applications"}</p>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-muted-foreground" />
        {[["all", "All"], ...Object.entries(LOAN_STATUS).map(([k, v]) => [k, v.label])].map(([k, label]) => (
          <button key={k} onClick={() => setLoanStatus(k)}
            className={cn("px-3 py-1 rounded-full text-xs font-medium border transition-colors",
              loanStatus === k ? "bg-orange-500 border-orange-500 text-white" : "border-white/10 text-muted-foreground hover:text-white")}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : loans.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-white/10 rounded-xl">
          <Egg className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No loan applications{loanStatus !== "all" ? ` with status "${LOAN_STATUS[loanStatus]?.label ?? loanStatus}"` : ""}</p>
        </div>
      ) : (
        <div className="space-y-2">{loans.map(app => <LoanAppRow key={app.id} app={app} />)}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3 — DRAWDOWNS
// ═══════════════════════════════════════════════════════════════════════════════

interface DrawdownRequest {
  id: number;
  customer_name: string;
  customer_phone: string | null;
  amount_requested: string;
  facility_limit: string | null;
  facility_balance: string | null;
  status: string;
  retailer_name: string | null;
  branch_name: string | null;
  collection_retailer_name: string | null;
  collection_branch_name: string | null;
  notes: string | null;
  store_notified_at: string | null;
  store_actioned_at: string | null;
  store_actioned_by: string | null;
  created_at: string;
}

const DD_STATUS: Record<string, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
  pending:  { label: "Pending",  bg: "bg-yellow-500/15", text: "text-yellow-300", icon: <Clock className="w-3 h-3" /> },
  notified: { label: "Notified", bg: "bg-blue-500/15",   text: "text-blue-300",   icon: <Send className="w-3 h-3" /> },
  actioned: { label: "Actioned", bg: "bg-green-500/15",  text: "text-green-300",  icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected: { label: "Rejected", bg: "bg-red-500/15",    text: "text-red-300",    icon: <AlertCircle className="w-3 h-3" /> },
};

const DD_FILTERS = [
  { value: "", label: "All" },
  { value: "pending",  label: "Pending" },
  { value: "notified", label: "Notified" },
  { value: "actioned", label: "Actioned" },
  { value: "rejected", label: "Rejected" },
];

function DrawdownRow({ dr, onUpdate }: { dr: DrawdownRequest; onUpdate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState(dr.notes || "");
  const qc = useQueryClient();

  const update = useMutation({
    mutationFn: async (payload: { status?: string; notes?: string }) => {
      const r = await fetch(`${BASE}/api/applications/drawdown/${dr.id}`, {
        method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["drawdowns"] }); qc.invalidateQueries({ queryKey: ["drawdown-pending-count"] }); onUpdate(); },
  });

  const s = DD_STATUS[dr.status] ?? DD_STATUS.pending;
  const amount = parseFloat(dr.amount_requested).toFixed(2);

  return (
    <div className="border border-white/10 rounded-xl bg-white/[0.03] overflow-hidden">
      <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}>
        <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${s.bg} ${s.text}`}>
          {s.icon}{s.label}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{dr.customer_name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {dr.retailer_name}{dr.branch_name ? ` — ${dr.branch_name}` : ""}
            {dr.collection_retailer_name && dr.collection_retailer_name !== dr.retailer_name && (
              <> · Collecting: {dr.collection_retailer_name}{dr.collection_branch_name ? ` — ${dr.collection_branch_name}` : ""}</>
            )}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-amber-300">${amount}</p>
          <p className="text-[10px] text-muted-foreground">{ago(dr.created_at)}</p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="border-t border-white/10 px-4 py-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground mb-0.5">Customer Phone</p><p>{dr.customer_phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Amount</p><p className="font-semibold">${amount}</p></div>
              {dr.facility_limit && <div><p className="text-xs text-muted-foreground mb-0.5">Facility Limit</p><p>${parseFloat(dr.facility_limit).toFixed(2)}</p></div>}
              {dr.facility_balance && <div><p className="text-xs text-muted-foreground mb-0.5">Balance</p><p>${parseFloat(dr.facility_balance).toFixed(2)}</p></div>}
              <div><p className="text-xs text-muted-foreground mb-0.5">Submitted</p><p>{fmt(dr.created_at)}</p></div>
              {dr.store_notified_at && <div><p className="text-xs text-muted-foreground mb-0.5">Notified</p><p>{fmt(dr.store_notified_at)}</p></div>}
              {dr.store_actioned_at && <div><p className="text-xs text-muted-foreground mb-0.5">Actioned By</p><p>{dr.store_actioned_by} · {fmt(dr.store_actioned_at)}</p></div>}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Internal Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
            </div>
            <div className="flex flex-wrap gap-2">
              {dr.status === "pending" && (
                <button onClick={() => update.mutate({ status: "notified", notes })} disabled={update.isPending}
                  className="px-3 py-1.5 rounded-lg bg-blue-500/20 text-blue-300 text-xs font-semibold hover:bg-blue-500/30 transition-colors flex items-center gap-1.5">
                  <Send className="w-3 h-3" /> Mark Notified
                </button>
              )}
              {dr.status !== "actioned" && (
                <button onClick={() => update.mutate({ status: "actioned", notes })} disabled={update.isPending}
                  className="px-3 py-1.5 rounded-lg bg-green-500/20 text-green-300 text-xs font-semibold hover:bg-green-500/30 transition-colors flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3" /> Mark Actioned
                </button>
              )}
              {dr.status !== "rejected" && dr.status !== "actioned" && (
                <button onClick={() => update.mutate({ status: "rejected", notes })} disabled={update.isPending}
                  className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 text-xs font-semibold hover:bg-red-500/30 transition-colors flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3" /> Reject
                </button>
              )}
              <button onClick={() => update.mutate({ notes })} disabled={update.isPending}
                className="px-3 py-1.5 rounded-lg bg-white/10 text-xs font-semibold hover:bg-white/15 transition-colors">
                {update.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save Notes"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DrawdownsTab() {
  const [statusFilter, setStatusFilter] = useState("");
  const { data: drawdowns = [], isLoading, refetch } = useQuery<DrawdownRequest[]>({
    queryKey: ["drawdowns", statusFilter],
    queryFn: async () => {
      const url = `${BASE}/api/applications/drawdown${statusFilter ? `?status=${statusFilter}` : ""}`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const pendingCount = drawdowns.filter(d => d.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">{pendingCount > 0 ? `${pendingCount} pending action` : "No pending drawdowns"}</p>
        <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>
      <div className="flex gap-2 flex-wrap">
        {DD_FILTERS.map(f => (
          <button key={f.value} onClick={() => setStatusFilter(f.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${statusFilter === f.value ? "bg-amber-500 text-black" : "bg-white/5 text-muted-foreground hover:bg-white/10"}`}>
            {f.label}{f.value === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : drawdowns.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ArrowDownCircle className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No drawdown requests{statusFilter ? ` with status "${statusFilter}"` : ""}</p>
        </div>
      ) : (
        <div className="space-y-2">{drawdowns.map(dr => <DrawdownRow key={dr.id} dr={dr} onUpdate={() => {}} />)}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4 — STORE MESSAGES
// ═══════════════════════════════════════════════════════════════════════════════

interface StoreMessage {
  id: number;
  retailer_id: number;
  branch_id: number | null;
  reference_type: string | null;
  reference_id: number | null;
  subject: string;
  body: string;
  is_read: boolean;
  retailer_name: string | null;
  branch_name: string | null;
  created_at: string;
}

interface Retailer {
  id: number;
  name: string;
  branch_id: number;
  branch_name: string;
}

function ComposeModal({ retailers, onClose, onSent }: { retailers: Retailer[]; onClose: () => void; onSent: () => void }) {
  const [retailerId, setRetailerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState("");

  const branches = retailers.filter(r => String(r.id) === retailerId);
  const retailerOptions = Array.from(new Map(retailers.map(r => [r.id, r.name])).entries());

  const send = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/applications/messages/admin`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retailer_id: parseInt(retailerId), branch_id: branchId ? parseInt(branchId) : null, subject, body }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => { onSent(); onClose(); },
    onError: () => setError("Failed to send. Please try again."),
  });

  const handleSend = () => {
    setError("");
    if (!retailerId) { setError("Please select a store."); return; }
    if (!subject.trim()) { setError("Subject is required."); return; }
    if (!body.trim()) { setError("Message is required."); return; }
    send.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#1a1b23] border border-white/10 rounded-2xl w-full max-w-lg p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">New Message to Store</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>
        {error && <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Retailer</label>
            <select value={retailerId} onChange={e => { setRetailerId(e.target.value); setBranchId(""); }}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40">
              <option value="">— Select retailer —</option>
              {retailerOptions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
            </select>
          </div>
          {branches.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Branch (optional)</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40">
                <option value="">All branches</option>
                {branches.map(b => <option key={b.branch_id} value={String(b.branch_id)}>{b.branch_name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Subject</label>
            <input type="text" value={subject} onChange={e => setSubject(e.target.value)} placeholder="Message subject…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Message</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="Write your message…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-amber-500/40" />
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl border border-white/10 text-sm text-muted-foreground hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSend} disabled={send.isPending}
            className="flex-1 px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2">
            {send.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function MessageRow({ msg }: { msg: StoreMessage }) {
  const [expanded, setExpanded] = useState(false);
  const storeName = [msg.retailer_name, msg.branch_name].filter(Boolean).join(" — ") || "Unknown Store";

  return (
    <div className={`border rounded-xl overflow-hidden transition-colors ${msg.is_read ? "border-white/10 bg-white/[0.02]" : "border-amber-500/20 bg-amber-500/[0.04]"}`}>
      <button className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors text-left" onClick={() => setExpanded(v => !v)}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${msg.is_read ? "bg-white/20" : "bg-amber-400"}`} />
        <Store className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{msg.subject}</p>
          <p className="text-xs text-muted-foreground truncate">To: {storeName}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[10px] font-semibold ${msg.is_read ? "text-muted-foreground" : "text-amber-400"}`}>{msg.is_read ? "Read" : "Unread"}</p>
          <p className="text-[10px] text-muted-foreground">{ago(msg.created_at)}</p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="border-t border-white/10 px-4 py-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-muted-foreground mb-0.5">Store</p><p>{storeName}</p></div>
              <div><p className="text-xs text-muted-foreground mb-0.5">Sent</p><p>{fmt(msg.created_at)}</p></div>
              {msg.reference_type && <div><p className="text-xs text-muted-foreground mb-0.5">Reference</p><p className="capitalize">{msg.reference_type} #{msg.reference_id}</p></div>}
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Message</p>
              <p className="text-sm text-foreground/90 whitespace-pre-wrap">{msg.body}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MessagesTab() {
  const [showCompose, setShowCompose] = useState(false);
  const qc = useQueryClient();

  const { data: messages = [], isLoading, refetch } = useQuery<StoreMessage[]>({
    queryKey: ["admin-messages"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/applications/messages/admin`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const { data: retailers = [] } = useQuery<Retailer[]>({
    queryKey: ["retailers-list"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/applications/retailers`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const unreadCount = messages.filter(m => !m.is_read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">{unreadCount > 0 ? `${unreadCount} unread by store` : "All messages read"}</p>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button onClick={() => setShowCompose(true)}
            className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors">
            <Plus className="w-4 h-4" /> New Message
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
      ) : messages.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No messages sent to stores yet</p>
          <button onClick={() => setShowCompose(true)}
            className="mt-4 px-4 py-2 rounded-xl bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors inline-flex items-center gap-2">
            <Plus className="w-4 h-4" /> Send First Message
          </button>
        </div>
      ) : (
        <div className="space-y-2">{messages.map(msg => <MessageRow key={msg.id} msg={msg} />)}</div>
      )}

      <AnimatePresence>
        {showCompose && (
          <ComposeModal retailers={retailers} onClose={() => setShowCompose(false)}
            onSent={() => { refetch(); qc.invalidateQueries({ queryKey: ["admin-messages"] }); }} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT PROCESSING MODAL
// ═══════════════════════════════════════════════════════════════════════════════

interface XeroInvoice {
  invoiceId: string;
  invoiceNumber: string;
  status: string;
  date: string;
  dueDate: string;
  total: number;
  amountDue: number;
  amountPaid: number;
  reference: string | null;
}

interface PaymentCandidate {
  customerId: number | null;
  fullName: string;
  phone: string | null;
  nationalId: string | null;
  xeroContactId: string | null;
  branchName: string | null;
  retailerName: string | null;
  score: number;
  invoices: XeroInvoice[];
  totalOutstanding: number;
}

interface BankAccount {
  accountId: string;
  code: string;
  name: string;
  currencyCode: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DISBURSEMENT MODAL
// ═══════════════════════════════════════════════════════════════════════════════

interface BankAccount {
  code: string;
  name: string;
  retailerMatch: string | null;
}

interface DisbursementResult {
  xeroTransactionId: string | null;
  xeroReference: string | null;
  amount: number;
  bankAccountCode: string;
  date: string;
  formitizeTaskUrl: string | null;
}

function DisbursementModal({ notification, onClose, onDone }: {
  notification: FNotification;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"matching" | "confirm" | "done" | "error">("matching");
  const [selected, setSelected] = useState<PaymentCandidate | null>(null);
  const [loanAmount, setLoanAmount] = useState("");
  const [disbursementDate, setDisbursementDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [bankCode, setBankCode] = useState("");
  const [description, setDescription] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<DisbursementResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Xero contact linking (for customers with name mismatches)
  const [xeroLinkOverrides, setXeroLinkOverrides] = useState<Record<number, string>>({});
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<{ contactId: string; name: string; email: string | null }[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkSaving, setLinkSaving] = useState(false);

  async function searchXeroContacts(q: string) {
    if (!q.trim()) return;
    setLinkSearching(true);
    try {
      const r = await fetch(`${BASE}/api/xero/contacts/search?q=${encodeURIComponent(q.trim())}`, { credentials: "include" });
      if (r.ok) setLinkResults(await r.json());
    } finally { setLinkSearching(false); }
  }

  async function saveXeroLink(customerId: number, contactId: string, contactName: string) {
    setLinkSaving(true);
    try {
      const r = await fetch(`${BASE}/api/customers/${customerId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xeroContactId: contactId }),
      });
      if (r.ok) {
        setXeroLinkOverrides(prev => ({ ...prev, [customerId]: contactId }));
        setLinkingId(null);
        setLinkSearch("");
        setLinkResults([]);
      }
    } finally { setLinkSaving(false); }
  }

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["disbursement-bank-accounts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/disbursements/bank-accounts`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load bank accounts");
      const d = await r.json();
      return d.bankAccounts;
    },
  });

  // Auto-select bank account when accounts load
  useEffect(() => {
    if (bankAccounts.length > 0 && !bankCode && notification.retailer_name) {
      const lower = notification.retailer_name.toLowerCase();
      const match = bankAccounts.find(b => b.retailerMatch && lower.includes(b.retailerMatch));
      if (match) setBankCode(match.code);
    }
  }, [bankAccounts, notification.retailer_name, bankCode]);

  const { data: candidates = [], isLoading: matchLoading } = useQuery<PaymentCandidate[]>({
    queryKey: ["disburse-match", notification.customer_name],
    queryFn: async () => {
      if (!notification.customer_name) return [];
      const r = await fetch(`${BASE}/api/payments/match-customer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: notification.customer_name,
          branchName: notification.branch_name ?? undefined,
          retailerName: notification.retailer_name ?? undefined,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      const d = await r.json();
      return Array.isArray(d) ? d : (d.candidates ?? []);
    },
    enabled: step === "matching",
  });

  const handleProcess = async () => {
    if (!selected || !bankCode || !loanAmount) return;
    setProcessing(true);
    try {
      const r = await fetch(`${BASE}/api/disbursements/process`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notificationId: notification.id,
          xeroContactId: selected.xeroContactId,
          customerName: selected.fullName,
          loanAmount: parseFloat(loanAmount),
          disbursementDate,
          bankAccountCode: bankCode,
          description: description || undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setErrorMsg(data.error ?? "Unknown error"); setStep("error"); return; }
      setResult(data);
      setStep("done");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Network error");
      setStep("error");
    } finally {
      setProcessing(false);
    }
  };

  const bankName = bankAccounts.find(b => b.code === bankCode)?.name ?? bankCode;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-lg bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">Process Disbursement</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {notification.customer_name} — {notification.retailer_name}{notification.branch_name ? ` / ${notification.branch_name}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">

          {/* STEP 1 — CUSTOMER MATCHING */}
          {step === "matching" && (
            <div className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Step 1 of 2 — Confirm customer</p>
                {matchLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> Searching for "{notification.customer_name}"…
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="p-4 rounded-lg bg-white/5 border border-white/10 text-sm text-white/50 text-center">
                    No matching customer found for "{notification.customer_name}".<br />
                    <span className="text-xs">You can only process disbursements for customers with a linked Xero contact.</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {candidates.map(c => {
                      const effectiveXeroId = c.xeroContactId ?? (c.customerId ? xeroLinkOverrides[c.customerId] ?? null : null);
                      const isSelected = selected?.customerId === c.customerId && selected?.xeroContactId === effectiveXeroId;
                      const isLinking = linkingId === c.customerId;
                      const effectiveCandidate: PaymentCandidate = { ...c, xeroContactId: effectiveXeroId };
                      return (
                        <div key={c.customerId ?? c.xeroContactId} className="space-y-0">
                          <button
                            onClick={() => {
                              if (!effectiveXeroId) return;
                              setSelected(s => s?.customerId === c.customerId ? null : effectiveCandidate);
                            }}
                            className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                              isSelected
                                ? "border-emerald-500/50 bg-emerald-500/10"
                                : effectiveXeroId
                                  ? "border-white/10 bg-white/5 hover:bg-white/8 cursor-pointer"
                                  : "border-white/10 bg-white/5 cursor-default"
                            } ${isLinking ? "rounded-b-none border-b-0" : ""}`}
                          >
                            <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0 mt-0.5">
                              <User className="w-4 h-4 text-white/60" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white">{c.fullName}</p>
                              <p className="text-xs text-white/40 mt-0.5">{c.phone || "—"} · ID: {c.nationalId || "—"}</p>
                              {effectiveXeroId ? (
                                <p className="text-xs text-emerald-400/70 mt-0.5 flex items-center gap-1">
                                  <CheckCircle2 className="w-3 h-3" />Xero linked
                                  {xeroLinkOverrides[c.customerId!] && <span className="text-emerald-400/50">(just linked)</span>}
                                </p>
                              ) : (
                                <p className="text-xs text-red-400/70 mt-0.5 flex items-center gap-1"><XCircle className="w-3 h-3" />No Xero contact — cannot disburse</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                              {!effectiveXeroId && c.customerId != null && (
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (isLinking) {
                                      setLinkingId(null); setLinkSearch(""); setLinkResults([]);
                                    } else {
                                      setLinkingId(c.customerId);
                                      setLinkSearch(c.fullName);
                                      setLinkResults([]);
                                      setTimeout(() => searchXeroContacts(c.fullName), 50);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-blue-500/15 border border-blue-500/30 text-blue-300 hover:bg-blue-500/25 transition-all"
                                >
                                  <Link2 className="w-3 h-3" />
                                  {isLinking ? "Cancel" : "Link Xero"}
                                </button>
                              )}
                            </div>
                          </button>

                          {/* Inline Xero contact search panel */}
                          {isLinking && c.customerId != null && (
                            <div className="border border-white/10 border-t-blue-500/30 rounded-b-xl bg-[#12122a] px-4 py-3 space-y-3">
                              <p className="text-[11px] text-blue-300/80 font-medium">
                                Search Xero for the correct contact — name may differ from Central.
                              </p>
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={linkSearch}
                                  onChange={e => setLinkSearch(e.target.value)}
                                  onKeyDown={e => e.key === "Enter" && searchXeroContacts(linkSearch)}
                                  placeholder="e.g. Saineti Richard Makuvaza"
                                  className="flex-1 bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-blue-500/50 placeholder:text-white/20"
                                />
                                <button
                                  onClick={() => searchXeroContacts(linkSearch)}
                                  disabled={linkSearching || !linkSearch.trim()}
                                  className="px-3 py-2 rounded-lg bg-blue-500/20 border border-blue-500/30 text-blue-300 hover:bg-blue-500/30 disabled:opacity-40 transition-all"
                                >
                                  {linkSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                </button>
                              </div>

                              {linkResults.length > 0 && (
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                  {linkResults.map(contact => (
                                    <button
                                      key={contact.contactId}
                                      disabled={linkSaving}
                                      onClick={() => saveXeroLink(c.customerId!, contact.contactId, contact.name)}
                                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-blue-500/15 border border-white/10 hover:border-blue-500/30 text-left transition-all group"
                                    >
                                      <div>
                                        <p className="text-sm font-medium text-white group-hover:text-blue-200">{contact.name}</p>
                                        {contact.email && <p className="text-[11px] text-white/40">{contact.email}</p>}
                                      </div>
                                      {linkSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> : <Link2 className="w-3.5 h-3.5 text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
                                    </button>
                                  ))}
                                </div>
                              )}

                              {!linkSearching && linkResults.length === 0 && linkSearch.trim() && (
                                <p className="text-xs text-white/30 text-center py-1">No Xero contacts found — try a different name or surname only.</p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-white/50 hover:text-white/70 transition-colors">Cancel</button>
                <button
                  onClick={() => setStep("confirm")}
                  disabled={!selected || !selected.xeroContactId}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next — Confirm Details
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — CONFIRM DETAILS */}
          {step === "confirm" && selected && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Step 2 of 2 — Disbursement details</p>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <User className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">{selected.fullName}</p>
                  <p className="text-xs text-white/40">{selected.phone || "—"}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Loan Amount (USD)</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={loanAmount}
                    onChange={e => setLoanAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-medium block mb-1.5">Disbursement Date</label>
                  <input
                    type="date"
                    value={disbursementDate}
                    onChange={e => setDisbursementDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1.5">Bank Account</label>
                <select
                  value={bankCode}
                  onChange={e => setBankCode(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                >
                  <option value="">— Select bank account —</option>
                  {bankAccounts.map(b => (
                    <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1.5">Description (optional)</label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder={`Loan disbursement — ${selected.fullName}`}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
              </div>

              {/* Accounting summary */}
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Xero entry preview</p>
                <div className="flex justify-between text-xs text-white/70">
                  <span>Type</span><span className="font-medium text-white">Spend Money</span>
                </div>
                <div className="flex justify-between text-xs text-white/70">
                  <span>Bank Account</span><span className="font-medium text-white">{bankName} ({bankCode || "—"})</span>
                </div>
                <div className="flex justify-between text-xs text-white/70">
                  <span>Account Code</span><span className="font-medium text-white">621 — Loans Disbursed</span>
                </div>
                <div className="flex justify-between text-xs text-white/70">
                  <span>Amount</span>
                  <span className="font-semibold text-emerald-300">{loanAmount ? `$${parseFloat(loanAmount).toFixed(2)}` : "—"}</span>
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-1">
                <button onClick={() => setStep("matching")} className="px-4 py-2 rounded-lg text-sm text-white/50 hover:text-white/70 transition-colors">← Back</button>
                <button
                  onClick={handleProcess}
                  disabled={processing || !bankCode || !loanAmount || parseFloat(loanAmount) <= 0}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {processing ? <><Loader2 className="w-4 h-4 animate-spin" />Processing…</> : <><ArrowDownCircle className="w-4 h-4" />Disburse in Xero</>}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — DONE */}
          {step === "done" && result && (
            <div className="space-y-4 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-white">Disbursement recorded</p>
                <p className="text-sm text-muted-foreground mt-1">${result.amount.toFixed(2)} posted to Xero via {bankAccounts.find(b => b.code === result.bankAccountCode)?.name ?? result.bankAccountCode}</p>
              </div>
              {result.xeroTransactionId && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-left space-y-1">
                  <p className="text-xs text-muted-foreground">Xero Transaction ID</p>
                  <p className="text-xs text-white font-mono break-all">{result.xeroTransactionId}</p>
                  <p className="text-xs text-muted-foreground mt-1.5">Account 621 debited · ready for manual reconciliation</p>
                </div>
              )}
              {result.formitizeTaskUrl && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left space-y-2">
                  <p className="text-xs text-amber-300/80 font-medium">Next step — complete in Formitize</p>
                  <p className="text-xs text-white/50">Tick boxes 4–6 (Loan Agreement Signed, Sales Invoice Received, Bank Account Debited) and re-submit the agreement.</p>
                  <a
                    href={result.formitizeTaskUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium hover:bg-amber-500/25 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Open Formitize Task
                  </a>
                </div>
              )}
              <button onClick={onDone} className="w-full py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm font-medium hover:bg-emerald-500/25 transition-colors">
                Done
              </button>
            </div>
          )}

          {/* STEP 4 — ERROR */}
          {step === "error" && (
            <div className="space-y-4 text-center py-4">
              <div className="w-14 h-14 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto">
                <XCircle className="w-7 h-7 text-red-400" />
              </div>
              <div>
                <p className="text-base font-semibold text-white">Disbursement failed</p>
                <p className="text-sm text-muted-foreground mt-1">The Xero transaction was not created. No changes were made.</p>
              </div>
              <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-left">
                <p className="text-xs text-red-300">{errorMsg}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep("confirm")} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/8 transition-colors">← Try again</button>
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/60 text-sm hover:bg-white/8 transition-colors">Close</button>
              </div>
            </div>
          )}

        </div>
      </motion.div>
    </motion.div>
  );
}

function PaymentModal({ notification, onClose, onDone }: {
  notification: FNotification;
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"matching" | "allocating" | "done" | "error">("matching");
  const [selected, setSelected] = useState<PaymentCandidate | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [bankCode, setBankCode] = useState("");
  const [markLoanComplete, setMarkLoanComplete] = useState(true);
  const [resultErrors, setResultErrors] = useState<string[]>([]);
  const [lrAutoCompleted, setLrAutoCompleted] = useState(false);
  const [creditPosted, setCreditPosted] = useState<number>(0);

  const paymentAmount = parseFloat(String(notification.payment_amount ?? 0)) || 0;

  const { data: matchData, isLoading: matching } = useQuery<{ candidates: PaymentCandidate[] }>({
    queryKey: ["payment-match", notification.id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/payments/match-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerName: notification.customer_name ?? "",
          branchName: notification.branch_name ?? "",
          retailerName: notification.retailer_name ?? "",
        }),
      });
      if (!r.ok) throw new Error("Match failed");
      return r.json();
    },
  });

  const { data: bankAccounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["bank-accounts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/payments/bank-accounts`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  function selectCandidate(c: PaymentCandidate) {
    setSelected(c);
    // Sort oldest first — excess payment goes to oldest arrears before newer invoices
    const outstanding = [...c.invoices].sort((a, b) => {
      const aDate = a.date ? new Date(a.date).getTime() : 0;
      const bDate = b.date ? new Date(b.date).getTime() : 0;
      return aDate - bDate;
    });
    const alloc: Record<string, string> = {};
    if (paymentAmount > 0) {
      // Known payment amount — allocate oldest-first, capped at each invoice's AmountDue.
      // Any remainder after all invoices is an overpayment credit shown below.
      let remaining = paymentAmount;
      for (const inv of outstanding) {
        if (remaining <= 0.005) { alloc[inv.invoiceId] = "0.00"; continue; }
        const apply = Math.min(remaining, inv.amountDue);
        alloc[inv.invoiceId] = apply.toFixed(2);
        remaining -= apply;
      }
    } else {
      // Unknown payment amount — pre-fill each invoice with its full outstanding balance
      for (const inv of outstanding) {
        alloc[inv.invoiceId] = inv.amountDue.toFixed(2);
      }
    }
    setAllocations(alloc);
    setStep("allocating");
  }

  const totalAllocated = Object.values(allocations).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  const unallocated = paymentAmount - totalAllocated;

  const skipMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/formitize/notifications/${notification.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status: "actioned" }),
      });
      if (!r.ok) throw new Error("Skip failed");
      return r.json();
    },
    onSuccess: () => { onDone(); },
  });

  const processMutation = useMutation({
    mutationFn: async () => {
      const allocs = Object.entries(allocations)
        .map(([invoiceId, amount]) => ({ invoiceId, amount: parseFloat(amount) || 0 }))
        .filter(a => a.amount > 0);
      const r = await fetch(`${BASE}/api/payments/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          notificationId: notification.id,
          xeroContactId: selected!.xeroContactId,
          paymentDate,
          bankAccountCode: bankCode,
          allocations: allocs,
          markLoanComplete,
          customerId: selected!.customerId,
          // Any payment amount above the sum of invoice allocations — the backend
          // will apply this to other outstanding invoices oldest-first, then post
          // any remainder as a Xero Overpayment (credit balance on account).
          creditAmount: unallocated > 0.01 ? Math.round(unallocated * 100) / 100 : 0,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Processing failed");
      return data;
    },
    onSuccess: (data) => {
      if (data.errors?.length) setResultErrors(data.errors);
      setLrAutoCompleted(!!data.autoCompleted);
      if (data.overpaymentPosted && data.overpaymentAmount > 0) setCreditPosted(data.overpaymentAmount);
      setStep("done");
      onDone();
    },
    onError: (err: any) => {
      setResultErrors([String(err.message)]);
      setStep("error");
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-2xl bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-foreground">Process Payment</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {notification.customer_name} — {notification.retailer_name}{notification.branch_name ? ` / ${notification.branch_name}` : ""}
              {paymentAmount > 0 && <span className="ml-2 text-amber-300 font-medium">${paymentAmount.toFixed(2)}</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Duplicate warning banner */}
        {notification.is_duplicate_warning && (
          <div className="mx-6 mt-4 flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/25">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300">Possible duplicate payment</p>
              <p className="text-xs text-red-300/70 mt-0.5">
                Another payment notification for <strong>{notification.customer_name}</strong> with the same amount was received within the last 72 hours. Check if this has already been processed in Xero before continuing.
              </p>
            </div>
          </div>
        )}

        {/* Previous processing error banner */}
        {notification.processing_error && (
          <div className="mx-6 mt-3 flex items-start gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/25">
            <AlertCircle className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-300">Previous attempt failed</p>
              <p className="text-xs text-orange-300/70 mt-0.5">{notification.processing_error}</p>
            </div>
          </div>
        )}

        <div className="p-6 max-h-[70vh] overflow-y-auto">

          {/* STEP 1 — CUSTOMER MATCHING */}
          {step === "matching" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground mb-4">Select the correct customer to apply this payment against.</p>
              {matching && (
                <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              )}
              {!matching && (matchData?.candidates ?? []).length === 0 && (
                <div className="text-center py-8 space-y-2">
                  <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                  <p className="text-sm text-muted-foreground">No matching customers found in Xero.</p>
                  <p className="text-xs text-muted-foreground">The name may be spelled differently in Xero. Use <strong className="text-foreground">Mark Done</strong> below if you've handled this manually — then process the payment directly in Xero.</p>
                </div>
              )}
              {(matchData?.candidates ?? []).map(c => (
                <button
                  key={c.xeroContactId ?? c.customerId}
                  onClick={() => selectCandidate(c)}
                  className="w-full text-left p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-amber-500/30 transition-all group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground">{c.fullName}</p>
                        {c.score >= 2 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">Best match</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                        {c.phone && <span>{c.phone}</span>}
                        {c.branchName && <span className="flex items-center gap-1"><Store className="w-3 h-3" />{c.retailerName} / {c.branchName}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-amber-300">${c.totalOutstanding.toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">{c.invoices.length} invoice{c.invoices.length !== 1 ? "s" : ""} outstanding</p>
                    </div>
                  </div>
                  {c.invoices.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/5 flex flex-wrap gap-2">
                      {c.invoices.slice(0, 3).map(inv => (
                        <span key={inv.invoiceId} className="text-[10px] bg-white/5 px-2 py-0.5 rounded-full text-muted-foreground">
                          {inv.invoiceNumber} — ${inv.amountDue.toFixed(2)}
                        </span>
                      ))}
                      {c.invoices.length > 3 && <span className="text-[10px] text-muted-foreground">+{c.invoices.length - 3} more</span>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* STEP 2 — ALLOCATION */}
          {step === "allocating" && selected && (
            <div className="space-y-5">
              {/* Customer confirmed */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                <span className="text-sm font-medium text-green-300">{selected.fullName}</span>
                <button onClick={() => setStep("matching")} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Change</button>
              </div>

              {/* Invoice allocation */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Outstanding Invoices</p>
                {selected.invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No outstanding invoices in Xero for this contact.</p>
                ) : (
                  <div className="space-y-2">
                    {selected.invoices.map(inv => (
                      <div key={inv.invoiceId} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium text-foreground">{inv.invoiceNumber}</span>
                            {inv.reference && <span className="text-xs text-muted-foreground truncate">{inv.reference}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">Due: ${inv.amountDue.toFixed(2)} &nbsp;·&nbsp; Date: {inv.date?.slice(0, 10) ?? "—"}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">$</span>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={allocations[inv.invoiceId] ?? "0.00"}
                            onChange={e => setAllocations(prev => ({ ...prev, [inv.invoiceId]: e.target.value }))}
                            onWheel={e => (e.target as HTMLInputElement).blur()}
                            className="w-24 bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-sm text-right text-foreground focus:outline-none focus:border-amber-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Allocation summary */}
                {paymentAmount > 0 ? (
                  <div className={`mt-3 p-3 rounded-lg text-sm flex items-center justify-between ${
                    Math.abs(unallocated) < 0.01 ? "bg-green-500/10 border border-green-500/20" :
                    unallocated > 0 ? "bg-blue-500/10 border border-blue-500/20" :
                    "bg-red-500/10 border border-red-500/20"
                  }`}>
                    <span className="text-muted-foreground">
                      ${paymentAmount.toFixed(2)} received — ${totalAllocated.toFixed(2)} to invoices
                    </span>
                    <span className={`font-semibold ${Math.abs(unallocated) < 0.01 ? "text-green-400" : unallocated > 0 ? "text-blue-300" : "text-red-400"}`}>
                      {Math.abs(unallocated) < 0.01
                        ? "Fully allocated"
                        : unallocated > 0
                          ? `$${unallocated.toFixed(2)} → credit to account`
                          : `Over by $${Math.abs(unallocated).toFixed(2)}`}
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 p-3 rounded-lg text-sm flex items-center justify-between bg-white/5 border border-white/10">
                    <span className="text-muted-foreground">${totalAllocated.toFixed(2)} allocated</span>
                    <span className="text-muted-foreground text-xs">Adjust amounts if needed</span>
                  </div>
                )}
              </div>

              {/* Payment date & bank account */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Payment Date</label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={e => setPaymentDate(e.target.value)}
                    className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Bank Account</label>
                  <select
                    value={bankCode}
                    onChange={e => setBankCode(e.target.value)}
                    className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-amber-500/50"
                  >
                    <option value="">Select account…</option>
                    {bankAccounts.map(a => (
                      <option key={a.accountId} value={a.code}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mark loan complete */}
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markLoanComplete}
                  onChange={e => setMarkLoanComplete(e.target.checked)}
                  className="w-4 h-4 rounded accent-amber-500"
                />
                <span className="text-sm text-foreground">Mark loan as complete in Loan Register</span>
              </label>
            </div>
          )}

          {/* STEP — DONE */}
          {step === "done" && (
            <div className="py-6 space-y-4">
              <div className="text-center space-y-2">
                <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto" />
                <p className="text-base font-semibold text-foreground">Payment processed in Xero</p>
                {resultErrors.length > 0 && (
                  <div className="text-left mt-2 space-y-1">
                    <p className="text-xs font-semibold text-amber-300">Some invoices had warnings:</p>
                    {resultErrors.map((e, i) => <p key={i} className="text-xs text-muted-foreground">{e}</p>)}
                  </div>
                )}
              </div>

              {/* Credit / overpayment confirmation */}
              {creditPosted > 0 && (
                <div className="mx-2 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-blue-300">${creditPosted.toFixed(2)} posted as credit balance</p>
                      <p className="text-xs text-blue-300/70 mt-1">
                        An overpayment of <strong>${creditPosted.toFixed(2)}</strong> has been posted to the customer's Xero account as a credit balance — available to offset future invoices.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Loan Register follow-up */}
              {lrAutoCompleted ? (
                <div className="mx-2 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-emerald-300">Loan Register automatically completed</p>
                      <p className="text-xs text-emerald-300/70 mt-1">
                        The invoice balance reached $0 — this loan was automatically marked as <strong>Completed</strong> in the Loan Register.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mx-2 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-300">Check Loan Register status</p>
                      <p className="text-xs text-amber-300/70 mt-1">
                        If this loan is now fully paid, use the <strong>Loan Register tab</strong> in Notifications to mark it as Completed — or open the Loan Register directly.
                      </p>
                      <a
                        href="https://loan-manager-automate.replit.app/active"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open Loan Register → Active Loans
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP — ERROR */}
          {step === "error" && (
            <div className="py-8 text-center space-y-3">
              <XCircle className="w-12 h-12 text-red-400 mx-auto" />
              <p className="text-base font-semibold text-foreground">Processing failed</p>
              {resultErrors.map((e, i) => <p key={i} className="text-xs text-red-400 mt-1">{e}</p>)}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            {step === "done" ? "Close" : "Cancel"}
          </button>
          <div className="flex items-center gap-2">
            {step === "matching" && !matching && (
              <button
                onClick={() => skipMutation.mutate()}
                disabled={skipMutation.isPending}
                title="Mark as done — you will process this payment manually in Xero"
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground border border-white/10 hover:border-white/20 hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {skipMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Mark Done
              </button>
            )}
            {step === "allocating" && (
              <button
                onClick={() => processMutation.mutate()}
                disabled={!bankCode || processMutation.isPending || selected?.invoices.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-black disabled:opacity-50 transition-colors"
              >
                {processMutation.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                  : <><ArrowRight className="w-4 h-4" /> Apply Payment in Xero</>}
              </button>
            )}
            {step === "error" && (
              <button onClick={() => setStep("allocating")} className="px-4 py-2 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/15 text-foreground transition-colors">
                Try Again
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5 — WHATSAPP
// ═══════════════════════════════════════════════════════════════════════════════

interface WaConversation {
  waId: string;
  senderName: string | null;
  lastMessage: string | null;
  direction: string;
  lastAt: string;
  unreadCount: number;
}

interface WaMessage {
  id: number;
  waId: string;
  senderName: string | null;
  messageText: string | null;
  messageType: string;
  direction: string;
  status: string;
  createdAt: string;
}

function MessageTicks({ status }: { status: string }) {
  if (status === "read") {
    return (
      <span className="inline-flex items-center ml-1" title="Read">
        <svg className="w-3.5 h-3 text-blue-300" viewBox="0 0 18 11" fill="currentColor">
          <path d="M1 5.5L5.5 10L12 1M6 5.5L10.5 10L17 1" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  if (status === "delivered") {
    return (
      <span className="inline-flex items-center ml-1" title="Delivered">
        <svg className="w-3.5 h-3 text-green-200" viewBox="0 0 18 11" fill="none">
          <path d="M1 5.5L5.5 10L12 1M6 5.5L10.5 10L17 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center ml-1 text-red-300" title="Failed to deliver">
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      </span>
    );
  }
  // "sent" — single grey tick
  return (
    <span className="inline-flex items-center ml-1" title="Sent">
      <svg className="w-3 h-3 text-green-200" viewBox="0 0 12 11" fill="none">
        <path d="M1 5.5L5 9.5L11 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

function WhatsAppTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [reply, setReply] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateParams, setTemplateParams] = useState<Record<string, string>>({});

  const { data: convData, isLoading: loadingConvs } = useQuery<{
    configured: boolean;
    conversations: WaConversation[];
  }>({
    queryKey: ["wa-conversations"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/whatsapp/conversations`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const { data: messages = [], isLoading: loadingMsgs } = useQuery<WaMessage[]>({
    queryKey: ["wa-messages", selected?.waId],
    enabled: Boolean(selected),
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/whatsapp/conversations/${selected!.waId}/messages`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
      qc.invalidateQueries({ queryKey: ["wa-unread"] });
      return r.json();
    },
    refetchInterval: 15_000,
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/whatsapp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ waId: selected!.waId, messageText: reply }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["wa-messages", selected?.waId] });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
  });

  const { data: templatesData } = useQuery<{ templates: Array<{ name: string; body: string; params: string[]; headerType: string | null }> }>({
    queryKey: ["wa-templates"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/whatsapp/templates`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  const sendTemplateMutation = useMutation({
    mutationFn: async ({ templateName, params }: { templateName: string; params: Array<{ name: string; value: string }> }) => {
      const r = await fetch(`${BASE}/api/whatsapp/send-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ waId: selected!.waId, templateName, parameters: params }),
      });
      if (!r.ok) { const e = await r.json(); throw new Error(e.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => {
      setShowTemplates(false);
      setSelectedTemplate(null);
      setTemplateParams({});
      qc.invalidateQueries({ queryKey: ["wa-messages", selected?.waId] });
      qc.invalidateQueries({ queryKey: ["wa-conversations"] });
    },
  });

  const templates = templatesData?.templates ?? [];
  const activeTpl = templates.find(t => t.name === selectedTemplate) ?? null;

  if (loadingConvs) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (!convData?.configured) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
            <MessageCircle className="w-8 h-8 text-green-400" />
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-foreground">WhatsApp Not Yet Connected</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Once your WATI account is approved, provide the API endpoint URL and API token and WhatsApp conversations will appear here.
          </p>
        </div>
        <div className="inline-block rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-left text-xs text-muted-foreground space-y-1">
          <p><span className="text-foreground font-medium">Environment variable 1:</span> WATI_API_URL</p>
          <p><span className="text-foreground font-medium">Environment variable 2:</span> WATI_API_TOKEN</p>
        </div>
      </div>
    );
  }

  const conversations = convData.conversations ?? [];

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden" style={{ minHeight: 480 }}>
      <div className="flex h-full" style={{ minHeight: 480 }}>

        {/* Conversation list */}
        <div className="w-64 shrink-0 border-r border-white/10 overflow-y-auto" style={{ maxHeight: 600 }}>
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.waId}
                onClick={() => setSelected(conv)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors",
                  selected?.waId === conv.waId && "bg-white/10"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center shrink-0">
                      <Phone className="w-3.5 h-3.5 text-green-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground truncate">{conv.senderName ?? conv.waId}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{conv.lastMessage ?? "—"}</p>
                    </div>
                  </div>
                  {conv.unreadCount > 0 && (
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-green-500 text-[10px] font-bold text-white">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1 text-right">{ago(conv.lastAt)}</p>
              </button>
            ))
          )}
        </div>

        {/* Message thread */}
        <div className="flex-1 flex flex-col" style={{ maxHeight: 600 }}>
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
              <MessageCircle className="w-8 h-8 opacity-30" />
              <span>Select a conversation</span>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center">
                  <Phone className="w-3 h-3 text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{selected.senderName ?? selected.waId}</p>
                  <p className="text-[11px] text-muted-foreground">+{selected.waId}</p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ maxHeight: 420 }}>
                {loadingMsgs ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                ) : messages.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-8">No messages yet</p>
                ) : (
                  messages.map(msg => (
                    <div key={msg.id} className={cn("flex", msg.direction === "outbound" ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[70%] px-3 py-2 rounded-2xl text-sm",
                        msg.direction === "outbound"
                          ? "bg-green-600 text-white rounded-br-sm"
                          : "bg-white/10 text-foreground rounded-bl-sm"
                      )}>
                        <p>{msg.messageText ?? "[media]"}</p>
                        <p className={cn("text-[10px] mt-0.5 flex items-center justify-end gap-0.5", msg.direction === "outbound" ? "text-green-200" : "text-muted-foreground")}>
                          {fmt(msg.createdAt)}
                          {msg.direction === "outbound" && <MessageTicks status={msg.status} />}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Template picker panel */}
              {showTemplates && (
                <div className="mx-4 mb-1 rounded-xl border border-white/10 bg-[#1a2433] p-3 space-y-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Send a Template</p>
                    <button onClick={() => { setShowTemplates(false); setSelectedTemplate(null); setTemplateParams({}); }} className="text-muted-foreground hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {templates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No approved templates found.</p>
                  ) : templates.map(tpl => (
                    <div key={tpl.name} className={cn("rounded-lg border p-2.5 cursor-pointer transition-colors", selectedTemplate === tpl.name ? "border-green-500/40 bg-green-500/10" : "border-white/10 bg-white/5 hover:bg-white/8")}
                      onClick={() => { setSelectedTemplate(tpl.name); setTemplateParams({}); }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-white">{tpl.name}</span>
                        {tpl.headerType && <span className="text-[10px] text-muted-foreground capitalize">{tpl.headerType}</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{tpl.body || "(no preview)"}</p>
                      {selectedTemplate === tpl.name && (
                        <div className="mt-2 space-y-1.5" onClick={e => e.stopPropagation()}>
                          {tpl.params.map(param => (
                            <input
                              key={param}
                              value={templateParams[param] ?? ""}
                              onChange={e => setTemplateParams(prev => ({ ...prev, [param]: e.target.value }))}
                              placeholder={param}
                              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-green-500/50"
                            />
                          ))}
                          <button
                            onClick={() => {
                              const params = tpl.params.map(p => ({ name: p, value: templateParams[p] ?? "" }));
                              const allFilled = tpl.params.every(p => templateParams[p]?.trim());
                              if (!allFilled && tpl.params.length > 0) return;
                              sendTemplateMutation.mutate({ templateName: tpl.name, params });
                            }}
                            disabled={sendTemplateMutation.isPending || (tpl.params.length > 0 && !tpl.params.every(p => templateParams[p]?.trim()))}
                            className="w-full mt-1 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded text-xs text-white font-medium transition-colors flex items-center justify-center gap-1.5"
                          >
                            {sendTemplateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                            Send "{tpl.name}"
                          </button>
                          {sendTemplateMutation.isError && (
                            <p className="text-[10px] text-red-400">{String(sendTemplateMutation.error)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Reply box */}
              <div className="px-4 py-3 border-t border-white/10 flex gap-2">
                <button
                  onClick={() => { setShowTemplates(v => !v); setSelectedTemplate(null); setTemplateParams({}); }}
                  title="Send a template message"
                  className={cn("px-2.5 py-2 rounded-lg border text-xs font-medium transition-colors flex items-center gap-1.5",
                    showTemplates
                      ? "bg-green-600/20 border-green-500/40 text-green-400"
                      : "bg-white/5 border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20"
                  )}
                >
                  <LayoutTemplate className="w-4 h-4" />
                </button>
                <input
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && reply.trim()) sendMutation.mutate(); }}
                  placeholder="Type a reply… (session messages require customer to message first)"
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-green-500/50"
                />
                <button
                  onClick={() => reply.trim() && sendMutation.mutate()}
                  disabled={!reply.trim() || sendMutation.isPending}
                  className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-white transition-colors"
                >
                  {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>

              {sendMutation.isError && (
                <p className="px-4 pb-2 text-xs text-red-400">{String(sendMutation.error)}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = "formitize" | "loans" | "drawdowns" | "messages" | "whatsapp";

interface TabDef {
  id: Tab;
  label: string;
  icon: React.ReactNode;
  badgeKey?: string;
}

const ADMIN_TABS: Tab[] = ["formitize", "loans", "drawdowns", "messages"];

export default function ActivityPage() {
  const { user } = useStaffAuth();
  const isAdmin = user?.role === "super_admin";

  const [tab, setTab] = useState<Tab>(() => isAdmin ? "formitize" : "whatsapp");

  // If user role loads and they're not an admin but on an admin-only tab, redirect to whatsapp
  useEffect(() => {
    if (user && !isAdmin && ADMIN_TABS.includes(tab)) {
      setTab("whatsapp");
    }
  }, [user, isAdmin, tab]);

  const { data: counts } = useQuery<CountsResponse>({
    queryKey: ["notification-counts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/formitize/notifications/counts`, { credentials: "include" });
      if (!r.ok) return { breakdown: [], newTotal: 0 };
      return r.json();
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const { data: ddCount } = useQuery<{ count: number }>({
    queryKey: ["drawdown-pending-count"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/applications/drawdown/pending-count`, { credentials: "include" });
      if (!r.ok) return { count: 0 };
      return r.json();
    },
    enabled: isAdmin,
    refetchInterval: 30_000,
  });

  const { data: waUnread } = useQuery<{ count: number }>({
    queryKey: ["wa-unread"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/whatsapp/unread-count`, { credentials: "include" });
      if (!r.ok) return { count: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const formitizeBadge = counts?.newTotal ?? 0;
  const drawdownBadge  = ddCount?.count ?? 0;
  const waBadge        = waUnread?.count ?? 0;

  const ALL_TABS: TabDef[] = [
    { id: "formitize",  label: "Formitize",       icon: <Bell className="w-4 h-4" /> },
    { id: "loans",      label: "Loan Requests",   icon: <Egg className="w-4 h-4" /> },
    { id: "drawdowns",  label: "Drawdowns",       icon: <ArrowDownCircle className="w-4 h-4" /> },
    { id: "messages",   label: "Store Messages",  icon: <MessageSquare className="w-4 h-4" /> },
    { id: "whatsapp",   label: "WhatsApp",         icon: <MessageCircle className="w-4 h-4" /> },
  ];

  const TABS = isAdmin ? ALL_TABS : ALL_TABS.filter(t => !ADMIN_TABS.includes(t.id));

  const getBadge = (id: Tab) => {
    if (id === "formitize") return formitizeBadge;
    if (id === "drawdowns") return drawdownBadge;
    if (id === "whatsapp")  return waBadge;
    return 0;
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Activity</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {isAdmin
            ? "All inbound events, requests, and store communications in one place"
            : "Store communications and WhatsApp — additional sections are admin-only"}
        </p>
      </div>

      <div className="flex gap-1 bg-white/5 rounded-xl p-1 flex-wrap">
        {TABS.map(t => {
          const badge = getBadge(t.id);
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === t.id ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground"}`}>
              {t.icon}
              {t.label}
              {badge > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {ADMIN_TABS.includes(tab) && !isAdmin ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
            <Lock className="w-6 h-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-base font-semibold text-foreground">Admin access required</p>
            <p className="text-sm text-muted-foreground mt-1">This section is restricted to the principal administrator.</p>
          </div>
        </div>
      ) : (
        <>
          {tab === "formitize"  && <FormitizeTab />}
          {tab === "loans"      && <LoansTab />}
          {tab === "drawdowns"  && <DrawdownsTab />}
          {tab === "messages"   && <MessagesTab />}
          {tab === "whatsapp"   && <WhatsAppTab />}
        </>
      )}
    </div>
  );
}
