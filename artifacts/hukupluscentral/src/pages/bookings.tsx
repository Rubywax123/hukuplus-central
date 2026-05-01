import React, { useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import { CalendarDays, Store, RefreshCw, UserPlus, ChevronDown, ChevronUp, Loader2, Zap, X, Trash2, CalendarClock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Types ────────────────────────────────────────────────────────────────────

interface PipelineItem {
  id: number;
  customerName: string;
  customerPhone: string | null;
  loanAmount: number | null;
  loanProduct: string | null;
  status: "application" | "reapplication";
  formType: string | null;
  retailerName: string | null;
  branchName: string | null;
  disbursementDate: string | null;
  createdAt: string;
  walkIn: boolean;
}

interface PipelineMonth {
  key: string;
  label: string;
  items: PipelineItem[];
}

interface WalkInMonth {
  key: string;
  label: string;
  count: number;
  isCurrent: boolean;
}

interface PipelineData {
  months: PipelineMonth[];
  noDate: { label: string; items: PipelineItem[] };
  walkIns: { label: string; items: PipelineItem[] };
  walkInMonthly: WalkInMonth[];
  totalOpen: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

function usePipeline() {
  return useQuery<PipelineData>({
    queryKey: ["disbursement-pipeline"],
    queryFn: () =>
      fetch(`${BASE}/api/dashboard/disbursement-pipeline`, { credentials: "include" }).then(r => r.json()),
    refetchInterval: 60 * 1000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────


function parseDateParts(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return {
    day: d.getDate(),
    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
    month: d.toLocaleDateString("en-GB", { month: "short" }),
    full: d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }),
  };
}

function groupByDay(items: PipelineItem[]): Map<string, PipelineItem[]> {
  const map = new Map<string, PipelineItem[]>();
  for (const item of items) {
    const key = item.disbursementDate ?? "unknown";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}

// ─── Item Row ─────────────────────────────────────────────────────────────────

function ItemRow({ item, onDismiss }: { item: PipelineItem; onDismiss: (id: number) => void }) {
  const isReApp = item.status === "reapplication";
  const [dismissing, setDismissing] = useState(false);

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setDismissing(true);
    onDismiss(item.id);
  }

  return (
    <div className="group flex items-center gap-3 py-2.5 last:pb-0">
      {/* Customer Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate leading-tight">{item.customerName || "—"}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {item.retailerName && (
            <span className="text-[10px] text-sky-400/80 font-medium truncate">{item.retailerName}</span>
          )}
          {item.branchName && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
              <Store className="w-2.5 h-2.5 flex-shrink-0" />{item.branchName}
            </span>
          )}
        </div>
      </div>
      {/* Walk-in badge (when shown inside a month section) */}
      {item.walkIn && (
        <span className="flex-shrink-0 flex items-center gap-0.5 text-[9px] font-semibold text-orange-400 bg-orange-500/10 border border-orange-500/20 px-1.5 py-0.5 rounded-full">
          <Zap className="w-2.5 h-2.5" />Walk-in
        </span>
      )}
      {/* Type badge */}
      <span className={`flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
        isReApp
          ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
          : "bg-sky-500/10 border-sky-500/20 text-sky-400"
      }`}>
        {isReApp ? <RefreshCw className="inline w-2.5 h-2.5 mr-0.5" /> : <UserPlus className="inline w-2.5 h-2.5 mr-0.5" />}
        {isReApp ? "Re-App" : "New"}
      </span>
      {/* Dismiss × */}
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        title="Dismiss booking"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-500/20 text-muted-foreground/40 hover:text-red-400 disabled:opacity-30"
      >
        {dismissing
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : <X className="w-3 h-3" />}
      </button>
    </div>
  );
}

// ─── Day Group within a month ─────────────────────────────────────────────────

function DayGroup({ dateIso, items, onDismiss }: { dateIso: string; items: PipelineItem[]; onDismiss: (id: number) => void }) {
  const parts = parseDateParts(dateIso);
  const today = new Date().toISOString().slice(0, 10);
  const isToday = dateIso === today;

  return (
    <div className="flex gap-4 py-3 border-b border-white/5 last:border-0">
      {/* Date column */}
      <div className="flex-shrink-0 w-12 text-center pt-0.5">
        <div className={`rounded-xl px-1.5 py-1.5 ${isToday ? "bg-teal-500/20 border border-teal-500/30" : "bg-white/5"}`}>
          <p className={`text-[9px] font-semibold uppercase tracking-widest leading-none ${isToday ? "text-teal-400" : "text-muted-foreground/60"}`}>
            {parts.month}
          </p>
          <p className={`text-2xl font-bold leading-tight tabular-nums ${isToday ? "text-teal-300" : "text-white/90"}`}>
            {parts.day}
          </p>
          <p className={`text-[8px] leading-none ${isToday ? "text-teal-400/60" : "text-muted-foreground/40"}`}>
            {parts.weekday}
          </p>
        </div>
        {isToday && (
          <p className="text-[8px] text-teal-400 font-semibold mt-1">Today</p>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 min-w-0 divide-y divide-white/5">
        {items.map(item => <ItemRow key={item.id} item={item} onDismiss={onDismiss} />)}
      </div>
    </div>
  );
}

// ─── Month accordion ──────────────────────────────────────────────────────────

function MonthSection({
  monthKey, label, items, defaultOpen, accent, isPast, onDismiss,
}: {
  monthKey: string;
  label: string;
  items: PipelineItem[];
  defaultOpen: boolean;
  accent: string;
  isPast?: boolean;
  onDismiss: (id: number) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dayGroups = groupByDay(items);
  const sortedDays = [...dayGroups.keys()].sort();
  const newCount = items.filter(i => i.status === "application").length;
  const reCount  = items.filter(i => i.status === "reapplication").length;
  const walkInCount = items.filter(i => i.walkIn).length;

  return (
    <GlassCard className={`p-0 overflow-hidden ${isPast ? "opacity-80 border-white/5" : ""}`}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <CalendarDays className={`w-4 h-4 ${isPast ? "text-muted-foreground/40" : accent}`} />
          <span className={`text-base font-bold ${isPast ? "text-white/60" : "text-white"}`}>{label}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 ${isPast ? "text-muted-foreground/50" : accent}`}>
            {items.length} booking{items.length !== 1 ? "s" : ""}
          </span>
          {isPast && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/40 font-medium">Past</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3">
            {walkInCount > 0 && (
              <span className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
                <Zap className="inline w-2.5 h-2.5 mr-0.5" />{walkInCount} walk-in{walkInCount !== 1 ? "s" : ""}
              </span>
            )}
            {newCount - walkInCount > 0 && (
              <span className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">
                {newCount - walkInCount} new
              </span>
            )}
            {reCount > 0 && (
              <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {reCount} re-app
              </span>
            )}
          </div>
          {open
            ? <ChevronUp className={`w-4 h-4 ${isPast ? "text-muted-foreground/30" : accent}`} />
            : <ChevronDown className={`w-4 h-4 text-muted-foreground/40`} />
          }
        </div>
      </button>

      {/* Content */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 divide-y divide-white/5">
              {sortedDays.map(day => (
                <DayGroup key={day} dateIso={day} items={dayGroups.get(day)!} onDismiss={onDismiss} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

// ─── Walk-ins section ─────────────────────────────────────────────────────────

function WalkInsSection({ items, onDismiss }: { items: PipelineItem[]; onDismiss: (id: number) => void }) {
  const [open, setOpen] = useState(true);
  if (items.length === 0) return null;

  const newCount = items.filter(i => i.status === "application").length;
  const reCount  = items.filter(i => i.status === "reapplication").length;

  return (
    <GlassCard className="p-0 overflow-hidden border-orange-500/20">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <Zap className="w-4 h-4 text-orange-400" />
          <span className="text-base font-bold text-white">Walk-ins</span>
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400">
            {items.length} immediate
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3">
            {newCount > 0 && (
              <span className="text-xs text-sky-400 bg-sky-500/10 border border-sky-500/20 px-2 py-0.5 rounded-full">
                {newCount} new
              </span>
            )}
            {reCount > 0 && (
              <span className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                {reCount} re-app
              </span>
            )}
          </div>
          {open
            ? <ChevronUp className="w-4 h-4 text-orange-400" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground/40" />
          }
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 divide-y divide-white/5">
              {items.map(item => (
                <ItemRow key={item.id} item={item} onDismiss={onDismiss} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

// ─── Set-date modal ───────────────────────────────────────────────────────────

function SetDateModal({ item, onClose, onSaved }: {
  item: PipelineItem;
  onClose: () => void;
  onSaved: (id: number, date: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!date) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/agreements/${item.id}/collection-date`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      if (!res.ok) throw new Error(await res.text());
      onSaved(item.id, date);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Save failed");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-[#111827] border border-white/10 rounded-2xl shadow-2xl p-6 space-y-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-white">Set Collection Date</h3>
            <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{item.customerName || "—"}</p>
            {item.retailerName && (
              <p className="text-[11px] text-sky-400/70 mt-0.5">{item.retailerName}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-white/10 text-muted-foreground/40 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-widest">
            Collection Date
          </label>
          <input
            type="date"
            value={date}
            min={today}
            onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-teal-500/60 focus:ring-1 focus:ring-teal-500/30"
          />
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-xl text-sm text-muted-foreground/60 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !date}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Set Date"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── No-date item row (with "Set date" button) ────────────────────────────────

function NoDateItemRow({ item, onDismiss, onSetDate }: {
  item: PipelineItem;
  onDismiss: (id: number) => void;
  onSetDate: (item: PipelineItem) => void;
}) {
  const isReApp = item.status === "reapplication";
  const [dismissing, setDismissing] = useState(false);

  const submitted = item.createdAt
    ? new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setDismissing(true);
    onDismiss(item.id);
  }

  return (
    <div className="group flex items-center gap-3 py-2.5 last:pb-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate leading-tight">{item.customerName || "—"}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {item.retailerName && (
            <span className="text-[10px] text-sky-400/80 font-medium truncate">{item.retailerName}</span>
          )}
          {item.branchName && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
              <Store className="w-2.5 h-2.5 flex-shrink-0" />{item.branchName}
            </span>
          )}
          {submitted && (
            <span className="text-[10px] text-muted-foreground/40">Submitted {submitted}</span>
          )}
        </div>
      </div>
      {/* Type badge */}
      <span className={`flex-shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
        isReApp
          ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
          : "bg-sky-500/10 border-sky-500/20 text-sky-400"
      }`}>
        {isReApp ? <RefreshCw className="inline w-2.5 h-2.5 mr-0.5" /> : <UserPlus className="inline w-2.5 h-2.5 mr-0.5" />}
        {isReApp ? "Re-App" : "New"}
      </span>
      {/* Set date button */}
      <button
        onClick={() => onSetDate(item)}
        title="Set collection date"
        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 hover:text-teal-300 border border-teal-500/20 transition-colors"
      >
        <CalendarClock className="w-3 h-3" />
        <span className="hidden sm:inline">Set date</span>
      </button>
      {/* Dismiss × */}
      <button
        onClick={handleDismiss}
        disabled={dismissing}
        title="Dismiss"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 rounded-full hover:bg-red-500/20 text-muted-foreground/40 hover:text-red-400 disabled:opacity-30"
      >
        {dismissing ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
      </button>
    </div>
  );
}

// ─── No-date section ──────────────────────────────────────────────────────────

function NoDatSection({ items, onDismiss, onDismissAll, onSetDate }: {
  items: PipelineItem[];
  onDismiss: (id: number) => void;
  onDismissAll: (ids: number[]) => void;
  onSetDate: (item: PipelineItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const [clearingAll, setClearingAll] = useState(false);
  if (items.length === 0) return null;

  function handleClearAll(e: React.MouseEvent) {
    e.stopPropagation();
    setClearingAll(true);
    onDismissAll(items.map(i => i.id));
  }

  return (
    <GlassCard className="p-0 overflow-hidden border-white/5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <CalendarDays className="w-4 h-4 text-muted-foreground/40" />
          <span className="text-sm font-semibold text-muted-foreground/70">No Collection Date</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground/50">
            {items.length}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-muted-foreground/40 hidden sm:block">Submitted, no date booked</span>
          <button
            onClick={handleClearAll}
            disabled={clearingAll}
            title="Dismiss all no-date entries"
            className="flex items-center gap-1 text-[10px] text-muted-foreground/40 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-red-500/10 border border-transparent hover:border-red-500/20"
          >
            {clearingAll
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <Trash2 className="w-3 h-3" />}
            Clear all
          </button>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />}
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden"
          >
            <div className="px-5 pb-4 divide-y divide-white/5">
              {items.map(item => (
                <NoDateItemRow key={item.id} item={item} onDismiss={onDismiss} onSetDate={onSetDate} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = usePipeline();
  const [setDateTarget, setSetDateTarget] = useState<PipelineItem | null>(null);

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Optimistically remove an item from the cache, then call the API.
  // Decrement totalOpen when the item is in a month bucket or in today's walk-ins section.
  // No-date entries are not counted in totalOpen.
  const handleDismiss = useCallback((id: number) => {
    queryClient.setQueryData<PipelineData>(["disbursement-pipeline"], old => {
      if (!old) return old;
      const removeId = (items: PipelineItem[]) => items.filter(i => i.id !== id);
      // totalOpen now covers month buckets (incl. past walk-ins) + today's walkIns section
      const inMonth  = old.months.some(m => m.items.some(i => i.id === id));
      const inWalkIn = old.walkIns.items.some(i => i.id === id);
      return {
        ...old,
        totalOpen: (inMonth || inWalkIn) ? old.totalOpen - 1 : old.totalOpen,
        months: old.months.map(m => ({ ...m, items: removeId(m.items) })),
        noDate:  { ...old.noDate,  items: removeId(old.noDate.items)  },
        walkIns: { ...old.walkIns, items: removeId(old.walkIns.items) },
      };
    });
    fetch(`${BASE}/api/agreements/${id}/dismiss`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dismissed: true }),
    }).catch(() => refetch()); // rollback on error
  }, [queryClient, refetch]);

  const handleDismissAll = useCallback((ids: number[]) => {
    queryClient.setQueryData<PipelineData>(["disbursement-pipeline"], old => {
      if (!old) return old;
      const idSet = new Set(ids);
      const removeIds = (items: PipelineItem[]) => items.filter(i => !idSet.has(i.id));
      // Only count removals from month buckets toward totalOpen
      const monthRemovals = old.months.reduce(
        (n, m) => n + m.items.filter(i => idSet.has(i.id)).length, 0
      );
      return {
        ...old,
        totalOpen: old.totalOpen - monthRemovals,
        months: old.months.map(m => ({ ...m, items: removeIds(m.items) })),
        noDate:  { ...old.noDate,  items: removeIds(old.noDate.items)  },
        walkIns: { ...old.walkIns, items: removeIds(old.walkIns.items) },
      };
    });
    Promise.all(ids.map(id =>
      fetch(`${BASE}/api/agreements/${id}/dismiss`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      })
    )).catch(() => refetch());
  }, [queryClient, refetch]);

  // After a date is saved we simply refetch — the item will move from noDate
  // into the correct month bucket automatically.
  const handleDateSaved = useCallback((_id: number, _date: string) => {
    refetch();
  }, [refetch]);

  return (
    <div className="pb-10">
      {setDateTarget && (
        <SetDateModal
          item={setDateTarget}
          onClose={() => setSetDateTarget(null)}
          onSaved={handleDateSaved}
        />
      )}

      <PageHeader
        title="Bookings"
        description="Upcoming stock collection dates — applications not yet converted to agreements."
      />

      {/* ── Stat boxes ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 mb-6">

        {/* Total open */}
        <div className="relative overflow-hidden rounded-xl border border-white/8 bg-white/[0.04] px-4 py-3.5 flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Open</span>
          <span className="text-3xl font-black tabular-nums text-white leading-none">
            {data ? data.totalOpen : <span className="inline-block w-10 h-7 rounded bg-white/5 animate-pulse" />}
          </span>
          <span className="text-[11px] text-muted-foreground/40 mt-0.5">dated, not yet converted</span>
          <div className="absolute right-3 top-3 w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </div>

        {/* Walk-ins with monthly comparison */}
        <div className="relative overflow-hidden rounded-xl border border-orange-500/25 bg-orange-500/[0.06] px-4 py-3.5 flex flex-col gap-1 col-span-1">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-orange-400" />
            <span className="text-[10px] font-semibold uppercase tracking-widest text-orange-400/70">Walk-ins</span>
          </div>
          <span className="text-3xl font-black tabular-nums text-orange-300 leading-none">
            {data ? data.walkIns.items.length : <span className="inline-block w-8 h-7 rounded bg-white/5 animate-pulse" />}
          </span>
          {/* 3-month bar */}
          {data && data.walkInMonthly.length > 0 && (() => {
            const max = Math.max(...data.walkInMonthly.map(m => m.count), 1);
            return (
              <div className="mt-1.5 flex items-end gap-1.5">
                {data.walkInMonthly.map(m => (
                  <div key={m.key} className="flex flex-col items-center gap-0.5 flex-1">
                    <div
                      className={`w-full rounded-sm transition-all ${m.isCurrent ? "bg-orange-400" : "bg-orange-400/30"}`}
                      style={{ height: `${Math.max(4, Math.round((m.count / max) * 20))}px` }}
                    />
                    <span className={`text-[9px] tabular-nums font-bold ${m.isCurrent ? "text-orange-300" : "text-orange-400/40"}`}>
                      {m.count}
                    </span>
                    <span className={`text-[8px] ${m.isCurrent ? "text-orange-400/70" : "text-muted-foreground/30"}`}>
                      {m.label}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* One box per upcoming month */}
        {data && data.months.map(m => {
          const isCurrent = m.key === thisMonthKey;
          const newCount  = m.items.filter(i => i.status === "application").length;
          const reCount   = m.items.filter(i => i.status === "reapplication").length;
          return (
            <div
              key={m.key}
              className={`relative overflow-hidden rounded-xl border px-4 py-3.5 flex flex-col gap-1 ${
                isCurrent
                  ? "border-teal-500/30 bg-teal-500/[0.07]"
                  : "border-sky-500/20 bg-sky-500/[0.05]"
              }`}
            >
              <span className={`text-[10px] font-semibold uppercase tracking-widest ${isCurrent ? "text-teal-400/70" : "text-sky-400/60"}`}>
                {m.label.split(" ")[0]}
              </span>
              <span className={`text-3xl font-black tabular-nums leading-none ${isCurrent ? "text-teal-200" : "text-sky-200"}`}>
                {m.items.length}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                {newCount > 0 && (
                  <span className="text-[9px] text-sky-400/60 font-medium">{newCount} new</span>
                )}
                {reCount > 0 && (
                  <span className="text-[9px] text-amber-400/60 font-medium">{reCount} re-app</span>
                )}
              </div>
              {isCurrent && <div className="absolute right-3 top-3 w-1.5 h-1.5 rounded-full bg-teal-400" />}
            </div>
          );
        })}

        {/* Refresh — bottom-right of the grid row on wider screens */}
        <div className="hidden lg:flex items-end justify-end pb-1">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-white transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Mobile refresh */}
      <div className="flex lg:hidden justify-end mb-4">
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/40 hover:text-white transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && data && data.totalOpen === 0 && data.walkIns.items.length === 0 && data.noDate.items.length === 0 && (
        <GlassCard className="p-12 text-center">
          <CalendarDays className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white/60">No upcoming bookings</p>
          <p className="text-xs text-muted-foreground/40 mt-1">
            Bookings appear here when a new or re-application has a stock collection date set.
            They fall away automatically once a loan agreement is generated.
          </p>
        </GlassCard>
      )}

      {/* Walk-ins — only truly immediate (today/tomorrow), shown first */}
      {!isLoading && data && <WalkInsSection items={data.walkIns.items} onDismiss={handleDismiss} />}

      {/* Month sections — future first, then past */}
      {!isLoading && data && (() => {
        const futureMonths = data.months.filter(m => m.key >= thisMonthKey);
        const pastMonths   = data.months.filter(m => m.key <  thisMonthKey).slice().reverse();
        return (
          <div className="space-y-4 mt-4">
            {futureMonths.map((month, idx) => (
              <MonthSection
                key={month.key}
                monthKey={month.key}
                label={month.label}
                items={month.items}
                defaultOpen={idx === 0}
                isPast={false}
                accent={month.key === thisMonthKey ? "text-teal-400" : "text-sky-400"}
                onDismiss={handleDismiss}
              />
            ))}
            {pastMonths.map(month => (
              <MonthSection
                key={month.key}
                monthKey={month.key}
                label={month.label}
                items={month.items}
                defaultOpen={false}
                isPast={true}
                accent="text-muted-foreground/50"
                onDismiss={handleDismiss}
              />
            ))}
            <NoDatSection items={data.noDate.items} onDismiss={handleDismiss} onDismissAll={handleDismissAll} onSetDate={setSetDateTarget} />
          </div>
        );
      })()}
    </div>
  );
}
