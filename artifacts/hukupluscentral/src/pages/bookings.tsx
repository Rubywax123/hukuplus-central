import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, GlassCard } from "@/components/ui-extras";
import { CalendarDays, Store, RefreshCw, UserPlus, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
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
  retailerName: string | null;
  branchName: string | null;
  disbursementDate: string | null;
  createdAt: string;
}

interface PipelineMonth {
  key: string;
  label: string;
  items: PipelineItem[];
}

interface PipelineData {
  months: PipelineMonth[];
  noDate: { label: string; items: PipelineItem[] };
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

function ItemRow({ item }: { item: PipelineItem }) {
  const isReApp = item.status === "reapplication";
  return (
    <div className="flex items-center gap-3 py-2.5 last:pb-0">
      {/* Customer Name */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white truncate leading-tight">{item.customerName || "—"}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {/* Retailer */}
          {item.retailerName && (
            <span className="text-[10px] text-sky-400/80 font-medium truncate">
              {item.retailerName}
            </span>
          )}
          {/* Branch */}
          {item.branchName && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
              <Store className="w-2.5 h-2.5 flex-shrink-0" />
              {item.branchName}
            </span>
          )}
        </div>
      </div>
      {/* Type badge */}
      <div className="flex-shrink-0">
        <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border ${
          isReApp
            ? "bg-amber-500/10 border-amber-500/20 text-amber-400"
            : "bg-sky-500/10 border-sky-500/20 text-sky-400"
        }`}>
          {isReApp ? <RefreshCw className="inline w-2.5 h-2.5 mr-0.5" /> : <UserPlus className="inline w-2.5 h-2.5 mr-0.5" />}
          {isReApp ? "Re-App" : "New"}
        </span>
      </div>
    </div>
  );
}

// ─── Day Group within a month ─────────────────────────────────────────────────

function DayGroup({ dateIso, items }: { dateIso: string; items: PipelineItem[] }) {
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
        {items.map(item => <ItemRow key={item.id} item={item} />)}
      </div>
    </div>
  );
}

// ─── Month accordion ──────────────────────────────────────────────────────────

function MonthSection({
  monthKey, label, items, defaultOpen, accent,
}: {
  monthKey: string;
  label: string;
  items: PipelineItem[];
  defaultOpen: boolean;
  accent: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dayGroups = groupByDay(items);
  const sortedDays = [...dayGroups.keys()].sort();
  const newCount = items.filter(i => i.status === "application").length;
  const reCount  = items.filter(i => i.status === "reapplication").length;

  return (
    <GlassCard className="p-0 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <CalendarDays className={`w-4 h-4 ${accent}`} />
          <span className="text-base font-bold text-white">{label}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 ${accent}`}>
            {items.length} booking{items.length !== 1 ? "s" : ""}
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
            ? <ChevronUp className={`w-4 h-4 ${accent}`} />
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
                <DayGroup key={day} dateIso={day} items={dayGroups.get(day)!} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

// ─── No-date section ──────────────────────────────────────────────────────────

function NoDatSection({ items }: { items: PipelineItem[] }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <GlassCard className="p-0 overflow-hidden border-white/5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <CalendarDays className="w-4 h-4 text-muted-foreground/40" />
          <span className="text-sm font-semibold text-muted-foreground/70">Date Not Yet Set</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground/50">
            {items.length}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/40 mr-2">Applications from last 30 days with no disbursement date</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/30" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/30" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }} className="overflow-hidden"
          >
            <div className="px-5 pb-4 divide-y divide-white/5">
              {items.map(item => (
                <div key={item.id} className="py-2.5 last:pb-0">
                  <ItemRow item={item} />
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5 ml-0">
                    Submitted {new Date(item.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                </div>
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
  const { data, isLoading, refetch, isFetching } = usePipeline();

  const now = new Date();
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div className="pb-10">
      <PageHeader
        title="Bookings"
        description="Upcoming stock collection dates — applications not yet converted to agreements."
      />

      {/* Summary bar */}
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        {data && (
          <>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold text-white tabular-nums">{data.totalOpen}</span>
              <span className="text-sm text-muted-foreground/60">open bookings</span>
            </div>
            <div className="h-4 w-px bg-white/10" />
            {data.months.map(m => (
              <div key={m.key} className="flex items-center gap-1.5">
                <span className={`text-xs font-semibold ${m.key === thisMonthKey ? "text-teal-400" : "text-sky-400"}`}>
                  {m.label.split(" ")[0]}
                </span>
                <span className={`text-sm font-bold tabular-nums ${m.key === thisMonthKey ? "text-teal-300" : "text-sky-300"}`}>
                  {m.items.length}
                </span>
              </div>
            ))}
          </>
        )}
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-white transition-colors"
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
      {!isLoading && data && data.totalOpen === 0 && (
        <GlassCard className="p-12 text-center">
          <CalendarDays className="w-10 h-10 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-sm font-semibold text-white/60">No upcoming bookings</p>
          <p className="text-xs text-muted-foreground/40 mt-1">
            Bookings appear here when a new or re-application has a stock collection date set.
            They fall away automatically once a loan agreement is generated.
          </p>
        </GlassCard>
      )}

      {/* Month sections */}
      {!isLoading && data && (
        <div className="space-y-4">
          {data.months.map((month, idx) => (
            <MonthSection
              key={month.key}
              monthKey={month.key}
              label={month.label}
              items={month.items}
              defaultOpen={idx === 0}
              accent={month.key === thisMonthKey ? "text-teal-400" : "text-sky-400"}
            />
          ))}
          <NoDatSection items={data.noDate.items} />
        </div>
      )}
    </div>
  );
}
