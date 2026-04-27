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
  LayoutTemplate, Search, Link2, UserPlus, Download, Clipboard, Trash2, Pencil, RotateCcw, FolderOpen,
  Receipt,
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
  is_delinquent_warning: boolean;
  delinquent_match: string | null;
  processing_error: string | null;
  processed_at: string | null;
  status: "new" | "actioned";
  notes: string | null;
  created_at: string;
  // Joined from agreements table (agreement-type notifications only)
  agreement_id: number | null;
  loan_amount: number | null;
  facility_fee_amount: number | null;
  interest_amount: number | null;
  xero_invoice_id: string | null;
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

function NotificationCard({ n, onAction, loading, onProcessPayment, onProcessDisbursement, onFileCRM, onViewProfile, onReassigned, onRaiseInvoice }: {
  n: FNotification;
  onAction: () => void;
  loading: boolean;
  onProcessPayment?: () => void;
  onProcessDisbursement?: () => void;
  onFileCRM?: (note: string) => void;
  onViewProfile?: () => void;
  onReassigned?: (retailerName: string, branchName: string | null) => void;
  onRaiseInvoice?: () => void;
}) {
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [selectedDocType, setSelectedDocType] = useState("");

  // ── Branch reassign state ─────────────────────────────────────────
  const [showReassign, setShowReassign] = useState(false);
  const [rRetailers, setRRetailers] = useState<Array<{ id: number; name: string }>>([]);
  const [rBranches, setRBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [rRetailerId, setRRetailerId] = useState("");
  const [rBranchId, setRBranchId] = useState("");
  const [rSaving, setRSaving] = useState(false);
  const [rError, setRError] = useState<string | null>(null);

  const openReassign = async () => {
    setShowReassign(true);
    setRError(null);
    setRBranchId("");
    try {
      const res = await fetch(`${BASE}/api/retailers`, { credentials: "include" });
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.retailers ?? []);
      setRRetailers(list);
      // Pre-select current retailer if we can match by name
      const current = list.find((r: any) => r.name === n.retailer_name);
      if (current) {
        setRRetailerId(String(current.id));
        const bRes = await fetch(`${BASE}/api/retailers/${current.id}/branches`, { credentials: "include" });
        const bData = await bRes.json();
        setRBranches(Array.isArray(bData) ? bData : (bData.branches ?? []));
        const currentBranch = (Array.isArray(bData) ? bData : (bData.branches ?? [])).find((b: any) => b.name === n.branch_name);
        if (currentBranch) setRBranchId(String(currentBranch.id));
      }
    } catch { setRError("Failed to load retailers"); }
  };

  const onRetailerChange = async (id: string) => {
    setRRetailerId(id);
    setRBranchId("");
    setRBranches([]);
    if (!id) return;
    try {
      const res = await fetch(`${BASE}/api/retailers/${id}/branches`, { credentials: "include" });
      const data = await res.json();
      setRBranches(Array.isArray(data) ? data : (data.branches ?? []));
    } catch { /* ignore */ }
  };

  const saveReassign = async () => {
    const retailer = rRetailers.find(r => String(r.id) === rRetailerId);
    const branch   = rBranches.find(b => String(b.id) === rBranchId);
    if (!retailer) { setRError("Please select a retailer"); return; }
    setRSaving(true); setRError(null);
    try {
      const res = await fetch(`${BASE}/api/formitize/notifications/${n.id}/reassign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          retailerId: retailer.id,
          branchId: branch?.id ?? undefined,
          retailerName: retailer.name,
          branchName: branch?.name ?? null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setShowReassign(false);
      onReassigned?.(retailer.name, branch?.name ?? null);
    } catch (e: any) {
      setRError(e.message);
    } finally {
      setRSaving(false);
    }
  };
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
          {n.is_delinquent_warning && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-600/40 text-red-200 border border-red-500/60 animate-pulse">🚨 DELINQUENT ALERT</span>}
          {n.is_duplicate_warning && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 border border-red-500/30">⚠ POSSIBLE DUPLICATE</span>}
          {n.processing_error && isNew && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/25">RETRY NEEDED</span>}
        </div>
        <p className="text-sm font-medium text-white truncate">{n.form_name}</p>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-white/50 flex-wrap">
          {n.customer_name && <span className="flex items-center gap-1"><User className="w-3 h-3" />{n.customer_name}</span>}
          {n.retailer_name
            ? <span className="flex items-center gap-1 group">
                <Store className="w-3 h-3" />
                {n.retailer_name}{n.branch_name ? ` — ${n.branch_name}` : ""}
                <button
                  onClick={e => { e.stopPropagation(); showReassign ? setShowReassign(false) : openReassign(); }}
                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity ml-0.5 text-white/40 hover:text-amber-300"
                  title="Reassign retailer / branch"
                >
                  <Pencil className="w-2.5 h-2.5" />
                </button>
              </span>
            : <button
                onClick={e => { e.stopPropagation(); showReassign ? setShowReassign(false) : openReassign(); }}
                className="flex items-center gap-1 text-white/30 hover:text-amber-300 transition-colors"
                title="Assign retailer / branch"
              >
                <Store className="w-3 h-3" /><span className="italic">Assign store</span>
                <Pencil className="w-2.5 h-2.5 ml-0.5" />
              </button>
          }
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

        {/* ── Agreement financial summary (agreement-type only) ── */}
        {n.task_type === "agreement" && n.agreement_id && (
          <div className="mt-2 flex items-center gap-3 flex-wrap">
            {n.loan_amount != null && Number(n.loan_amount) > 0 && (
              <span className="text-xs text-white/60 bg-white/5 border border-white/10 rounded px-2 py-0.5">
                Loan <span className="text-white font-medium">${Number(n.loan_amount).toFixed(0)}</span>
              </span>
            )}
            {n.facility_fee_amount != null && Number(n.facility_fee_amount) > 0 && (
              <span className="text-xs text-white/60 bg-white/5 border border-white/10 rounded px-2 py-0.5">
                Facility fee <span className="text-white font-medium">${Number(n.facility_fee_amount).toFixed(2)}</span>
              </span>
            )}
            {n.interest_amount != null && Number(n.interest_amount) > 0 && (
              <span className="text-xs text-white/60 bg-white/5 border border-white/10 rounded px-2 py-0.5">
                Interest <span className="text-white font-medium">${Number(n.interest_amount).toFixed(2)}</span>
              </span>
            )}
            {n.xero_invoice_id ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-0.5">
                <Receipt className="w-3 h-3" /> Xero invoice raised
              </span>
            ) : null}
          </div>
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
        {/* ── Raise Xero Invoice button (agreement-type, not yet invoiced) ── */}
        {n.task_type === "agreement" && n.agreement_id && !n.xero_invoice_id && onRaiseInvoice && (
          <button
            onClick={onRaiseInvoice}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all"
            title="Review and raise Xero invoice"
          >
            <Receipt className="w-3.5 h-3.5" />
            Raise Invoice
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

      {/* Inline branch reassign panel */}
      {showReassign && (
        <div className="w-full mt-3 pt-3 border-t border-white/10">
          <p className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-2">Reassign retailer / branch</p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="text-[10px] text-white/40 uppercase tracking-wide block mb-1">Retailer</label>
              <select
                value={rRetailerId}
                onChange={e => onRetailerChange(e.target.value)}
                className="w-full bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-amber-500/50"
                style={{ colorScheme: "dark" }}
              >
                <option value="">— Select retailer —</option>
                {rRetailers.map(r => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
              </select>
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[10px] text-white/40 uppercase tracking-wide block mb-1">Branch</label>
              <select
                value={rBranchId}
                onChange={e => setRBranchId(e.target.value)}
                disabled={!rRetailerId || rBranches.length === 0}
                className="w-full bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:border-amber-500/50 disabled:opacity-40"
                style={{ colorScheme: "dark" }}
              >
                <option value="">— Select branch —</option>
                {rBranches.map(b => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
              </select>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={saveReassign}
                disabled={rSaving || !rRetailerId}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 disabled:opacity-40 transition-all"
              >
                {rSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                Save
              </button>
              <button
                onClick={() => setShowReassign(false)}
                className="px-2 py-1.5 rounded-lg text-xs bg-white/5 border border-white/10 text-white/40 hover:text-white/60 transition-all"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          {rError && <p className="text-xs text-red-400 mt-1.5">{rError}</p>}
        </div>
      )}

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

  // ── Raise Xero Invoice modal ───────────────────────────────────────────────
  const [raiseModal, setRaiseModal] = useState<{
    open: boolean;
    notification: FNotification | null;
    customerName: string;
    loanAmount: string;
    facilityFeeAmount: string;
    interestAmount: string;
  }>({ open: false, notification: null, customerName: "", loanAmount: "", facilityFeeAmount: "", interestAmount: "" });
  const [raiseLoading, setRaiseLoading] = useState(false);
  const [raiseError, setRaiseError] = useState("");

  const openRaiseModal = (n: FNotification) => {
    setRaiseError("");
    setRaiseModal({
      open: true,
      notification: n,
      customerName:      n.customer_name ?? "",
      loanAmount:        n.loan_amount        != null ? String(n.loan_amount)        : "",
      facilityFeeAmount: n.facility_fee_amount != null ? String(n.facility_fee_amount) : "",
      interestAmount:    n.interest_amount     != null ? String(n.interest_amount)     : "",
    });
  };

  const submitRaiseInvoice = async () => {
    if (!raiseModal.notification?.agreement_id) return;
    setRaiseLoading(true);
    setRaiseError("");
    try {
      const res = await fetch(`${BASE}/api/xero/raise-invoice/${raiseModal.notification.agreement_id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          customerName:      raiseModal.customerName.trim(),
          loanAmount:        parseFloat(raiseModal.loanAmount)        || 0,
          facilityFeeAmount: raiseModal.facilityFeeAmount ? parseFloat(raiseModal.facilityFeeAmount) : null,
          interestAmount:    raiseModal.interestAmount    ? parseFloat(raiseModal.interestAmount)    : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setRaiseError(data.error || "Failed to raise invoice"); return; }
      setRaiseModal(m => ({ ...m, open: false, notification: null }));
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch {
      setRaiseError("Network error — please try again");
    } finally {
      setRaiseLoading(false);
    }
  };

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
                onReassigned={() => qc.invalidateQueries({ queryKey: ["notifications"] })}
                onRaiseInvoice={n.task_type === "agreement" && n.agreement_id && !n.xero_invoice_id ? () => openRaiseModal(n) : undefined}
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

    {/* ── Raise Xero Invoice Modal ── */}
    <AnimatePresence>
      {raiseModal.open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={e => { if (e.target === e.currentTarget && !raiseLoading) setRaiseModal(m => ({ ...m, open: false })); }}
        >
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
            className="bg-[#1a1a2e] border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                Raise Xero Invoice
              </h2>
              <button onClick={() => !raiseLoading && setRaiseModal(m => ({ ...m, open: false }))} className="text-white/40 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {raiseModal.notification && (
              <div className="text-xs text-muted-foreground bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-2">
                <Store className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>
                  {raiseModal.notification.customer_name}
                  {raiseModal.notification.retailer_name && ` · ${raiseModal.notification.retailer_name}`}
                  {raiseModal.notification.branch_name && ` — ${raiseModal.notification.branch_name}`}
                </span>
              </div>
            )}

            <p className="text-sm text-muted-foreground">Review and correct details before raising in Xero. Edits here are saved back to the agreement record.</p>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Customer Name</label>
              <input
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400/50"
                value={raiseModal.customerName}
                onChange={e => setRaiseModal(m => ({ ...m, customerName: e.target.value }))}
                placeholder="Full name as it appears in Xero"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Loan Amount", key: "loanAmount" as const, placeholder: "0.00" },
                { label: "Facility Fee", key: "facilityFeeAmount" as const, placeholder: "0.00" },
                { label: "Interest", key: "interestAmount" as const, placeholder: "0.00" },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{f.label} (USD)</label>
                  <input
                    type="number" step="0.01" min="0"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-400/50"
                    value={raiseModal[f.key]}
                    onChange={e => setRaiseModal(m => ({ ...m, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                </div>
              ))}
            </div>

            {/* Live invoice preview */}
            {(() => {
              const loan = parseFloat(raiseModal.loanAmount) || 0;
              const fee  = parseFloat(raiseModal.facilityFeeAmount) || 0;
              const int_ = parseFloat(raiseModal.interestAmount) || 0;
              const total = loan + fee + int_;
              return (
                <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg px-4 py-3 text-sm">
                  <p className="text-amber-300 font-semibold mb-2 text-xs uppercase tracking-wider">Invoice preview</p>
                  <div className="space-y-1 text-muted-foreground">
                    {loan > 0  && <div className="flex justify-between"><span>HukuPlus Loan (621)</span><span className="text-white">${loan.toFixed(2)}</span></div>}
                    {fee  > 0  && <div className="flex justify-between"><span>Facility Fee (202)</span><span className="text-white">${fee.toFixed(2)}</span></div>}
                    {int_ > 0  && <div className="flex justify-between"><span>42 days interest (201)</span><span className="text-white">${int_.toFixed(2)}</span></div>}
                    {total > 0 && <div className="flex justify-between border-t border-white/10 mt-2 pt-2 font-semibold text-white"><span>Total</span><span>${total.toFixed(2)}</span></div>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Reference: <span className="font-mono text-amber-300">${loan > 0 ? Math.round(loan) : "?"}</span>
                    {" · "}Status: <span className="text-yellow-400">Awaiting Approval</span>
                  </p>
                </div>
              );
            })()}

            {raiseError && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{raiseError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRaiseModal(m => ({ ...m, open: false }))}
                disabled={raiseLoading}
                className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium border border-white/10 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitRaiseInvoice}
                disabled={raiseLoading || !raiseModal.customerName.trim() || (parseFloat(raiseModal.loanAmount) || 0) <= 0}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold transition-colors disabled:opacity-40"
              >
                {raiseLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Raising…</>
                  : <><Receipt className="w-4 h-4" />Raise Invoice</>
                }
              </button>
            </div>
          </motion.div>
        </motion.div>
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
                className="rounded-lg border border-white/10 bg-white/5 text-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ colorScheme: 'dark' }}>
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
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40"
              style={{ colorScheme: 'dark' }}>
              <option value="">— Select retailer —</option>
              {retailerOptions.map(([id, name]) => <option key={id} value={String(id)}>{name}</option>)}
            </select>
          </div>
          {branches.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Branch (optional)</label>
              <select value={branchId} onChange={e => setBranchId(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/40"
                style={{ colorScheme: 'dark' }}>
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

// ─── Store selector (Xero tracking categories) ────────────────────────────────

interface XeroTrackingOption { id: string; name: string; categoryId: string; categoryName: string; }

function StoreSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (label: string, categoryId: string, optionId: string) => void;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<XeroTrackingOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/api/xero/tracking-categories`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((cats: { id: string; name: string; options: { id: string; name: string }[] }[]) => {
        // Prefer the HukuPlus category; fall back to all categories if not found
        const hukuCat = cats.find(c => c.name.toLowerCase().includes("huku")) ?? cats[0];
        if (!hukuCat) return;
        setOptions(hukuCat.options.map(o => ({
          id: o.id,
          name: o.name,
          categoryId: hukuCat.id,
          categoryName: hukuCat.name,
        })));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { setQuery(value); }, [value]);

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); if (!e.target.value) onChange("", "", ""); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          placeholder={loading ? "Loading Xero stores…" : "Type to search stores…"}
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 placeholder:text-white/30"
        />
        {value && (
          <button
            type="button"
            onClick={() => { setQuery(""); onChange("", "", ""); }}
            className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-[#1a1a2e] border border-white/15 rounded-xl shadow-xl max-h-52 overflow-y-auto">
          {filtered.map(opt => (
            <button
              key={opt.id}
              type="button"
              onMouseDown={() => { onChange(opt.name, opt.categoryId, opt.id); setQuery(opt.name); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/8 hover:text-white transition-colors"
            >
              {opt.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Disbursement modal ────────────────────────────────────────────────────────

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
  const [selectedStore, setSelectedStore] = useState("");
  const [trackingCategoryId, setTrackingCategoryId] = useState("");
  const [trackingOptionId, setTrackingOptionId] = useState("");
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
          storeName: selectedStore || undefined,
          trackingCategoryId: trackingCategoryId || undefined,
          trackingOptionId: trackingOptionId || undefined,
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
                  style={{ colorScheme: 'dark' }}
                >
                  <option value="">— Select bank account —</option>
                  {bankAccounts.map(b => (
                    <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-muted-foreground font-medium block mb-1.5">
                  HukuPlus Store <span className="text-white/30 font-normal">(Xero tracking category)</span>
                </label>
                <StoreSelector
                  value={selectedStore}
                  onChange={(label, catId, optId) => {
                    setSelectedStore(label);
                    setTrackingCategoryId(catId);
                    setTrackingOptionId(optId);
                  }}
                />
                {selectedStore && trackingOptionId && (
                  <p className="text-[11px] text-emerald-400/70 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Will be assigned in Xero tracking
                  </p>
                )}
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
  const [selectedStore, setSelectedStore] = useState("");
  const [markLoanComplete, setMarkLoanComplete] = useState(true);
  const [resultErrors, setResultErrors] = useState<string[]>([]);
  const [overpaymentErr, setOverpaymentErr] = useState<string | null>(null);
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
          storeName: selectedStore || undefined,
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
      if (data.overpaymentError) setOverpaymentErr(data.overpaymentError);
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

        {/* Delinquency alert banner */}
        {notification.is_delinquent_warning && (
          <div className="mx-6 mt-4 flex items-start gap-3 p-3 rounded-lg bg-red-700/20 border border-red-500/50">
            <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-200">🚨 Delinquent customer alert</p>
              <p className="text-xs text-red-300/80 mt-0.5">
                {notification.delinquent_match ?? "This customer or their next-of-kin appears on the delinquent list in the Loan Register. Do not process until reviewed by management."}
              </p>
            </div>
          </div>
        )}

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

              {/* HukuPlus Store */}
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">
                  HukuPlus Store <span className="text-white/30 font-normal normal-case">(for Xero reference)</span>
                </label>
                <StoreSelector
                  value={selectedStore}
                  onChange={(label) => setSelectedStore(label)}
                />
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
                    style={{ colorScheme: 'dark' }}
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

              {/* Overpayment failed — manual action required */}
              {overpaymentErr && (
                <div className="mx-2 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-red-300">Credit not posted — action required</p>
                      <p className="text-xs text-red-300/80 mt-1">{overpaymentErr}</p>
                    </div>
                  </div>
                </div>
              )}

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

function NewMessageModal({
  onClose,
  onSent,
}: {
  onClose: () => void;
  onSent: (waId: string, name: string) => void;
}) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: number; fullName: string; phone: string } | null>(null);
  const [manualPhone, setManualPhone] = useState("");
  const [useManual, setUseManual] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateParams, setTemplateParams] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  const { data: customerResults = [] } = useQuery<Array<{ id: number; full_name: string; phone: string | null }>>({
    queryKey: ["customer-search-msg", customerSearch],
    enabled: customerSearch.length >= 2 && !selectedCustomer,
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/customers?search=${encodeURIComponent(customerSearch)}&limit=8`, { credentials: "include" });
      if (!r.ok) return [];
      const data = await r.json();
      return (data.customers ?? data).filter((c: any) => c.phone);
    },
    staleTime: 30_000,
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
  const templates = templatesData?.templates ?? [];
  const activeTpl = templates.find(t => t.name === selectedTemplate) ?? null;

  const rawPhone = useManual ? manualPhone : (selectedCustomer?.phone ?? "");
  const normalizedPhone = (() => {
    const digits = rawPhone.replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("263")) return digits;
    if (digits.length === 10 && digits.startsWith("0")) return "263" + digits.slice(1);
    if (digits.length === 9) return "263" + digits;
    return digits;
  })();

  const recipientName = useManual ? ("+" + normalizedPhone) : (selectedCustomer?.fullName ?? "");
  const hasRecipient = normalizedPhone.length >= 9;
  const canSend = hasRecipient && !!selectedTemplate &&
    (!activeTpl || activeTpl.params.every(p => (templateParams[p] ?? "").trim()));

  const sendMutation = useMutation({
    mutationFn: async () => {
      const params = activeTpl ? activeTpl.params.map(p => ({ name: p, value: templateParams[p] ?? "" })) : [];
      const r = await fetch(`${BASE}/api/whatsapp/send-template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ waId: normalizedPhone, templateName: selectedTemplate, parameters: params }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed to send");
      return data;
    },
    onSuccess: () => onSent(normalizedPhone, recipientName),
    onError: (err: any) => setApiError(err.message),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg mx-4 rounded-2xl bg-[#151e2e] border border-white/10 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center">
              <Send className="w-3.5 h-3.5 text-green-400" />
            </div>
            <h2 className="text-sm font-semibold text-foreground">New WhatsApp Message</h2>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* ── Recipient ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recipient</label>
              <button
                onClick={() => { setUseManual(v => !v); setSelectedCustomer(null); setCustomerSearch(""); setManualPhone(""); }}
                className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors"
              >
                {useManual ? "Search customers instead" : "Enter number manually"}
              </button>
            </div>

            {selectedCustomer && !useManual ? (
              <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
                <div>
                  <p className="text-sm font-medium text-foreground">{selectedCustomer.fullName}</p>
                  <p className="text-xs text-muted-foreground">{selectedCustomer.phone}</p>
                </div>
                <button onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }} className="text-muted-foreground hover:text-white ml-2 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : useManual ? (
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="tel"
                  value={manualPhone}
                  onChange={e => setManualPhone(e.target.value)}
                  placeholder="e.g. 0783503327 or 263783503327"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                />
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={e => { setCustomerSearch(e.target.value); setShowDropdown(true); }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="Search customer by name or phone…"
                  className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                />
                {showDropdown && customerResults.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 rounded-xl bg-[#1a2438] border border-white/10 shadow-xl overflow-hidden">
                    {customerResults.map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setSelectedCustomer({ id: c.id, fullName: c.full_name, phone: c.phone! }); setCustomerSearch(""); setShowDropdown(false); }}
                        className="w-full text-left px-3 py-2.5 hover:bg-white/8 transition-colors border-b border-white/5 last:border-0"
                      >
                        <p className="text-sm font-medium text-foreground">{c.full_name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Template picker ── */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Template</label>
            {templates.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Loading approved templates…</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {templates.map(tpl => (
                  <div
                    key={tpl.name}
                    onClick={() => { setSelectedTemplate(tpl.name); setTemplateParams({}); }}
                    className={cn(
                      "rounded-xl border p-3 cursor-pointer transition-all",
                      selectedTemplate === tpl.name
                        ? "border-green-500/40 bg-green-500/10"
                        : "border-white/8 bg-white/[0.03] hover:bg-white/6"
                    )}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <p className="text-xs font-semibold text-foreground uppercase tracking-wide">{tpl.name.replace(/_/g, " ")}</p>
                      {selectedTemplate === tpl.name && <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{tpl.body}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Template parameters ── */}
          {activeTpl && activeTpl.params.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-2">Fill in Template Fields</label>
              <div className="space-y-2">
                {activeTpl.params.map(param => (
                  <div key={param}>
                    <label className="text-xs text-muted-foreground capitalize mb-1 block">{param.replace(/_/g, " ")}</label>
                    <input
                      type="text"
                      value={templateParams[param] ?? ""}
                      onChange={e => setTemplateParams(p => ({ ...p, [param]: e.target.value }))}
                      placeholder={`Enter ${param.replace(/_/g, " ")}…`}
                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-green-500/30"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {apiError && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs text-red-300">{apiError}</div>
          )}

          <button
            onClick={() => { setApiError(null); sendMutation.mutate(); }}
            disabled={!canSend || sendMutation.isPending}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm bg-green-600 text-white hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sendMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              : <><Send className="w-4 h-4" /> Send Message</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

function WhatsAppTab() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<WaConversation | null>(null);
  const [reply, setReply] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templateParams, setTemplateParams] = useState<Record<string, string>>({});
  const [leadState, setLeadState] = useState<{ leadId: number; existing: boolean } | null>(null);
  const [showNewMsg, setShowNewMsg] = useState(false);

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

  const createLeadMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/whatsapp/conversations/${selected!.waId}/create-lead`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (r.status === 409) return { ...data, existing: true };
      if (!r.ok) throw new Error(data.error ?? "Failed to create lead");
      return { ...data, existing: false };
    },
    onSuccess: (data) => {
      setLeadState({ leadId: data.leadId, existing: data.existing });
      qc.invalidateQueries({ queryKey: ["leads"] });
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
    <>
    <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden" style={{ minHeight: 480 }}>
      <div className="flex h-full" style={{ minHeight: 480 }}>

        {/* Conversation list */}
        <div className="w-64 shrink-0 border-r border-white/10 flex flex-col" style={{ maxHeight: 600 }}>
          {/* Compose header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chats</span>
            <button
              onClick={() => setShowNewMsg(true)}
              title="New message"
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-green-400 hover:bg-green-500/10 transition-colors border border-green-500/20"
            >
              <Pencil className="w-3 h-3" /> New
            </button>
          </div>
          <div className="overflow-y-auto flex-1">
          {conversations.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No conversations yet</div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.waId}
                onClick={() => { setSelected(conv); setLeadState(null); }}
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
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center">
                    <Phone className="w-3 h-3 text-green-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{selected.senderName ?? selected.waId}</p>
                    <p className="text-[11px] text-muted-foreground">+{selected.waId}</p>
                  </div>
                </div>
                {/* Create Lead button */}
                {leadState ? (
                  <div className={cn(
                    "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium",
                    leadState.existing
                      ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                      : "bg-green-500/15 text-green-400 border border-green-500/20"
                  )}>
                    {leadState.existing
                      ? <><span className="text-amber-400">⚠</span> Lead #{leadState.leadId} already open</>
                      : <><span>✓</span> Lead #{leadState.leadId} created</>
                    }
                  </div>
                ) : (
                  <button
                    onClick={() => createLeadMutation.mutate()}
                    disabled={createLeadMutation.isPending}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20 hover:bg-amber-500/25 transition-colors disabled:opacity-50"
                  >
                    {createLeadMutation.isPending
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <UserPlus className="w-3.5 h-3.5" />
                    }
                    Create Lead
                  </button>
                )}
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

    {showNewMsg && (
      <NewMessageModal
        onClose={() => setShowNewMsg(false)}
        onSent={(waId, name) => {
          setShowNewMsg(false);
          qc.invalidateQueries({ queryKey: ["wa-conversations"] });
          // Pre-select the conversation so the user lands on it immediately
          setSelected({ waId, senderName: name, lastMessage: null, direction: "outbound", lastAt: new Date().toISOString(), unreadCount: 0 });
          setLeadState(null);
        }}
      />
    )}
  </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB — LEADS
// ═══════════════════════════════════════════════════════════════════════════════

const FLOCK_VALUE = 2.06;

interface Lead {
  id: number;
  customer_name: string;
  phone: string;
  retailer_id: number | null;
  branch_id: number | null;
  retailer_name: string | null;
  branch_name: string | null;
  flock_size: number;
  estimated_value: number;
  status: "new" | "acknowledged" | "converted" | "dropped";
  notes: string | null;
  loan_product: string;
  submitted_by: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  converted_at: string | null;
  converted_customer_name: string | null;
  created_at: string;
  messaged_at: string | null;
  dismissed_at: string | null;
  dismissed_by: string | null;
  dropped_at: string | null;
  dropped_by: string | null;
}

const LEAD_PRODUCTS = [
  { id: "HukuPlus",      label: "HukuPlus",      color: "text-amber-300",   ring: "ring-amber-500/40",   bg: "bg-amber-500/15 border-amber-500/40" },
  { id: "Revolver",      label: "Revolver",       color: "text-blue-300",    ring: "ring-blue-500/40",    bg: "bg-blue-500/15 border-blue-500/40" },
  { id: "ChikweretiOne", label: "ChikweretiOne",  color: "text-yellow-300",  ring: "ring-yellow-500/40",  bg: "bg-yellow-500/15 border-yellow-500/40" },
] as const;

function LeadProductBadge({ product }: { product?: string }) {
  const cfg = LEAD_PRODUCTS.find(p => p.id === product) ?? LEAD_PRODUCTS[0];
  return (
    <span className={cn("inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border", cfg.color, cfg.bg)}>
      {cfg.label}
    </span>
  );
}

// ── Searchable combobox used inside NewLeadModal ─────────────────────────────
function SearchableSelect({
  label,
  placeholder,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const selectedLabel = options.find(o => o.value === value)?.label ?? "";

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Close when clicking outside
  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (v: string) => {
    onChange(v);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">{label}</label>
      <button
        type="button"
        onClick={() => { if (!disabled) { setOpen(o => !o); setQuery(""); } }}
        disabled={disabled}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm text-left transition-colors",
          "bg-white/5 border-white/15 focus:outline-none",
          disabled ? "opacity-40 cursor-not-allowed" : "hover:border-white/25 cursor-pointer",
          open && "border-amber-500/40 ring-2 ring-amber-500/20"
        )}
      >
        <span className={value ? "text-white" : "text-white/30"}>{value ? selectedLabel : placeholder}</span>
        <ChevronDown className={cn("w-4 h-4 text-white/40 shrink-0 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12 }}
            className="absolute z-50 mt-1 w-full bg-[#0f1624] border border-white/15 rounded-xl shadow-xl overflow-hidden"
          >
            <div className="p-2 border-b border-white/10">
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10">
                <Search className="w-3.5 h-3.5 text-white/40 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={`Type to search ${options.length} options…`}
                  className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
                />
                {query && <button onClick={() => setQuery("")}><X className="w-3.5 h-3.5 text-white/40 hover:text-white/70" /></button>}
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-4 text-center text-xs text-white/30">No matches for "{query}"</p>
              ) : (
                filtered.map(o => (
                  <button key={o.value} type="button" onClick={() => handleSelect(o.value)}
                    className={cn(
                      "w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-2",
                      o.value === value
                        ? "bg-amber-500/15 text-amber-200"
                        : "text-white/80 hover:bg-white/5"
                    )}>
                    {o.value === value && <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                    <span>{o.label}</span>
                  </button>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NewLeadModal({
  retailers,
  onClose,
  onCreated,
}: {
  retailers: Array<{ id: number; name: string; branch_id: number; branch_name: string }>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [phoneSuffix, setPhoneSuffix] = useState("");
  const [retailerId, setRetailerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [loanProduct, setLoanProduct] = useState("HukuPlus");
  const [flockSize, setFlockSize] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  // De-duplicate retailers by id
  const retailerOptions = Array.from(
    new Map(retailers.map(r => [r.id, r.name])).entries()
  ).map(([id, name]) => ({ value: String(id), label: name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // Branches filtered to selected retailer
  const branchOptions = retailers
    .filter(r => String(r.id) === retailerId)
    .map(b => ({ value: String(b.branch_id), label: b.branch_name }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const flockNum = parseFloat(flockSize) || 0;
  const estimatedValue = flockNum * FLOCK_VALUE;

  const createMutation = useMutation({
    mutationFn: async () => {
      const retailer = retailerOptions.find(o => o.value === retailerId);
      const branch = branchOptions.find(o => o.value === branchId);
      const rawSuffix = phoneSuffix.replace(/\s/g, "").trim();
      const cleanSuffix = rawSuffix.startsWith("263") ? rawSuffix.slice(3)
        : rawSuffix.startsWith("0") ? rawSuffix.slice(1)
        : rawSuffix;
      const params = new URLSearchParams();
      params.set("customerName", customerName.trim());
      params.set("phone", "+263" + cleanSuffix);
      if (retailer) { params.set("retailerId", retailer.value); params.set("retailerName", retailer.label); }
      if (branch) { params.set("branchId", branch.value); params.set("branchName", branch.label); }
      params.set("loanProduct", loanProduct);
      if (loanProduct === "HukuPlus") params.set("flockSize", String(Math.round(flockNum)));
      else params.set("flockSize", "0");
      if (notes.trim()) params.set("notes", notes.trim());
      const r = await fetch(`${window.location.origin}/api/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        credentials: "same-origin",
        body: params.toString(),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({ error: "Failed" })); throw new Error(d.error ?? "Failed"); }
      return r.json().catch(() => ({}));
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (e: any) => setError(e?.message || "Submission failed. Please try again."),
  });

  const handleSubmit = () => {
    setError("");
    if (!customerName.trim()) { setError("Customer name is required"); return; }
    if (!phoneSuffix.trim()) { setError("Phone number is required"); return; }
    createMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-black/70 backdrop-blur-sm"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 64px)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="w-full sm:max-w-lg bg-[#1a1a2e] border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: "calc(100dvh - 64px - env(safe-area-inset-bottom))" }}>

        {/* Header — fixed, never scrolls */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-foreground">New Lead</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Record a potential customer from the field</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 px-5 py-4 space-y-4 overflow-y-auto">

          {/* Customer name */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Customer Name *</label>
            <input value={customerName} onChange={e => setCustomerName(e.target.value)}
              placeholder="e.g. John Makucha"
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 placeholder:text-white/30" />
          </div>

          {/* Phone with +263 prefix */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Phone Number *</label>
            <div className="flex items-center gap-2">
              <span className="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm font-medium shrink-0">+263</span>
              <input
                value={phoneSuffix}
                onChange={e => setPhoneSuffix(e.target.value.replace(/^\+?263/, ""))}
                placeholder="77 123 4567"
                inputMode="tel"
                type="text"
                className="flex-1 px-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 placeholder:text-white/30" />
            </div>
            {phoneSuffix && (
              <p className="text-[11px] text-white/30 mt-1">
                Full: +263{phoneSuffix.replace(/^\+?263/, "").replace(/\s/g, "")}
              </p>
            )}
          </div>

          {/* Retailer — searchable */}
          <SearchableSelect
            label="Retailer"
            placeholder="Type to search retailer…"
            options={retailerOptions}
            value={retailerId}
            onChange={v => { setRetailerId(v); setBranchId(""); }}
          />

          {/* Store / Branch — searchable, dependent on retailer */}
          <SearchableSelect
            label="Store / Branch"
            placeholder={retailerId ? "Type to search store…" : "Select a retailer first"}
            options={branchOptions}
            value={branchId}
            onChange={setBranchId}
            disabled={!retailerId || branchOptions.length === 0}
          />

          {/* Product selector */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Product *</label>
            <div className="grid grid-cols-3 gap-2">
              {LEAD_PRODUCTS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setLoanProduct(p.id); if (p.id !== "HukuPlus") setFlockSize(""); }}
                  className={cn(
                    "py-2 rounded-lg text-xs font-semibold border transition-all",
                    loanProduct === p.id
                      ? `${p.color} ${p.bg}`
                      : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Flock size + calculated value — HukuPlus only */}
          {loanProduct === "HukuPlus" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Flock Size (birds)</label>
              <input
                type="text"
                inputMode="numeric"
                value={flockSize}
                onChange={e => setFlockSize(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="0"
                className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40" />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Est. Value @ $2.06/bird</label>
              <div className="px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-semibold h-[42px] flex items-center">
                {estimatedValue > 0 ? `$${estimatedValue.toFixed(2)}` : "—"}
              </div>
            </div>
          </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Any additional context about this lead…"
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 placeholder:text-white/30 resize-none" />
          </div>
        </div>

        {/* Footer — always visible, never scrolls away */}
        <div className="px-5 py-4 border-t border-white/10 shrink-0">
          {error && <p className="text-sm text-red-400 mb-3">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <button onClick={handleSubmit} disabled={createMutation.isPending}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-all disabled:opacity-40">
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Submit Lead
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ConvertLeadModal({ lead, onClose, onDone }: { lead: Lead; onClose: () => void; onDone: () => void }) {
  const [, navigate] = useLocation();
  const [customerSearch, setCustomerSearch] = useState(lead.customer_name);
  const [candidates, setCandidates] = useState<{ id: number; full_name: string; phone: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  const searchCustomers = async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`${BASE}/api/customers?search=${encodeURIComponent(q.trim())}`, { credentials: "include" });
      if (r.ok) setCandidates(await r.json());
    } finally { setSearching(false); }
  };

  const convertMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/leads/${lead.id}/convert`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ customerId: selectedId, notes: notes.trim() || null }),
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error ?? "Failed"); }
      return r.json();
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: any) => setError(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-md bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div>
            <h2 className="text-base font-semibold text-foreground">File Lead as Converted</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{lead.customer_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-muted-foreground transition-colors"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-muted-foreground">Link this lead to an existing customer profile, or file without linking.</p>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Search Customer (optional)</label>
            <div className="flex gap-2">
              <input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchCustomers(customerSearch)}
                placeholder="Type name or phone…"
                className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 placeholder:text-white/30" />
              <button onClick={() => searchCustomers(customerSearch)} disabled={searching}
                className="px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            {candidates.length > 0 && (
              <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
                {candidates.map(c => (
                  <button key={c.id} onClick={() => setSelectedId(selectedId === c.id ? null : c.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left text-sm transition-all ${selectedId === c.id ? "border-amber-500/50 bg-amber-500/10 text-amber-200" : "border-white/10 bg-white/5 text-white/80 hover:bg-white/8"}`}>
                    <User className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{c.full_name}</span>
                    {c.phone && <span className="text-muted-foreground text-xs ml-auto">{c.phone}</span>}
                    {selectedId === c.id && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Notes (optional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Conversion notes…"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 placeholder:text-white/30 resize-none" />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-between gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
            <div className="flex gap-2">
              {selectedId && (
                <button onClick={() => navigate(`/customers?customerId=${selectedId}`)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-violet-300 bg-violet-500/10 border border-violet-500/25 hover:bg-violet-500/20 transition-all">
                  <ExternalLink className="w-3.5 h-3.5" />View Profile
                </button>
              )}
              <button onClick={() => convertMutation.mutate()} disabled={convertMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all disabled:opacity-40">
                {convertMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                File as Converted
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function LeadsTab() {
  const qc = useQueryClient();
  const [subTab, setSubTab] = useState<"feed" | "pipeline" | "filed">("feed");
  const [showNew, setShowNew] = useState(false);
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [editingLeadId, setEditingLeadId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ customer_name: string; phone: string; flock_size: string; notes: string }>({ customer_name: "", phone: "", flock_size: "", notes: "" });

  // ── Pipeline state ───────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"pipeline" | "unconverted" | "new" | "acknowledged" | "converted" | "dropped" | "all">("pipeline");
  const [retailerFilter, setRetailerFilter] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [sortAsc, setSortAsc] = useState(false);

  // ── Lead counts (shared key — deduped by TanStack) ──────────────────────────
  const { data: leadCounts } = useQuery<{ newCount: number; feedCount: number; pipelineCount: number; filedCount: number }>({
    queryKey: ["leads-count"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/leads/counts`, { credentials: "include" });
      if (!r.ok) return { newCount: 0, feedCount: 0, pipelineCount: 0, filedCount: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
  });

  // ── Feed query (per-user undismissed unconverted leads) ─────────────────────
  const { data: feedLeads = [], isLoading: feedLoading, refetch: refetchFeed } = useQuery<Lead[]>({
    queryKey: ["leads-feed"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/leads/feed`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  // ── Pipeline query ───────────────────────────────────────────────────────────
  const { data: rawLeads = [], isLoading, refetch } = useQuery<Lead[]>({
    queryKey: ["leads", statusFilter],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/leads?status=${statusFilter}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
  });

  // ── Filed query — ALL dismissed leads (new + acknowledged) ───────────────────
  const { data: filedLeads = [], isLoading: filedLoading, refetch: refetchFiled } = useQuery<Lead[]>({
    queryKey: ["leads-filed"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/leads?status=filed`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 30_000,
    enabled: subTab === "filed",
  });

  const { data: retailers = [] } = useQuery<Array<{ id: number; name: string; branch_id: number; branch_name: string }>>({
    queryKey: ["retailers-for-leads"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/applications/retailers`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["leads"] });
    qc.invalidateQueries({ queryKey: ["leads-feed"] });
    qc.invalidateQueries({ queryKey: ["leads-filed"] });
    qc.invalidateQueries({ queryKey: ["leads-count"] });
    qc.invalidateQueries({ queryKey: ["leads-pipeline-stats"] });
  };

  const dismissMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}/dismiss`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: invalidateAll,
  });

  const reengageMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}/reengage`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: invalidateAll,
  });

  const reengageAllMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/leads/reengage-all`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: invalidateAll,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}/acknowledge`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: invalidateAll,
  });

  const unacknowledgeMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}/unacknowledge`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: invalidateAll,
  });

  const dropMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}/drop`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: invalidateAll,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => { setConfirmDeleteId(null); invalidateAll(); },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, any> }) => {
      const r = await fetch(`${BASE}/api/leads/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to save");
    },
    onSuccess: () => { setEditingLeadId(null); invalidateAll(); },
  });

  const messagedMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/leads/${id}/toggle-messaged`, { method: "PUT", credentials: "include" });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: invalidateAll,
  });

  const startEdit = (lead: Lead) => {
    setEditDraft({
      customer_name: lead.customer_name,
      phone: lead.phone,
      flock_size: lead.flock_size > 0 ? String(lead.flock_size) : "",
      notes: lead.notes ?? "",
    });
    setEditingLeadId(lead.id);
    setConfirmDeleteId(null);
  };

  // ── Derive filter options from fetched leads ─────────────────────────────────
  const retailerNames = Array.from(new Set(rawLeads.map(l => l.retailer_name).filter(Boolean))) as string[];
  retailerNames.sort((a, b) => a.localeCompare(b));

  const storeNames = Array.from(new Set(
    rawLeads
      .filter(l => !retailerFilter || l.retailer_name === retailerFilter)
      .map(l => l.branch_name)
      .filter(Boolean)
  )) as string[];
  storeNames.sort((a, b) => a.localeCompare(b));

  // Reset store filter when retailer changes
  React.useEffect(() => { setStoreFilter(""); }, [retailerFilter]);

  // ── Apply client-side filters + sort ─────────────────────────────────────────
  const leads = React.useMemo(() => {
    let list = [...rawLeads];
    if (retailerFilter) list = list.filter(l => l.retailer_name === retailerFilter);
    if (storeFilter)    list = list.filter(l => l.branch_name === storeFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(l =>
        l.customer_name.toLowerCase().includes(q) ||
        (l.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
        (l.notes ?? "").toLowerCase().includes(q)
      );
    }
    // API returns newest-first; flip if ascending
    if (sortAsc) list = list.reverse();
    return list;
  }, [rawLeads, retailerFilter, storeFilter, searchQuery, sortAsc]);

  // Feed also filtered by search query
  const filteredFeedLeads = React.useMemo(() => {
    if (!searchQuery.trim()) return feedLeads;
    const q = searchQuery.trim().toLowerCase();
    return feedLeads.filter(l =>
      l.customer_name.toLowerCase().includes(q) ||
      (l.phone ?? "").replace(/\D/g, "").includes(q.replace(/\D/g, ""))
    );
  }, [feedLeads, searchQuery]);

  const totalValue = leads.reduce((sum, l) => sum + Number(l.estimated_value ?? 0), 0);
  const totalBirds = leads.reduce((sum, l) => sum + (l.flock_size ?? 0), 0);
  const filtersActive = !!(retailerFilter || storeFilter || searchQuery.trim());

  const STATUS_FILTERS = [
    { value: "pipeline",    label: "Pipeline" },
    { value: "unconverted", label: "Feed active" },
    { value: "new",         label: "New only" },
    { value: "converted",   label: "Converted" },
    { value: "dropped",     label: "Dropped" },
    { value: "all",         label: "All time" },
  ] as const;

  const handleExport = () => {
    const params = new URLSearchParams({ status: statusFilter });
    if (retailerFilter) params.set("retailerName", retailerFilter);
    if (storeFilter)    params.set("branchName", storeFilter);
    const url = `${BASE}/api/leads/export.csv?${params}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${statusFilter}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <div className="space-y-4">

        {/* ── Sub-tab navigation ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex gap-1 bg-white/5 rounded-xl p-1">
            <button onClick={() => setSubTab("feed")}
              className={cn("flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                subTab === "feed" ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground")}>
              <Bell className="w-3.5 h-3.5" />
              My Feed
              {feedLeads.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {feedLeads.length > 99 ? "99+" : feedLeads.length}
                </span>
              )}
            </button>
            <button onClick={() => setSubTab("pipeline")}
              className={cn("flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                subTab === "pipeline" ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground")}>
              <Filter className="w-3.5 h-3.5" />
              Pipeline
              {(leadCounts?.pipelineCount ?? 0) > 0 && (
                <span className={cn(
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
                  subTab === "pipeline" ? "bg-black/20 text-black" : "bg-amber-500/20 text-amber-400"
                )}>
                  {(leadCounts?.pipelineCount ?? 0) > 99 ? "99+" : leadCounts?.pipelineCount}
                </span>
              )}
            </button>
            <button onClick={() => setSubTab("filed")}
              className={cn("flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                subTab === "filed" ? "bg-amber-500 text-black" : "text-muted-foreground hover:text-foreground")}>
              <FolderOpen className="w-3.5 h-3.5" />
              Filed
              {(leadCounts?.filedCount ?? 0) > 0 && (
                <span className={cn(
                  "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold",
                  subTab === "filed" ? "bg-black/20 text-black" : "bg-white/15 text-white/60"
                )}>
                  {(leadCounts?.filedCount ?? 0) > 99 ? "99+" : leadCounts?.filedCount}
                </span>
              )}
            </button>
          </div>
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-colors">
            <UserPlus className="w-3.5 h-3.5" /> New Lead
          </button>
        </div>

        {/* ── Search bar (shared across both sub-tabs) ── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full pl-9 pr-9 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500/30 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* ═══ MY FEED SUB-TAB ═══ */}
        {subTab === "feed" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {feedLoading ? "Loading…" : filteredFeedLeads.length === 0
                  ? (searchQuery ? "No leads match your search" : "You're all caught up")
                  : `${filteredFeedLeads.length}${searchQuery ? " matching" : ""} lead${filteredFeedLeads.length !== 1 ? "s" : ""} to review`}
              </p>
              <button onClick={() => refetchFeed()} className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>

            {feedLoading ? (
              <div className="flex items-center justify-center py-16 text-white/40">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading your feed…
              </div>
            ) : filteredFeedLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-white/40">
                <CheckCheck className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-base font-medium">{searchQuery ? "No results" : "All caught up"}</p>
                <p className="text-sm mt-1">{searchQuery ? "Try a different name or number" : "No new leads to review — check back later"}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {filteredFeedLeads.map(lead => {
                    const isExpanded = expandedId === lead.id;
                    return (
                      <motion.div key={lead.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 40, scale: 0.95 }} transition={{ duration: 0.2 }}
                        className={cn(
                          "rounded-xl border transition-all overflow-hidden",
                          lead.messaged_at
                            ? "bg-teal-500/[0.05] border-teal-500/30 border-l-[3px] border-l-teal-400/60"
                            : lead.status === "new"
                              ? "bg-amber-500/[0.04] border-amber-500/25 border-l-[3px] border-l-amber-400/70"
                              : "bg-white/[0.02] border-white/8"
                        )}>

                        {/* ── Card header (always visible, click to expand) ── */}
                        <button
                          className="w-full text-left p-4 flex items-start gap-3"
                          onClick={() => setExpandedId(isExpanded ? null : lead.id)}
                        >
                          <div className={cn(
                            "mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                            lead.messaged_at
                              ? "bg-teal-500/15 border border-teal-500/25"
                              : lead.status === "new"
                                ? "bg-amber-500/15 border border-amber-500/25"
                                : "bg-white/10 border border-white/15"
                          )}>
                            {lead.messaged_at
                              ? <MessageCircle className="w-4 h-4 text-teal-400" />
                              : <UserPlus className={cn("w-4 h-4", lead.status === "new" ? "text-amber-400" : "text-white/50")} />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <span className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                                lead.status === "new"
                                  ? "bg-amber-500/20 text-amber-200 border border-amber-400/30"
                                  : "bg-white/10 text-white/50"
                              )}>
                                {lead.status === "new" ? "⚡ NEW" : "ACKNOWLEDGED"}
                              </span>
                              {lead.messaged_at && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                                  ✉ MESSAGED
                                </span>
                              )}
                              {lead.retailer_name && (
                                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/15">
                                  {lead.retailer_name}{lead.branch_name ? ` — ${lead.branch_name}` : ""}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap mb-0.5">
                              <p className="text-sm font-semibold text-white">{lead.customer_name}</p>
                              <LeadProductBadge product={lead.loan_product} />
                            </div>
                            <div className="flex items-center gap-3 mt-0.5 text-xs text-white/50 flex-wrap">
                              <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>
                              {lead.flock_size > 0 && (
                                <span>🐔 {lead.flock_size} · <span className="text-emerald-400/70">${Number(lead.estimated_value).toFixed(2)}</span></span>
                              )}
                              <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" />{fmt(lead.created_at)}</span>
                            </div>
                          </div>
                          <ChevronDown className={cn("w-4 h-4 text-white/30 shrink-0 mt-1 transition-transform", isExpanded && "rotate-180")} />
                        </button>

                        {/* ── Expanded details ── */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                              className="overflow-hidden"
                            >
                              <div className="px-4 pb-4 pt-0 border-t border-white/8 space-y-3">

                                {editingLeadId === lead.id ? (
                                  /* ── Inline edit form ── */
                                  <div className="space-y-2 pt-3">
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <label className="text-[10px] font-semibold text-white/30 uppercase tracking-wide mb-1 block">Name</label>
                                        <input
                                          className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                                          value={editDraft.customer_name}
                                          onChange={e => setEditDraft(d => ({ ...d, customer_name: e.target.value }))}
                                        />
                                      </div>
                                      <div>
                                        <label className="text-[10px] font-semibold text-white/30 uppercase tracking-wide mb-1 block">Phone</label>
                                        <input
                                          className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                                          value={editDraft.phone}
                                          onChange={e => setEditDraft(d => ({ ...d, phone: e.target.value }))}
                                        />
                                      </div>
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-semibold text-white/30 uppercase tracking-wide mb-1 block">Flock Size</label>
                                      <input
                                        type="number" min="0"
                                        className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                                        value={editDraft.flock_size}
                                        onChange={e => setEditDraft(d => ({ ...d, flock_size: e.target.value }))}
                                        placeholder="0"
                                      />
                                    </div>
                                    <div>
                                      <label className="text-[10px] font-semibold text-white/30 uppercase tracking-wide mb-1 block">Notes</label>
                                      <textarea
                                        rows={3}
                                        className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                                        value={editDraft.notes}
                                        onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                                        placeholder="Add notes…"
                                      />
                                    </div>
                                    {updateMutation.isError && (
                                      <p className="text-xs text-red-400">{String(updateMutation.error)}</p>
                                    )}
                                    <div className="flex gap-2 pt-1">
                                      <button
                                        onClick={() => updateMutation.mutate({ id: lead.id, data: { customer_name: editDraft.customer_name, phone: editDraft.phone, flock_size: editDraft.flock_size || "0", notes: editDraft.notes || null } })}
                                        disabled={updateMutation.isPending}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all disabled:opacity-40">
                                        {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                                        Save
                                      </button>
                                      <button onClick={() => setEditingLeadId(null)}
                                        className="px-3 py-1.5 text-xs text-muted-foreground hover:text-white transition-colors">
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  /* ── Read view ── */
                                  <>
                                    <div className="grid grid-cols-2 gap-3 pt-3">
                                      <div>
                                        <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wide">Phone</p>
                                        <p className="text-sm text-white mt-0.5">{lead.phone}</p>
                                      </div>
                                      {lead.flock_size > 0 && (
                                        <div>
                                          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wide">Flock / Value</p>
                                          <p className="text-sm text-white mt-0.5">{lead.flock_size} birds · <span className="text-emerald-400">${Number(lead.estimated_value).toFixed(2)}</span></p>
                                        </div>
                                      )}
                                      {lead.retailer_name && (
                                        <div>
                                          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wide">Retailer</p>
                                          <p className="text-sm text-white mt-0.5">{lead.retailer_name}</p>
                                        </div>
                                      )}
                                      {lead.branch_name && (
                                        <div>
                                          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wide">Store</p>
                                          <p className="text-sm text-white mt-0.5">{lead.branch_name}</p>
                                        </div>
                                      )}
                                      {lead.submitted_by && (
                                        <div className="col-span-2">
                                          <p className="text-[10px] font-semibold text-white/30 uppercase tracking-wide">Submitted by</p>
                                          <p className="text-sm text-white/70 mt-0.5">{lead.submitted_by}</p>
                                        </div>
                                      )}
                                    </div>
                                    {lead.notes && (
                                      <div className="rounded-lg bg-sky-500/8 border border-sky-500/15 px-3 py-2">
                                        <p className="text-[10px] font-semibold text-sky-400/60 uppercase tracking-wide mb-0.5">Notes</p>
                                        <p className="text-sm text-sky-300/80">{lead.notes}</p>
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* Action buttons */}
                                {editingLeadId !== lead.id && (
                                  <div className="flex items-center gap-2 flex-wrap pt-1">
                                    {lead.status === "new" && (
                                      <button onClick={() => acknowledgeMutation.mutate(lead.id)} disabled={acknowledgeMutation.isPending}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500/10 border border-sky-500/25 text-sky-300 hover:bg-sky-500/20 transition-all disabled:opacity-40">
                                        <CheckCheck className="w-3.5 h-3.5" /> Acknowledge
                                      </button>
                                    )}
                                    <button onClick={() => setConvertingLead(lead)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20 transition-all">
                                      <CheckCircle2 className="w-3.5 h-3.5" /> File / Convert
                                    </button>
                                    <button onClick={() => startEdit(lead)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-500/10 border border-blue-500/20 text-blue-300 hover:bg-blue-500/20 transition-all">
                                      <Pencil className="w-3.5 h-3.5" /> Edit
                                    </button>
                                    <button
                                      onClick={() => messagedMutation.mutate(lead.id)}
                                      disabled={messagedMutation.isPending}
                                      className={cn(
                                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all disabled:opacity-40",
                                        lead.messaged_at
                                          ? "bg-teal-500/20 border-teal-500/35 text-teal-300 hover:bg-teal-500/10"
                                          : "bg-white/5 border-white/15 text-white/50 hover:bg-teal-500/10 hover:border-teal-500/25 hover:text-teal-300"
                                      )}
                                      title={lead.messaged_at ? `Messaged ${fmt(lead.messaged_at)} — click to unmark` : "Mark as messaged"}
                                    >
                                      <MessageCircle className="w-3.5 h-3.5" />
                                      {lead.messaged_at ? "Messaged" : "Mark messaged"}
                                    </button>
                                    <button
                                      onClick={() => dropMutation.mutate(lead.id)}
                                      disabled={dropMutation.isPending}
                                      title="Drop — permanently not convertible"
                                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-500/10 border border-rose-500/25 text-rose-400 hover:bg-rose-500/20 transition-all disabled:opacity-40 ml-auto"
                                    >
                                      {dropMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                                      Drop
                                    </button>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}

        {/* ═══ PIPELINE SUB-TAB ═══ */}
        {subTab === "pipeline" && (
        <div className="space-y-4">
        {/* ── Top bar ── */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-medium text-white">
              {leads.length} lead{leads.length !== 1 ? "s" : ""}
              {filtersActive && <span className="text-amber-400"> (filtered)</span>}
            </p>
            {rawLeads.filter(l => l.dismissed_at).length > 0 && (
              <p className="text-xs text-amber-400/70 mt-0.5">
                {rawLeads.filter(l => l.dismissed_at).length} filed — use Re-engage to bring back to active
              </p>
            )}
            {totalBirds > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                🐔 {totalBirds.toLocaleString()} birds · <span className="text-emerald-400/80 font-medium">${totalValue.toFixed(2)} est.</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => reengageAllMutation.mutate()}
              disabled={reengageAllMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all disabled:opacity-40">
              {reengageAllMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              Re-engage All Filed
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors border border-white/10">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button onClick={() => refetch()} title="Refresh" className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold bg-amber-500 text-black hover:bg-amber-400 transition-colors">
              <UserPlus className="w-3.5 h-3.5" /> New Lead
            </button>
          </div>
        </div>

        {/* ── Status filter strip ── */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f.value} onClick={() => setStatusFilter(f.value)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-all",
                statusFilter === f.value ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70 hover:bg-white/5"
              )}>
              {f.label}
            </button>
          ))}
        </div>

        {/* ── Analysis filters + sort ── */}
        <div className="flex flex-wrap gap-2 items-end">
          {/* Retailer filter */}
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Filter by Retailer</label>
            <select
              value={retailerFilter}
              onChange={e => setRetailerFilter(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/12 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30"
              style={{ colorScheme: 'dark' }}
            >
              <option value="">All retailers</option>
              {retailerNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Store filter */}
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide block mb-1">Filter by Store</label>
            <select
              value={storeFilter}
              onChange={e => setStoreFilter(e.target.value)}
              disabled={storeNames.length === 0}
              className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/12 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:opacity-40"
              style={{ colorScheme: 'dark' }}
            >
              <option value="">All stores</option>
              {storeNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Date sort toggle */}
          <button
            onClick={() => setSortAsc(v => !v)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all shrink-0",
              "bg-white/5 border-white/12 text-white/60 hover:text-white hover:border-white/20"
            )}
          >
            {sortAsc ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {sortAsc ? "Oldest first" : "Newest first"}
          </button>

          {filtersActive && (
            <button onClick={() => { setRetailerFilter(""); setStoreFilter(""); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-red-400/80 hover:text-red-300 hover:bg-red-500/10 border border-red-500/20 transition-all shrink-0">
              <X className="w-3 h-3" /> Clear filters
            </button>
          )}
        </div>

        {/* ── Lead list ── */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-white/40"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-white/40">
            <UserPlus className="w-10 h-10 mb-3 opacity-30" />
            <p className="text-base font-medium">No leads found</p>
            <p className="text-sm mt-1">
              {filtersActive
                ? "No results for the current filters — try clearing them"
                : statusFilter === "pipeline"
                ? "No pipeline leads — acknowledge leads in the Feed to move them here"
                : statusFilter === "unconverted"
                ? "No active undismissed leads — use New Lead to record one"
                : statusFilter === "dropped"
                ? "No dropped leads — only inconvertible leads appear here"
                : "No leads in this status"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {leads.map(lead => (
                <motion.div key={lead.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18 }}
                  className={cn(
                    "p-4 rounded-xl border transition-colors",
                    lead.status === "converted"
                      ? "bg-emerald-500/[0.03] border-emerald-500/15 opacity-70"
                      : lead.messaged_at
                        ? "bg-teal-500/[0.05] border-teal-500/30 border-l-[3px] border-l-teal-400/60"
                        : lead.status === "new"
                          ? "bg-amber-500/[0.04] border-amber-500/25 border-l-[3px] border-l-amber-400/70"
                          : "bg-white/[0.02] border-white/8"
                  )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                      lead.messaged_at ? "bg-teal-500/15 border border-teal-500/25"
                        : lead.status === "new" ? "bg-amber-500/15 border border-amber-500/25"
                        : lead.status === "converted" ? "bg-emerald-500/15 border border-emerald-500/25"
                        : "bg-white/10 border border-white/15"
                    )}>
                      {lead.messaged_at
                        ? <MessageCircle className="w-4 h-4 text-teal-400" />
                        : <UserPlus className={cn("w-4 h-4",
                            lead.status === "new" ? "text-amber-400"
                              : lead.status === "converted" ? "text-emerald-400"
                              : "text-white/50"
                          )} />
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={cn(
                          "text-[10px] font-bold px-2 py-0.5 rounded-full",
                          lead.status === "new" ? "bg-amber-500/20 text-amber-200 border border-amber-400/30"
                            : lead.status === "converted" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                            : "bg-white/10 text-white/50"
                        )}>
                          {lead.status === "new" ? "⚡ NEW" : lead.status === "converted" ? "✓ CONVERTED" : "ACKNOWLEDGED"}
                        </span>
                        {lead.dismissed_at && (
                          <span
                            className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/8 text-white/35 border border-white/10"
                            title={`Marked done by ${lead.dismissed_by ?? "unknown"} on ${fmt(lead.dismissed_at)}`}
                          >
                            ✓ DONE
                          </span>
                        )}
                        {lead.messaged_at && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30">
                            ✉ MESSAGED
                          </span>
                        )}
                        {lead.retailer_name && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/15">
                            {lead.retailer_name}{lead.branch_name ? ` — ${lead.branch_name}` : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <p className="text-sm font-semibold text-white">{lead.customer_name}</p>
                        <LeadProductBadge product={lead.loan_product} />
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-white/50 flex-wrap">
                        <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>
                        {lead.flock_size > 0 && (
                          <span className="flex items-center gap-1">
                            🐔 {lead.flock_size} · <span className="text-emerald-400/80 font-medium">${Number(lead.estimated_value).toFixed(2)}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1 ml-auto"><Clock className="w-3 h-3" />
                          {fmt(lead.created_at)}
                        </span>
                      </div>
                      {lead.submitted_by && (
                        <p className="text-[11px] text-white/30 mt-0.5">Submitted by {lead.submitted_by}</p>
                      )}
                      {lead.notes && (
                        <p className="text-xs text-sky-300/60 mt-1 flex items-center gap-1">
                          <FileText className="w-3 h-3" />{lead.notes}
                        </p>
                      )}
                      {lead.status === "converted" && lead.converted_customer_name && (
                        <p className="text-xs text-emerald-300/60 mt-1">Linked: {lead.converted_customer_name}</p>
                      )}
                      {lead.acknowledged_by && lead.status === "acknowledged" && (
                        <p className="text-[11px] text-white/25 mt-0.5">
                          Ack by {lead.acknowledged_by} · {lead.acknowledged_at ? fmt(lead.acknowledged_at) : ""}
                        </p>
                      )}
                      {lead.dismissed_at && (
                        <p className="text-[11px] text-amber-400/50 mt-0.5 flex items-center gap-1">
                          <FolderOpen className="w-3 h-3" />
                          Filed {fmt(lead.dismissed_at)}{lead.dismissed_by ? ` by ${lead.dismissed_by}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0 items-end">
                      {lead.status === "new" && editingLeadId !== lead.id && (
                        <button onClick={() => acknowledgeMutation.mutate(lead.id)} disabled={acknowledgeMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-500/10 border border-sky-500/25 text-sky-300 hover:bg-sky-500/20 transition-all disabled:opacity-40">
                          <CheckCheck className="w-3.5 h-3.5" /> Acknowledge
                        </button>
                      )}
                      {lead.status !== "converted" && editingLeadId !== lead.id && (
                        <button onClick={() => setConvertingLead(lead)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/20 transition-all">
                          <CheckCircle2 className="w-3.5 h-3.5" /> File
                        </button>
                      )}
                      {lead.status === "acknowledged" && lead.dismissed_at && editingLeadId !== lead.id && (
                        <button
                          onClick={() => reengageMutation.mutate(lead.id)}
                          disabled={reengageMutation.isPending}
                          title="Re-engage — bring back to active pipeline"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                          {reengageMutation.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RotateCcw className="w-3.5 h-3.5" />}
                          Re-engage
                        </button>
                      )}
                      {lead.status === "acknowledged" && !lead.dismissed_at && editingLeadId !== lead.id && (
                        <button
                          onClick={() => unacknowledgeMutation.mutate(lead.id)}
                          disabled={unacknowledgeMutation.isPending}
                          title="Move back to Feed as a new lead"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-orange-500/10 border border-orange-500/25 text-orange-300 hover:bg-orange-500/20 transition-all disabled:opacity-40">
                          {unacknowledgeMutation.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <RotateCcw className="w-3.5 h-3.5" />}
                          Back to Feed
                        </button>
                      )}
                      {lead.status !== "converted" && lead.status !== "dropped" && editingLeadId !== lead.id && (
                        <button
                          onClick={() => dropMutation.mutate(lead.id)}
                          disabled={dropMutation.isPending}
                          title="Mark as permanently inconvertible — removes from active pipeline"
                          className="p-1.5 rounded-lg text-white/20 hover:text-rose-400 hover:bg-rose-500/10 transition-all disabled:opacity-40">
                          {dropMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {editingLeadId !== lead.id && (
                        <button onClick={() => startEdit(lead)}
                          className="p-1.5 rounded-lg text-white/25 hover:text-blue-400 hover:bg-blue-500/10 transition-all">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => messagedMutation.mutate(lead.id)}
                        disabled={messagedMutation.isPending}
                        title={lead.messaged_at ? `Messaged ${fmt(lead.messaged_at)} — click to unmark` : "Mark as messaged"}
                        className={cn(
                          "p-1.5 rounded-lg transition-all disabled:opacity-40",
                          lead.messaged_at
                            ? "text-teal-400 bg-teal-500/15 hover:bg-teal-500/5"
                            : "text-white/25 hover:text-teal-400 hover:bg-teal-500/10"
                        )}
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteId === lead.id ? (
                        <div className="flex items-center gap-1 mt-0.5">
                          <button onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-[10px] text-white/40 hover:text-white/70 transition-colors">
                            Cancel
                          </button>
                          <button onClick={() => deleteMutation.mutate(lead.id)} disabled={deleteMutation.isPending}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition-all disabled:opacity-40">
                            {deleteMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            Confirm
                          </button>
                        </div>
                      ) : editingLeadId !== lead.id ? (
                        <button onClick={() => setConfirmDeleteId(lead.id)}
                          className="p-1.5 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* ── Inline edit form ── */}
                  {editingLeadId === lead.id && (
                    <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Name</label>
                          <input
                            className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                            value={editDraft.customer_name}
                            onChange={e => setEditDraft(d => ({ ...d, customer_name: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Phone</label>
                          <input
                            className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                            value={editDraft.phone}
                            onChange={e => setEditDraft(d => ({ ...d, phone: e.target.value }))}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Flock Size</label>
                        <input
                          type="number" min="0"
                          className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                          value={editDraft.flock_size}
                          onChange={e => setEditDraft(d => ({ ...d, flock_size: e.target.value }))}
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Notes</label>
                        <textarea
                          rows={3}
                          className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                          value={editDraft.notes}
                          onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))}
                          placeholder="Add notes…"
                        />
                      </div>
                      {updateMutation.isError && (
                        <p className="text-xs text-red-400">{String(updateMutation.error)}</p>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => updateMutation.mutate({ id: lead.id, data: { customer_name: editDraft.customer_name, phone: editDraft.phone, flock_size: editDraft.flock_size || "0", notes: editDraft.notes || null } })}
                          disabled={updateMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all disabled:opacity-40">
                          {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                          Save
                        </button>
                        <button onClick={() => setEditingLeadId(null)}
                          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-white transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
        </div>
        )}

        {/* ═══ FILED SUB-TAB ═══ */}
        {subTab === "filed" && (
        <div className="space-y-4">
          {/* Top bar */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-medium text-white">
                {filedLoading ? "Loading…" : `${filedLeads.filter(l => !searchQuery.trim() || l.customer_name.toLowerCase().includes(searchQuery.toLowerCase()) || (l.phone ?? "").includes(searchQuery)).length} filed lead${filedLeads.length !== 1 ? "s" : ""}`}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Parked leads — re-engage to restore or drop to write off</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => reengageAllMutation.mutate()}
                disabled={reengageAllMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                {reengageAllMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                Re-engage All
              </button>
              <button onClick={() => refetchFiled()} title="Refresh" className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/5 transition-colors">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {filedLoading ? (
            <div className="flex items-center justify-center py-16 text-white/40">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading filed leads…
            </div>
          ) : filedLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <FolderOpen className="w-8 h-8 text-white/20" />
              <p className="text-sm text-white/40">No filed leads</p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {filedLeads
                  .filter(l => !searchQuery.trim() ||
                    l.customer_name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
                    (l.phone ?? "").replace(/\D/g, "").includes(searchQuery.trim().replace(/\D/g, "")) ||
                    (l.notes ?? "").toLowerCase().includes(searchQuery.trim().toLowerCase()))
                  .map(lead => (
                  <motion.div key={lead.id}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
                    className="rounded-xl bg-white/[0.03] border border-white/8 p-3">
                    {editingLeadId === lead.id ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-white">Edit lead</p>
                          <button onClick={() => setEditingLeadId(null)} className="text-white/40 hover:text-white transition-colors"><X className="w-3.5 h-3.5" /></button>
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Customer name</label>
                          <input className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                            value={editDraft.customer_name} onChange={e => setEditDraft(d => ({ ...d, customer_name: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Phone</label>
                          <input className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                            value={editDraft.phone} onChange={e => setEditDraft(d => ({ ...d, phone: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Flock size</label>
                          <input type="number" className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50"
                            value={editDraft.flock_size} onChange={e => setEditDraft(d => ({ ...d, flock_size: e.target.value }))} placeholder="0" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">Notes</label>
                          <textarea rows={3} className="w-full bg-white/5 border border-white/10 rounded-md px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-primary/50 resize-none"
                            value={editDraft.notes} onChange={e => setEditDraft(d => ({ ...d, notes: e.target.value }))} placeholder="Add notes…" />
                        </div>
                        {updateMutation.isError && <p className="text-xs text-red-400">{String(updateMutation.error)}</p>}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => updateMutation.mutate({ id: lead.id, data: { customer_name: editDraft.customer_name, phone: editDraft.phone, flock_size: editDraft.flock_size || "0", notes: editDraft.notes || null } })}
                            disabled={updateMutation.isPending}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/20 border border-primary/30 text-primary hover:bg-primary/30 transition-all disabled:opacity-40">
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                            Save
                          </button>
                          <button onClick={() => setEditingLeadId(null)} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-white transition-colors">Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className={cn(
                              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                              lead.status === "new"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/25"
                                : "bg-sky-500/15 text-sky-300 border-sky-500/25"
                            )}>
                              {lead.status === "new" ? "📋 WAS LEAD" : "📊 WAS PIPELINE"}
                            </span>
                            {lead.retailer_name && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/15">
                                {lead.retailer_name}{lead.branch_name ? ` — ${lead.branch_name}` : ""}
                              </span>
                            )}
                          </div>
                          <p className="text-sm font-semibold text-white/80">{lead.customer_name}</p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-white/40 flex-wrap">
                            {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>}
                            {lead.flock_size > 0 && (
                              <span className="flex items-center gap-1">🐔 {lead.flock_size} · <span className="text-emerald-400/70 font-medium">${Number(lead.estimated_value).toFixed(2)}</span></span>
                            )}
                          </div>
                          {lead.notes && (
                            <p className="text-xs text-sky-300/50 mt-1 flex items-center gap-1">
                              <FileText className="w-3 h-3" />{lead.notes}
                            </p>
                          )}
                          <p className="text-[11px] text-amber-400/50 mt-1.5 flex items-center gap-1">
                            <FolderOpen className="w-3 h-3" />
                            Filed {fmt(lead.dismissed_at!)}{lead.dismissed_by ? ` by ${lead.dismissed_by}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0 items-end">
                          <button
                            onClick={() => reengageMutation.mutate(lead.id)}
                            disabled={reengageMutation.isPending}
                            title={lead.status === "new" ? "Restore to Feed" : "Restore to Pipeline"}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25 transition-all disabled:opacity-40">
                            {reengageMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                            {lead.status === "new" ? "Restore to Feed" : "Restore to Pipeline"}
                          </button>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button onClick={() => startEdit(lead)}
                              className="p-1.5 rounded-lg text-white/25 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                              title="Edit details">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => dropMutation.mutate(lead.id)}
                              disabled={dropMutation.isPending}
                              title="Drop permanently — no-hoper"
                              className="p-1.5 rounded-lg text-white/20 hover:text-rose-400 hover:bg-rose-500/10 transition-all disabled:opacity-40">
                              {dropMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
        )}

      </div>

      <AnimatePresence>
        {showNew && (
          <NewLeadModal retailers={retailers} onClose={() => setShowNew(false)}
            onCreated={invalidateAll} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {convertingLead && (
          <ConvertLeadModal lead={convertingLead} onClose={() => setConvertingLead(null)}
            onDone={invalidateAll} />
        )}
      </AnimatePresence>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

type Tab = "formitize" | "loans" | "drawdowns" | "messages" | "whatsapp" | "leads";

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

  const [tab, setTab] = useState<Tab>(() => isAdmin ? "formitize" : "leads");

  // If user role loads and they're not an admin but on an admin-only tab, redirect to leads
  useEffect(() => {
    if (user && !isAdmin && ADMIN_TABS.includes(tab)) {
      setTab("leads");
    }
  }, [user, isAdmin, tab]);

  // ── Pre-fetch all dropdown data eagerly on page load ─────────────────────────
  // Child components (tabs + modals) use the same query keys so they get cached
  // data instantly instead of showing blank dropdowns while fetching.
  const fetchRetailers = () =>
    fetch(`${BASE}/api/applications/retailers`, { credentials: "include" }).then(r => r.ok ? r.json() : []);
  useQuery({ queryKey: ["retailers-list"],     queryFn: fetchRetailers, staleTime: 5 * 60 * 1000 });
  useQuery({ queryKey: ["retailers-for-leads"], queryFn: fetchRetailers, staleTime: 5 * 60 * 1000 });
  useQuery({
    queryKey: ["disbursement-bank-accounts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/disbursements/bank-accounts`, { credentials: "include" });
      const d = await r.json().catch(() => ({}));
      return d.bankAccounts ?? [];
    },
    staleTime: 5 * 60 * 1000,
  });
  useQuery({
    queryKey: ["bank-accounts"],
    queryFn: () => fetch(`${BASE}/api/payments/bank-accounts`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 5 * 60 * 1000,
  });

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

  const { data: leadsCount } = useQuery<{ newCount: number; feedCount: number; pipelineCount: number }>({
    queryKey: ["leads-count"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/leads/counts`, { credentials: "include" });
      if (!r.ok) return { newCount: 0, feedCount: 0, pipelineCount: 0 };
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const formitizeBadge = counts?.newTotal ?? 0;
  const drawdownBadge  = ddCount?.count ?? 0;
  const waBadge        = waUnread?.count ?? 0;
  const leadsBadge     = leadsCount?.feedCount ?? 0;

  const ALL_TABS: TabDef[] = [
    { id: "formitize",  label: "Formitize",       icon: <Bell className="w-4 h-4" /> },
    { id: "loans",      label: "Loan Requests",   icon: <Egg className="w-4 h-4" /> },
    { id: "drawdowns",  label: "Drawdowns",       icon: <ArrowDownCircle className="w-4 h-4" /> },
    { id: "messages",   label: "Store Messages",  icon: <MessageSquare className="w-4 h-4" /> },
    { id: "leads",      label: "Leads",            icon: <UserPlus className="w-4 h-4" /> },
    { id: "whatsapp",   label: "WhatsApp",         icon: <MessageCircle className="w-4 h-4" /> },
  ];

  const TABS = isAdmin ? ALL_TABS : ALL_TABS.filter(t => !ADMIN_TABS.includes(t.id));

  const getBadge = (id: Tab) => {
    if (id === "formitize") return formitizeBadge;
    if (id === "drawdowns") return drawdownBadge;
    if (id === "whatsapp")  return waBadge;
    if (id === "leads")     return leadsBadge;
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
          {tab === "leads"      && <LeadsTab />}
          {tab === "whatsapp"   && <WhatsAppTab />}
        </>
      )}
    </div>
  );
}
