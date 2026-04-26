import React, { useState, useRef, useMemo } from "react";
import { useListAgreements, useCreateAgreement, useListRetailers, useListBranches } from "@workspace/api-client-react";
import { PageHeader, GlassCard, GradientButton, Badge, Modal, Input, Label, Select } from "@/components/ui-extras";
import {
  Plus, Link as LinkIcon, CheckCircle2, Clock, XCircle, Search, Upload,
  FileText, Copy, Monitor, ScrollText, Banknote, Info, CheckSquare, RotateCcw,
  Receipt, Loader2,
} from "lucide-react";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_CONFIG: Record<string, { label: string; badge: "success"|"warning"|"neutral"|"danger" }> = {
  signed:      { label: "Signed",       badge: "success" },
  pending:     { label: "Pending Sign", badge: "warning" },
  application: { label: "Application",  badge: "neutral" },
  disbursed:   { label: "Disbursed",    badge: "success" },
  expired:     { label: "Expired",      badge: "danger"  },
};

const FORMTYPE_LABELS: Record<string, string> = {
  agreement:     "Agreement",
  application:   "Application",
  reapplication: "Re-Application",
  drawdown:      "Drawdown",
  payment:       "Payment",
  approval:      "Approval",
  undertaking:   "Undertaking",
  unknown:       "",
};

function isNovafeeds(a: any) {
  return (
    a.loanProduct === "Novafeeds" ||
    (a.retailerName && a.retailerName.toLowerCase().includes("novafeed"))
  );
}

export default function AgreementsPage() {
  const [, navigate] = useLocation();
  const { data: allAgreements, isLoading } = useListAgreements();
  const { data: retailers } = useListRetailers();
  const queryClient = useQueryClient();
  const createMutation = useCreateAgreement();

  // Novafeeds agreements split into active (needs action) and done (archived)
  const allNova = useMemo(
    () => (allAgreements ?? []).filter(isNovafeeds),
    [allAgreements]
  );
  const agreements = useMemo(
    () => allNova.filter(a => !(a as any).markedDoneAt),
    [allNova]
  );
  const doneAgreements = useMemo(
    () => allNova.filter(a => !!(a as any).markedDoneAt),
    [allNova]
  );

  // ── Filters ──────────────────────────────────────────────────────────────
  const [searchTerm,   setSearchTerm]   = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Done view toggle ──────────────────────────────────────────────────────
  const [showDone,    setShowDone]    = useState(false);
  const [doneLoading, setDoneLoading] = useState<Set<number>>(new Set());

  const markDone = async (id: number) => {
    setDoneLoading(prev => { const n = new Set(prev); n.add(id); return n; });
    try {
      await fetch(`${BASE}/api/agreements/${id}/mark-done`, {
        method: "POST",
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
    } finally {
      setDoneLoading(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  // ── Bulk select ───────────────────────────────────────────────────────────
  const [selected,    setSelected]    = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // ── Create form ───────────────────────────────────────────────────────────
  const [isModalOpen,    setIsModalOpen]    = useState(false);
  const [isImportOpen,   setIsImportOpen]   = useState(false);
  const [branchId,       setBranchId]       = useState("");
  const [customerName,   setCustomerName]   = useState("");
  const [customerPhone,  setCustomerPhone]  = useState("");
  const [loanAmount,     setLoanAmount]     = useState("");
  const [pdfUrl,         setPdfUrl]         = useState("");
  const [createError,    setCreateError]    = useState("");

  // Novafeeds retailer id from loaded retailers
  const novaRetailer = useMemo(
    () => retailers?.find(r => r.name.toLowerCase().includes("novafeed")),
    [retailers]
  );
  const { data: novaBranches } = useListBranches(novaRetailer?.id ?? 0, {
    query: { enabled: !!novaRetailer },
  });

  // ── CSV import ────────────────────────────────────────────────────────────
  const [csvFile,      setCsvFile]      = useState<File | null>(null);
  const [importing,    setImporting]    = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number; skipped: number; errors: string[];
    detectedColumns?: string[];
    agreements: { customerName: string; branch: string; signingUrl: string }[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [copiedId, setCopiedId] = useState<number | null>(null);
  const copyLink = (url: string, id?: number) => {
    navigator.clipboard.writeText(url);
    if (id !== undefined) { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); }
  };

  // ── Xero Invoice raise modal ──────────────────────────────────────────────
  const [raiseModal, setRaiseModal] = useState<{
    open: boolean;
    agreement: any | null;
    customerName: string;
    loanAmount: string;
    facilityFeeAmount: string;
    interestAmount: string;
  }>({ open: false, agreement: null, customerName: "", loanAmount: "", facilityFeeAmount: "", interestAmount: "" });
  const [raiseLoading, setRaiseLoading] = useState(false);
  const [raiseError,   setRaiseError]   = useState("");

  const openRaiseModal = (a: any) => {
    setRaiseError("");
    setRaiseModal({
      open: true,
      agreement: a,
      customerName:      a.customerName ?? "",
      loanAmount:        a.loanAmount     != null ? String(a.loanAmount)         : "",
      facilityFeeAmount: (a as any).facilityFeeAmount != null ? String((a as any).facilityFeeAmount) : "",
      interestAmount:    (a as any).interestAmount    != null ? String((a as any).interestAmount)    : "",
    });
  };

  const submitRaiseInvoice = async () => {
    if (!raiseModal.agreement) return;
    setRaiseLoading(true);
    setRaiseError("");
    try {
      const res = await fetch(`${BASE}/api/xero/raise-invoice/${raiseModal.agreement.id}`, {
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
      if (!res.ok) {
        setRaiseError(data.error || "Failed to raise Xero invoice");
        return;
      }
      setRaiseModal(m => ({ ...m, open: false, agreement: null }));
      queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
    } catch {
      setRaiseError("Network error — please try again");
    } finally {
      setRaiseLoading(false);
    }
  };

  // ── Filtered list — uses active or done list based on view toggle ─────────
  const filtered = useMemo(() => {
    const source = showDone ? doneAgreements : agreements;
    return source.filter(a => {
      if (searchTerm && !a.customerName.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      if (!showDone && statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    });
  }, [agreements, doneAgreements, showDone, searchTerm, statusFilter]);

  // ── Status counts (active items only) ─────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, signed: 0, pending: 0, disbursed: 0, expired: 0 };
    agreements.forEach(a => { c.all++; if (c[a.status] !== undefined) c[a.status]++; });
    return c;
  }, [agreements]);

  // ── Bulk actions ──────────────────────────────────────────────────────────
  const toggleSelect = (id: number) =>
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleAll = () => {
    if (selected.size === filtered.length) { setSelected(new Set()); return; }
    setSelected(new Set(filtered.map(a => a.id)));
  };

  const bulkUpdateStatus = async (status: string) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      await fetch(`${BASE}/api/agreements/bulk-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ids: [...selected], status }),
      });
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
    } finally { setBulkLoading(false); }
  };

  // ── Create ────────────────────────────────────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaRetailer) return;
    setCreateError("");
    createMutation.mutate({ data: {
      retailerId: novaRetailer.id,
      branchId: Number(branchId),
      customerName,
      customerPhone: customerPhone.trim() || null,
      loanProduct: "HukuPlus",
      loanAmount: Number(loanAmount),
      formitizeFormUrl: pdfUrl.trim() || null,
    }}, {
      onSuccess: () => {
        setIsModalOpen(false);
        queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
        setBranchId(""); setCustomerName(""); setCustomerPhone(""); setLoanAmount(""); setPdfUrl(""); setCreateError("");
      },
      onError: (err: any) => {
        setCreateError(err?.message || "Failed to create agreement — please try again.");
      },
    });
  };

  // ── CSV import ────────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (!csvFile) return;
    setImporting(true); setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", csvFile);
      const res = await fetch(`${BASE}/api/formitize/import-csv`, { method: "POST", credentials: "include", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportResult(data);
      if (data.imported > 0) queryClient.invalidateQueries({ queryKey: [`/api/agreements`] });
    } catch (err: any) {
      setImportResult({ imported: 0, skipped: 0, errors: [err.message], agreements: [] });
    } finally { setImporting(false); }
  };

  const resetImport = () => {
    setCsvFile(null); setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const STATUS_TABS = [
    { id: "all",      label: "All"          },
    { id: "pending",  label: "Pending Sign" },
    { id: "signed",   label: "Signed"       },
    { id: "disbursed",label: "Disbursed"    },
    { id: "expired",  label: "Expired"      },
  ];

  return (
    <div className="pb-10">
      <PageHeader
        title="Novafeeds Kiosk"
        description="HukuPlusCentral-managed signing agreements for Novafeeds stores. All other retailers are managed directly in Formitize."
        action={
          <div className="flex gap-2">
            <button
              onClick={() => { setIsImportOpen(true); resetImport(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm text-white transition-colors border border-white/10"
            >
              <Upload className="w-4 h-4" /> Import CSV
            </button>
            <GradientButton onClick={() => setIsModalOpen(true)}>
              <Plus className="w-4 h-4" /> Issue Agreement
            </GradientButton>
          </div>
        }
      />

      {/* ── Info note ── */}
      <div className="flex items-start gap-2.5 mb-5 px-4 py-3 rounded-xl bg-blue-500/5 border border-blue-500/15 text-sm text-blue-300/80">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
        <p>
          Profeeds and other retailer agreements are handled directly in Formitize and are not actioned here.
          View a customer's full loan history across all retailers in the <a href={`${BASE.replace(/\/$/, "")}/customers`} className="underline text-blue-300 hover:text-white transition-colors">Customers</a> record.
        </p>
      </div>

      {/* ── Status Summary ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {[
          { key: "all",      label: "Total",        colour: "text-white",          bg: "bg-white/5  border-white/10"           },
          { key: "pending",  label: "Awaiting Sign", colour: "text-yellow-400",    bg: "bg-yellow-500/5 border-yellow-500/20"  },
          { key: "signed",   label: "Signed",        colour: "text-emerald-400",   bg: "bg-emerald-500/5 border-emerald-500/20"},
          { key: "disbursed",label: "Disbursed",     colour: "text-purple-400",    bg: "bg-purple-500/5 border-purple-500/20"  },
          { key: "expired",  label: "Expired",       colour: "text-red-400",       bg: "bg-red-500/5    border-red-500/20"     },
        ].map(s => (
          <button
            key={s.key}
            onClick={() => setStatusFilter(s.key)}
            className={`rounded-xl border p-3 text-center transition-all ${s.bg} ${statusFilter === s.key ? "ring-1 ring-white/20" : "opacity-70 hover:opacity-100"}`}
          >
            <p className={`text-2xl font-bold ${s.colour}`}>{counts[s.key] ?? 0}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </button>
        ))}
      </div>

      <GlassCard className="p-0 overflow-hidden">
        {/* ── Filter bar ── */}
        <div className="p-4 border-b border-white/5 bg-black/20 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by customer..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 py-2 bg-transparent border-transparent focus:border-white/10"
            />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {!showDone && STATUS_TABS.map(s => (
              <button
                key={s.id}
                onClick={() => setStatusFilter(s.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  statusFilter === s.id
                    ? "bg-white/15 text-white"
                    : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
              >
                {s.label}
                <span className="ml-1 opacity-50 text-[10px]">{counts[s.id] ?? 0}</span>
              </button>
            ))}
          </div>
          {/* Done view toggle */}
          <button
            onClick={() => { setShowDone(d => !d); setSearchTerm(""); setStatusFilter("all"); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ml-auto ${
              showDone
                ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300"
                : "bg-white/5 border-white/10 text-muted-foreground hover:text-white hover:bg-white/10"
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            {showDone ? "← Back to Active" : `Done (${doneAgreements.length})`}
          </button>
        </div>

        {/* ── Bulk action bar ── */}
        {selected.size > 0 && (
          <div className="px-4 py-2.5 bg-primary/10 border-b border-primary/20 flex items-center gap-3">
            <span className="text-sm text-primary font-medium">{selected.size} selected</span>
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => bulkUpdateStatus("disbursed")}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 text-xs font-medium transition-colors border border-purple-500/20"
              >
                <Banknote className="w-3.5 h-3.5" /> Mark Disbursed
              </button>
              <button
                onClick={() => bulkUpdateStatus("signed")}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs font-medium transition-colors border border-emerald-500/20"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark Signed
              </button>
              <button
                onClick={() => bulkUpdateStatus("expired")}
                disabled={bulkLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium transition-colors border border-red-500/20"
              >
                <XCircle className="w-3.5 h-3.5" /> Mark Expired
              </button>
              <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-white">
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll}
                    className="rounded accent-primary cursor-pointer"
                  />
                </th>
                <th className="p-4">Customer</th>
                <th className="p-4">Branch</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Form Type</th>
                <th className="p-4">Status</th>
                <th className="p-4">Invoice</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading && (
                <tr><td colSpan={8} className="p-8 text-center animate-pulse text-muted-foreground">Loading...</td></tr>
              )}
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  className={`hover:bg-white/[0.02] transition-colors ${selected.has(a.id) ? "bg-primary/5" : ""}`}
                >
                  <td className="p-4">
                    <input
                      type="checkbox"
                      checked={selected.has(a.id)}
                      onChange={() => toggleSelect(a.id)}
                      className="rounded accent-primary cursor-pointer"
                    />
                  </td>
                  <td className="p-4">
                    <p className="font-semibold text-white">{a.customerName}</p>
                    <p className="text-xs text-muted-foreground" title={format(new Date(a.createdAt), "PPP p")}>
                      {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                    </p>
                  </td>
                  <td className="p-4">
                    <p className="text-sm text-foreground">{a.branchName || <span className="text-muted-foreground">—</span>}</p>
                  </td>
                  <td className="p-4">
                    <p className="text-sm font-medium">
                      {(a.loanAmount ?? 0) > 0
                        ? `USD ${a.loanAmount!.toLocaleString()}`
                        : <span className="text-muted-foreground">—</span>}
                    </p>
                  </td>
                  <td className="p-4">
                    {(a as any).formType && (a as any).formType !== "unknown" ? (
                      <span className="text-xs text-muted-foreground bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
                        {FORMTYPE_LABELS[(a as any).formType] ?? (a as any).formType}
                      </span>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-4">
                    {(() => {
                      const cfg = STATUS_CONFIG[a.status];
                      if (!cfg) return <Badge status="neutral">{a.status}</Badge>;
                      const Icon = a.status === "signed" || a.status === "disbursed" ? CheckCircle2
                        : a.status === "pending" ? Clock
                        : XCircle;
                      return (
                        <Badge status={cfg.badge}>
                          <Icon className="w-3 h-3 inline mr-1" />{cfg.label}
                        </Badge>
                      );
                    })()}
                  </td>
                  {/* ── Xero Invoice cell ── */}
                  <td className="p-4">
                    {(a as any).xeroInvoiceId ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        <Receipt className="w-3 h-3" />{(a as any).xeroInvoiceId.slice(0, 8)}…
                      </span>
                    ) : (a as any).formType === "agreement" && (a.loanAmount ?? 0) > 0 ? (
                      <button
                        onClick={() => openRaiseModal(a)}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 px-2 py-0.5 rounded-full transition-colors"
                        title="Review and raise Xero invoice"
                      >
                        <Receipt className="w-3 h-3" />Raise
                      </button>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>

                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {showDone ? (
                        /* ── Done view: only show Restore ── */
                        <button
                          onClick={() => markDone(a.id)}
                          disabled={doneLoading.has(a.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium transition-colors border border-white/10 text-muted-foreground hover:text-white disabled:opacity-40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Restore
                        </button>
                      ) : (
                        <>
                          {/* ── Normal actions ── */}
                          {a.status === "signed" || a.status === "disbursed" ? (
                            <button
                              onClick={() => navigate(`/agreements/${a.id}/execution`)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors border border-emerald-500/20"
                            >
                              <ScrollText className="w-3.5 h-3.5" /> Certificate
                            </button>
                          ) : a.status === "application" ? (
                            <span className="text-xs text-muted-foreground italic px-3 py-1.5">Awaiting</span>
                          ) : (
                            <>
                              <a
                                href={a.signingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors border border-primary/20"
                              >
                                <Monitor className="w-3.5 h-3.5" /> Kiosk
                              </a>
                              <button
                                onClick={() => a.signingUrl && copyLink(a.signingUrl, a.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium transition-colors border border-white/10 text-muted-foreground hover:text-white"
                                title="Copy signing link"
                              >
                                {copiedId === a.id
                                  ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400">Copied!</span></>
                                  : <Copy className="w-3.5 h-3.5" />
                                }
                              </button>
                            </>
                          )}
                          {/* ── Mark Done (always available in active view) ── */}
                          <button
                            onClick={() => markDone(a.id)}
                            disabled={doneLoading.has(a.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-emerald-500/10 text-xs font-medium transition-colors border border-white/10 hover:border-emerald-500/20 text-muted-foreground hover:text-emerald-400 disabled:opacity-40"
                            title="Mark as done — hides this row"
                          >
                            <CheckSquare className="w-3.5 h-3.5" />
                            {doneLoading.has(a.id) ? "…" : "Done"}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">
                    {showDone
                      ? "No completed agreements yet. Mark items done from the active view."
                      : "No active agreements — everything is actioned."
                    }
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filtered.length > 0 && (
          <div className="px-4 py-3 border-t border-white/5 bg-black/10 text-xs text-muted-foreground">
            {showDone
              ? `Showing ${filtered.length} completed agreement${filtered.length !== 1 ? "s" : ""} — click Restore to bring one back`
              : `Showing ${filtered.length} of ${agreements.length} active Novafeeds agreements`
            }
          </div>
        )}
      </GlassCard>

      {/* ── Raise Xero Invoice Modal ── */}
      <Modal
        isOpen={raiseModal.open}
        onClose={() => !raiseLoading && setRaiseModal(m => ({ ...m, open: false }))}
        title="Raise Xero Invoice"
      >
        <div className="space-y-4">
          {/* Context strip */}
          {raiseModal.agreement && (
            <div className="text-xs text-muted-foreground bg-white/5 border border-white/10 rounded-lg px-3 py-2 flex items-center gap-3">
              <Receipt className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                Agreement #{raiseModal.agreement.id}
                {raiseModal.agreement.branchName && ` · ${raiseModal.agreement.branchName}`}
              </span>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Review and correct the details below before raising the invoice in Xero. Any edits here are also saved back to the agreement record.
          </p>

          <div>
            <Label>Customer Name</Label>
            <Input
              value={raiseModal.customerName}
              onChange={e => setRaiseModal(m => ({ ...m, customerName: e.target.value }))}
              placeholder="Full name as it should appear in Xero"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Loan Amount (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={raiseModal.loanAmount}
                onChange={e => setRaiseModal(m => ({ ...m, loanAmount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Facility Fee (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={raiseModal.facilityFeeAmount}
                onChange={e => setRaiseModal(m => ({ ...m, facilityFeeAmount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label>Interest (USD)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={raiseModal.interestAmount}
                onChange={e => setRaiseModal(m => ({ ...m, interestAmount: e.target.value }))}
                placeholder="0.00"
              />
            </div>
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
                <p className="text-xs text-muted-foreground mt-2">Reference: <span className="font-mono text-amber-300">${loan > 0 ? Math.round(loan) : "?"}</span> · Status: <span className="text-yellow-400">Awaiting Approval</span></p>
              </div>
            );
          })()}

          {raiseError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{raiseError}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setRaiseModal(m => ({ ...m, open: false }))}
              disabled={raiseLoading}
              className="flex-1 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium transition-colors border border-white/10 disabled:opacity-40"
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
        </div>
      </Modal>

      {/* ── Issue Agreement Modal ── */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Issue Novafeeds Kiosk Agreement">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <Label>Branch</Label>
            <Select required value={branchId} onChange={e => setBranchId(e.target.value)}>
              <option value="">Select Novafeeds Branch</option>
              {novaBranches?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>Customer Full Name</Label>
            <Input required placeholder="Jane Doe" value={customerName} onChange={e => setCustomerName(e.target.value)} />
          </div>
          <div>
            <Label>Customer Phone <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input placeholder="+263 77 123 4567" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
          </div>
          <div>
            <Label>Amount (USD)</Label>
            <Input type="number" required placeholder="500" min="1" value={loanAmount} onChange={e => setLoanAmount(e.target.value)} />
          </div>
          <div>
            <Label>Formitize PDF URL <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input
              type="url"
              placeholder="https://service.formitize.com/..."
              value={pdfUrl}
              onChange={e => setPdfUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">If provided, the kiosk QR code will open this PDF so the customer can sign on screen.</p>
          </div>
          {createError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
              {createError}
            </div>
          )}
          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={() => { setIsModalOpen(false); setCreateError(""); }} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Cancel</button>
            <GradientButton type="submit" isLoading={createMutation.isPending}>Add to Kiosk</GradientButton>
          </div>
        </form>
      </Modal>

      {/* ── Import Formitize CSV Modal ── */}
      <Modal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} title="Import from Formitize CSV">
        <div className="space-y-5">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 text-sm space-y-2">
            <p className="font-medium text-blue-300 flex items-center gap-2"><FileText className="w-4 h-4" /> How to export from Formitize</p>
            <ol className="text-blue-200/80 space-y-1 list-decimal list-inside">
              <li>Go to <strong>Forms → Form Reporting</strong></li>
              <li>Select <strong>NOVAFEED AGREEMENT</strong> as the form</li>
              <li>Click <strong>Add All</strong> to include all fields</li>
              <li>Click <strong>Export CSV</strong> to download the file</li>
              <li>Upload that file here</li>
            </ol>
          </div>

          {!importResult ? (
            <>
              <div
                className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center cursor-pointer hover:border-white/40 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f && f.name.endsWith(".csv")) setCsvFile(f);
                }}
              >
                <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                {csvFile ? (
                  <div>
                    <p className="font-medium text-white">{csvFile.name}</p>
                    <p className="text-sm text-muted-foreground">{(csvFile.size / 1024).toFixed(1)} KB — ready to import</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-white font-medium">Click to select CSV file</p>
                    <p className="text-sm text-muted-foreground mt-1">or drag and drop here</p>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={e => e.target.files?.[0] && setCsvFile(e.target.files[0])}
                />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setIsImportOpen(false)} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Cancel</button>
                <GradientButton onClick={handleImport} isLoading={importing} disabled={!csvFile}>
                  {importing ? "Importing…" : "Import Agreements"}
                </GradientButton>
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-green-400">{importResult.imported}</p>
                  <p className="text-xs text-green-300">Imported</p>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-yellow-400">{importResult.skipped}</p>
                  <p className="text-xs text-yellow-300">Skipped</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-red-400">{importResult.errors.length}</p>
                  <p className="text-xs text-red-300">Errors</p>
                </div>
              </div>
              {importResult.agreements.length > 0 && (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Imported</p>
                  {importResult.agreements.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2 text-sm">
                      <div>
                        <p className="font-medium text-white">{a.customerName}</p>
                        <p className="text-xs text-muted-foreground">{a.branch}</p>
                      </div>
                      <button onClick={() => copyLink(a.signingUrl)} className="p-1.5 rounded bg-white/10 hover:bg-white/20 text-muted-foreground hover:text-white transition-colors">
                        <LinkIcon className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="space-y-1 max-h-36 overflow-y-auto">
                  <p className="text-xs font-medium text-red-400 uppercase tracking-wider">Errors</p>
                  {importResult.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-300/80 bg-red-500/5 rounded px-2 py-1">{e}</p>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={resetImport} className="px-4 py-2 text-sm text-muted-foreground hover:text-white">Import another</button>
                <GradientButton onClick={() => setIsImportOpen(false)}>Done</GradientButton>
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
